import { Router } from "express";
import type { Db } from "../db.js";
import { soloAdmin } from "../auth.js";
import { hoy, sumarDias, parse, mesSchema } from "../util.js";
import { z } from "zod";
import { listarMantencion } from "./seguimiento.js";
import { SQL_RESUMEN } from "./comisiones.js";

export function reporteRoutes(db: Db) {
  const r = Router();

  r.get("/reportes/dashboard", async (req, res) => {
    const f = hoy(), mes = f.slice(0, 7);
    if (req.user!.rol === "PROFESIONAL") {
      const pid = req.user!.profesionalId;
      const [citas, atendidos, com, prox] = await Promise.all([
        db.query("SELECT estado, count(*)::int AS n FROM citas WHERE fecha=$1 AND profesional_id=$2 GROUP BY estado", [f, pid]),
        db.query("SELECT count(DISTINCT paciente_id)::int AS n FROM citas WHERE profesional_id=$1 AND estado='REALIZADA' AND fecha LIKE $2", [pid, mes + "%"]),
        db.query(SQL_RESUMEN, [mes + "%", pid]),
        db.query("SELECT c.hora, p.nombre AS paciente, s.nombre AS servicio, c.estado FROM citas c JOIN pacientes p ON p.id=c.paciente_id JOIN servicios s ON s.id=c.servicio_id WHERE c.fecha=$1 AND c.profesional_id=$2 AND c.estado IN ('AGENDADA','CONFIRMADA') ORDER BY c.hora", [f, pid]),
      ]);
      return res.json({ rol: "PROFESIONAL", fecha: f, citas_hoy: citas.reduce((a, x) => a + x.n, 0), pacientes_atendidos_mes: atendidos[0].n, comision_mes: com[0]?.contrato === "PORCENTAJE" ? com[0].comision : null, proximas: prox });
    }
    const [citas, pacs, sinCons, vHoy, vMes, com, mant, prox, rec, ctl] = await Promise.all([
      db.query("SELECT estado, count(*)::int AS n FROM citas WHERE fecha=$1 GROUP BY estado", [f]),
      db.query("SELECT count(*)::int AS n FROM pacientes WHERE activo"),
      db.query("SELECT count(*)::int AS n FROM pacientes p WHERE p.activo AND NOT EXISTS (SELECT 1 FROM consentimientos c WHERE c.paciente_id=p.id)"),
      db.query("SELECT COALESCE(sum(monto),0)::int AS n FROM ventas WHERE fecha=$1", [f]),
      db.query("SELECT COALESCE(sum(monto),0)::int AS n FROM ventas WHERE fecha LIKE $1", [mes + "%"]),
      db.query(SQL_RESUMEN, [mes + "%", null]),
      listarMantencion(db, f),
      db.query("SELECT c.id, c.hora, p.nombre AS paciente, s.nombre AS servicio, pr.nombre AS profesional, b.nombre AS box, c.estado FROM citas c JOIN pacientes p ON p.id=c.paciente_id JOIN servicios s ON s.id=c.servicio_id JOIN profesionales pr ON pr.id=c.profesional_id JOIN boxes b ON b.id=c.box_id WHERE c.fecha=$1 AND c.estado IN ('AGENDADA','CONFIRMADA','REALIZADA') ORDER BY c.hora", [f]),
      db.query("SELECT count(*)::int AS n FROM citas WHERE fecha=$1 AND estado IN ('AGENDADA','CONFIRMADA')", [sumarDias(f, 1)]),
      db.query("SELECT count(*)::int AS n FROM seguimientos s JOIN pacientes p ON p.id=s.paciente_id WHERE s.proximo_control IS NOT NULL AND NOT s.control_resuelto AND s.proximo_control <= $1 AND p.activo", [sumarDias(f, 7)]),
    ]);
    res.json({
      rol: "ADMIN", fecha: f,
      citas_hoy: citas.reduce((a, x) => a + x.n, 0), citas_por_estado: Object.fromEntries(citas.map((x) => [x.estado, x.n])),
      pacientes: pacs[0].n, pacientes_sin_consentimiento: sinCons[0].n,
      ventas_hoy: vHoy[0].n, ventas_mes: vMes[0].n, comision_mes: com.reduce((a, x) => a + x.comision, 0),
      pacientes_por_contactar: mant.length, citas_manana: rec[0].n, proximas: prox,
      ganancia_centro_mes: vMes[0].n - com.reduce((a, x) => a + x.comision, 0), controles_pendientes: ctl[0].n,
    });
  });

  r.get("/auditoria", soloAdmin, async (req, res) => {
    const f = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), paciente_id: z.coerce.number().int().optional() }), req.query);
    res.json(await db.query("SELECT id, usuario_nombre, accion, entidad, entidad_id, paciente_id, detalle, created_at FROM auditoria WHERE ($1::int IS NULL OR paciente_id=$1) ORDER BY id DESC LIMIT $2", [f.paciente_id ?? null, f.limit]));
  });
  void mesSchema;
  return r;
}
