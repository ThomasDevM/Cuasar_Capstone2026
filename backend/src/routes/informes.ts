import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import type { Db, Queryable } from "../db.js";
import { soloAdmin } from "../auth.js";
import { HttpError, audit, fechaSchema, hoy, parse, sumarDias } from "../util.js";

export const lunesDe = (f: string) => { const d = new Date(f + "T12:00:00Z"); return sumarDias(f, -((d.getUTCDay() + 6) % 7)); };
const PCT = "round(v.monto * COALESCE(v.porcentaje_aplicado, 0) / 100.0)";

const SQL_RESUMEN = `
SELECT p.id AS profesional_id, p.nombre, p.contrato, p.porcentaje,
       count(v.id)::int AS atenciones, COALESCE(sum(v.monto), 0)::int AS ventas,
       COALESCE(sum(${PCT}), 0)::int AS comision,
       (COALESCE(sum(v.monto), 0) - COALESCE(sum(${PCT}), 0))::int AS centro
FROM profesionales p
LEFT JOIN citas c ON c.profesional_id = p.id AND c.estado = 'REALIZADA'
LEFT JOIN ventas v ON v.cita_id = c.id AND v.fecha BETWEEN $1 AND $2
WHERE ($3::int IS NULL OR p.id = $3) GROUP BY p.id ORDER BY p.nombre`;

const SQL_DETALLE = `
SELECT v.fecha, p.nombre AS profesional, p.id AS profesional_id, pa.nombre AS paciente, v.descripcion, v.nro_boleta, v.medio_pago, v.monto,
       v.porcentaje_aplicado AS porcentaje, ${PCT}::int AS comision, (v.monto - ${PCT})::int AS centro
FROM ventas v JOIN citas c ON c.id = v.cita_id AND c.estado = 'REALIZADA'
JOIN profesionales p ON p.id = c.profesional_id LEFT JOIN pacientes pa ON pa.id = v.paciente_id
WHERE v.fecha BETWEEN $1 AND $2 AND ($3::int IS NULL OR p.id = $3) ORDER BY p.nombre, v.fecha, v.id`;

export async function gananciasRango(q: Queryable, desde: string, hasta: string, prof: number | null) {
  const [resumen, detalle] = await Promise.all([q.query(SQL_RESUMEN, [desde, hasta, prof]), q.query(SQL_DETALLE, [desde, hasta, prof])]);
  const suma = (k: string) => resumen.reduce((a, x) => a + x[k], 0);
  return { desde, hasta, resumen, detalle, totales: { atenciones: suma("atenciones"), ventas: suma("ventas"), comision: suma("comision"), centro: suma("centro") } };
}

const fmtCLP = '"$"#,##0';
function hoja(wb: ExcelJS.Workbook, nombre: string, cols: [string, string, number, boolean?][], filas: any[]) {
  const ws = wb.addWorksheet(nombre);
  ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
  filas.forEach((f) => ws.addRow(f)); ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B2A6F" } };
  cols.forEach(([, key, , money]) => { if (money) ws.getColumn(key).numFmt = fmtCLP; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

export function libroGanancias(g: Awaited<ReturnType<typeof gananciasRango>>) {
  const wb = new ExcelJS.Workbook();
  const ws = hoja(wb, "Resumen", [["Profesional", "nombre", 28], ["Contrato", "contrato", 14], ["% base", "porcentaje", 9], ["Atenciones cobradas", "atenciones", 20], ["Ventas", "ventas", 14, true], ["Ganancia profesional", "comision", 22, true], ["Ganancia del centro", "centro", 22, true]], g.resumen);
  const t = ws.addRow({ nombre: "TOTAL", ...g.totales }); t.font = { bold: true };
  ws.addRow([]); ws.addRow([`Periodo: ${g.desde} al ${g.hasta}`]);
  hoja(wb, "Detalle", [["Fecha", "fecha", 12], ["Profesional", "profesional", 24], ["Paciente", "paciente", 26], ["Descripción", "descripcion", 34], ["N° boleta", "nro_boleta", 12], ["Medio de pago", "medio_pago", 16], ["Monto", "monto", 12, true], ["%", "porcentaje", 6], ["Profesional", "comision", 13, true], ["Centro", "centro", 13, true]], g.detalle);
  return wb;
}

/** Reporte semanal completo (lunes a domingo). */
export async function construirSemanal(db: Queryable, fecha: string) {
  const desde = lunesDe(fecha), hasta = sumarDias(desde, 6), p = [desde, hasta];
  const [g, porDia, porMedio, estados, nuevos, top, citas, ventas] = await Promise.all([
    gananciasRango(db, desde, hasta, null),
    db.query("SELECT fecha, COALESCE(sum(monto),0)::int AS ventas, count(*)::int AS cobros FROM ventas WHERE fecha BETWEEN $1 AND $2 GROUP BY fecha", p),
    db.query("SELECT medio_pago, COALESCE(sum(monto),0)::int AS monto, count(*)::int AS cobros FROM ventas WHERE fecha BETWEEN $1 AND $2 GROUP BY medio_pago ORDER BY 2 DESC", p),
    db.query("SELECT estado, count(*)::int AS n FROM citas WHERE fecha BETWEEN $1 AND $2 GROUP BY estado", p),
    db.query("SELECT count(*)::int AS n FROM pacientes WHERE to_char(created_at AT TIME ZONE 'America/Santiago','YYYY-MM-DD') BETWEEN $1 AND $2", p),
    db.query("SELECT s.nombre AS servicio, count(*)::int AS cobros, COALESCE(sum(v.monto),0)::int AS monto FROM ventas v JOIN citas c ON c.id=v.cita_id JOIN servicios s ON s.id=c.servicio_id WHERE v.fecha BETWEEN $1 AND $2 GROUP BY s.nombre ORDER BY 3 DESC LIMIT 5", p),
    db.query("SELECT c.fecha, c.hora, pa.nombre AS paciente, s.nombre AS servicio, pr.nombre AS profesional, b.nombre AS box, c.estado, EXISTS (SELECT 1 FROM ventas v WHERE v.cita_id=c.id) AS pagada FROM citas c JOIN pacientes pa ON pa.id=c.paciente_id JOIN servicios s ON s.id=c.servicio_id JOIN profesionales pr ON pr.id=c.profesional_id JOIN boxes b ON b.id=c.box_id WHERE c.fecha BETWEEN $1 AND $2 ORDER BY c.fecha, c.hora", p),
    db.query("SELECT v.fecha, pa.nombre AS paciente, v.descripcion, pr.nombre AS profesional, v.medio_pago, v.nro_boleta, v.monto FROM ventas v LEFT JOIN pacientes pa ON pa.id=v.paciente_id LEFT JOIN profesionales pr ON pr.id=v.vendedor_id WHERE v.fecha BETWEEN $1 AND $2 ORDER BY v.fecha, v.id", p),
  ]);
  const ventasTotal = ventas.reduce((a, v) => a + v.monto, 0);
  const est = Object.fromEntries(estados.map((x) => [x.estado, x.n]));
  const dias = Array.from({ length: 7 }, (_, i) => { const f = sumarDias(desde, i); const r = porDia.find((x) => x.fecha === f); return { fecha: f, ventas: r?.ventas ?? 0, cobros: r?.cobros ?? 0 }; });
  const resumen = {
    desde, hasta, ventas_total: ventasTotal, comisiones: g.totales.comision, ganancia_centro: ventasTotal - g.totales.comision,
    citas_realizadas: est.REALIZADA ?? 0, citas_canceladas: est.CANCELADA ?? 0, inasistencias: est.INASISTENCIA ?? 0, citas_pendientes: (est.AGENDADA ?? 0) + (est.CONFIRMADA ?? 0),
    pacientes_nuevos: nuevos[0].n, por_dia: dias, por_medio: porMedio, por_profesional: g.resumen, top_servicios: top,
  };
  const wb = new ExcelJS.Workbook();
  const r = wb.addWorksheet("Resumen"); r.columns = [{ width: 34 }, { width: 18 }, { width: 14 }];
  r.addRow([`Reporte semanal · ${desde} al ${hasta}`]).font = { bold: true, size: 14 }; r.addRow([]);
  [["Ventas totales", ventasTotal], ["Ganancia de los profesionales", resumen.comisiones], ["Ganancia del centro", resumen.ganancia_centro], ["Atenciones realizadas", resumen.citas_realizadas], ["Citas canceladas", resumen.citas_canceladas], ["Inasistencias", resumen.inasistencias], ["Citas pendientes", resumen.citas_pendientes], ["Pacientes nuevos", resumen.pacientes_nuevos]]
    .forEach(([k, v], i) => { const row = r.addRow([k, v]); row.getCell(1).font = { bold: true }; if (i < 3) row.getCell(2).numFmt = fmtCLP; });
  r.addRow([]); r.addRow(["Ventas por día", "Ventas", "Cobros"]).font = { bold: true };
  dias.forEach((d) => { const row = r.addRow([d.fecha, d.ventas, d.cobros]); row.getCell(2).numFmt = fmtCLP; });
  r.addRow([]); r.addRow(["Medio de pago", "Monto", "Cobros"]).font = { bold: true };
  porMedio.forEach((m) => { const row = r.addRow([m.medio_pago, m.monto, m.cobros]); row.getCell(2).numFmt = fmtCLP; });
  r.addRow([]); r.addRow(["Tratamientos más vendidos", "Monto", "Cobros"]).font = { bold: true };
  top.forEach((m) => { const row = r.addRow([m.servicio, m.monto, m.cobros]); row.getCell(2).numFmt = fmtCLP; });
  hoja(wb, "Por profesional", [["Profesional", "nombre", 28], ["Contrato", "contrato", 14], ["% base", "porcentaje", 9], ["Atenciones cobradas", "atenciones", 20], ["Ventas", "ventas", 14, true], ["Ganancia profesional", "comision", 22, true], ["Ganancia del centro", "centro", 22, true]], g.resumen);
  hoja(wb, "Atenciones", [["Fecha", "fecha", 12], ["Hora", "hora", 8], ["Paciente", "paciente", 28], ["Tratamiento", "servicio", 30], ["Profesional", "profesional", 24], ["Box", "box", 10], ["Estado", "estado", 14], ["Cobrada", "pagada", 10]], citas.map((c) => ({ ...c, pagada: c.pagada ? "Sí" : "No" })));
  hoja(wb, "Ventas", [["Fecha", "fecha", 12], ["Paciente", "paciente", 28], ["Descripción", "descripcion", 34], ["Profesional", "profesional", 24], ["Medio de pago", "medio_pago", 16], ["N° boleta", "nro_boleta", 12], ["Monto", "monto", 12, true]], ventas);
  return { resumen, wb };
}

export function informeRoutes(db: Db) {
  const r = Router();
  const rango = z.object({ desde: fechaSchema.default(() => sumarDias(hoy(), -(Number(hoy().slice(8)) - 1))), hasta: fechaSchema.default(() => hoy()), profesional_id: z.coerce.number().int().optional() });
  const alcance = (req: any, pedido?: number) => (req.user.rol === "PROFESIONAL" ? req.user.profesionalId : pedido ?? null);
  const validar = (f: { desde: string; hasta: string }) => { if (f.desde > f.hasta) throw new HttpError(400, "La fecha inicial no puede ser posterior a la final"); };

  r.get("/informes/ganancias", async (req, res) => {
    const f = parse(rango, req.query); validar(f);
    res.json(await gananciasRango(db, f.desde, f.hasta, alcance(req, f.profesional_id)));
  });
  r.get("/informes/ganancias/export", async (req, res) => {
    const f = parse(rango, req.query); validar(f);
    const wb = libroGanancias(await gananciasRango(db, f.desde, f.hasta, alcance(req, f.profesional_id)));
    await audit(db, req, "EXPORTAR_INFORME", "informe", null, null, `ganancias ${f.desde} a ${f.hasta}`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="ganancias_${f.desde}_${f.hasta}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
  r.get("/informes/semanal", soloAdmin, async (req, res) => {
    const { fecha } = parse(z.object({ fecha: fechaSchema.default(() => hoy()) }), req.query);
    res.json((await construirSemanal(db, fecha)).resumen);
  });
  r.get("/informes/semanal/export", soloAdmin, async (req, res) => {
    const { fecha } = parse(z.object({ fecha: fechaSchema.default(() => hoy()) }), req.query);
    const { resumen, wb } = await construirSemanal(db, fecha);
    await audit(db, req, "EXPORTAR_INFORME", "informe", null, null, `semanal ${resumen.desde}`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="reporte_semanal_${resumen.desde}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
  return r;
}
