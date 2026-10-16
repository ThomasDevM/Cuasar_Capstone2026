import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { soloAdmin } from "../auth.js";
import { audit, hoy, mesSchema, parse } from "../util.js";
export const SQL_RESUMEN = `
SELECT p.id AS profesional_id, p.nombre, p.contrato, p.porcentaje,
       count(v.id)::int AS atenciones,
       COALESCE(sum(v.monto), 0)::int AS ventas,
       COALESCE(sum(round(v.monto * COALESCE(v.porcentaje_aplicado, 0) / 100.0)), 0)::int AS comision,
       (COALESCE(sum(v.monto), 0) - COALESCE(sum(round(v.monto * COALESCE(v.porcentaje_aplicado, 0) / 100.0)), 0))::int AS centro
FROM profesionales p
LEFT JOIN citas c ON c.profesional_id = p.id AND c.estado = 'REALIZADA'
LEFT JOIN ventas v ON v.cita_id = c.id AND v.fecha LIKE $1
WHERE ($2::int IS NULL OR p.id = $2)
GROUP BY p.id ORDER BY p.nombre`;
export const SQL_DETALLE = `
SELECT v.fecha, pa.nombre AS paciente, v.descripcion, v.nro_boleta, v.monto, v.porcentaje_aplicado AS porcentaje,
       round(v.monto * COALESCE(v.porcentaje_aplicado, 0) / 100.0)::int AS comision, (v.monto - round(v.monto * COALESCE(v.porcentaje_aplicado, 0) / 100.0))::int AS centro, p.nombre AS profesional, p.id AS profesional_id
FROM ventas v JOIN citas c ON c.id = v.cita_id AND c.estado = 'REALIZADA'
JOIN profesionales p ON p.id = c.profesional_id LEFT JOIN pacientes pa ON pa.id = v.paciente_id
WHERE v.fecha LIKE $1 AND ($2::int IS NULL OR p.id = $2) ORDER BY p.nombre, v.fecha, v.id`;
export function comisionRoutes(db) {
    const r = Router();
    const alcance = (req, pedido) => (req.user.rol === "PROFESIONAL" ? req.user.profesionalId : pedido ?? null);
    r.get("/comisiones", async (req, res) => {
        const f = parse(z.object({ mes: mesSchema.default(hoy().slice(0, 7)), profesional_id: z.coerce.number().int().optional() }), req.query);
        const resumen = await db.query(SQL_RESUMEN, [f.mes + "%", alcance(req, f.profesional_id)]);
        res.json({ mes: f.mes, resumen, total_ventas: resumen.reduce((a, x) => a + x.ventas, 0), total_comision: resumen.reduce((a, x) => a + x.comision, 0), total_centro: resumen.reduce((a, x) => a + x.centro, 0) });
    });
    r.get("/comisiones/detalle", async (req, res) => {
        const f = parse(z.object({ mes: mesSchema.default(hoy().slice(0, 7)), profesional_id: z.coerce.number().int().optional() }), req.query);
        res.json(await db.query(SQL_DETALLE, [f.mes + "%", alcance(req, f.profesional_id)]));
    });
    r.get("/comisiones/export", soloAdmin, async (req, res) => {
        const { mes } = parse(z.object({ mes: mesSchema }), req.query);
        const [resumen, detalle] = await Promise.all([db.query(SQL_RESUMEN, [mes + "%", null]), db.query(SQL_DETALLE, [mes + "%", null])]);
        const wb = new ExcelJS.Workbook();
        const w1 = wb.addWorksheet("Resumen");
        w1.columns = [{ header: "Profesional", key: "nombre", width: 28 }, { header: "Contrato", key: "contrato", width: 14 }, { header: "% comisión", key: "porcentaje", width: 12 }, { header: "Atenciones cobradas", key: "atenciones", width: 20 }, { header: "Ventas", key: "ventas", width: 14 }, { header: "Comisión profesional", key: "comision", width: 20 }, { header: "Ganancia del centro", key: "centro", width: 20 }];
        resumen.forEach((x) => w1.addRow(x));
        w1.getRow(1).font = { bold: true };
        w1.getColumn("ventas").numFmt = '"$"#,##0';
        w1.getColumn("comision").numFmt = '"$"#,##0';
        w1.getColumn("centro").numFmt = '"$"#,##0';
        const w2 = wb.addWorksheet("Detalle");
        w2.columns = [{ header: "Fecha", key: "fecha", width: 12 }, { header: "Profesional", key: "profesional", width: 24 }, { header: "Paciente", key: "paciente", width: 26 }, { header: "Descripción", key: "descripcion", width: 34 }, { header: "N° boleta", key: "nro_boleta", width: 14 }, { header: "Monto", key: "monto", width: 12 }, { header: "%", key: "porcentaje", width: 6 }, { header: "Comisión", key: "comision", width: 12 }, { header: "Centro", key: "centro", width: 12 }];
        detalle.forEach((x) => w2.addRow(x));
        w2.getRow(1).font = { bold: true };
        await audit(db, req, "EXPORTAR_COMISIONES", "comision", null, null, mes);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="comisiones_${mes}.xlsx"`);
        res.send(Buffer.from(await wb.xlsx.writeBuffer()));
    });
    return r;
}
