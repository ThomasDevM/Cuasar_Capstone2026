import { Router } from "express";
import { soloAdmin } from "../auth.js";
import { audit, hoy, sumarDias, parse, mesSchema } from "../util.js";
import { z } from "zod";
import { listarMantencion } from "./seguimiento.js";
import { SQL_RESUMEN } from "./comisiones.js";
export function reporteRoutes(db) {
    const r = Router();
    r.get("/reportes/dashboard", async (req, res) => {
        const f = hoy(), mes = f.slice(0, 7);
        if (req.user.rol === "PROFESIONAL") {
            const pid = req.user.profesionalId;
            const [citas, atendidos, com, prox] = await Promise.all([
                db.query("SELECT estado, count(*)::int AS n FROM citas WHERE fecha=$1 AND profesional_id=$2 GROUP BY estado", [f, pid]),
                db.query("SELECT count(DISTINCT paciente_id)::int AS n FROM citas WHERE profesional_id=$1 AND estado='REALIZADA' AND fecha LIKE $2", [pid, mes + "%"]),
                db.query(SQL_RESUMEN, [mes + "%", pid]),
                db.query("SELECT c.hora, p.nombre AS paciente, s.nombre AS servicio, c.estado FROM citas c JOIN pacientes p ON p.id=c.paciente_id JOIN servicios s ON s.id=c.servicio_id WHERE c.fecha=$1 AND c.profesional_id=$2 AND c.estado IN ('AGENDADA','CONFIRMADA') ORDER BY c.hora", [f, pid]),
            ]);
            return res.json({ rol: "PROFESIONAL", fecha: f, citas_hoy: citas.reduce((a, x) => a + x.n, 0), pacientes_atendidos_mes: atendidos[0].n, comision_mes: com[0]?.contrato === "PORCENTAJE" ? com[0].comision : null, proximas: prox });
        }
        const [citas, pacs, sinCons, vHoy, vMes, com, stock, mant, prox, rec, ctl, crm] = await Promise.all([
            db.query("SELECT estado, count(*)::int AS n FROM citas WHERE fecha=$1 GROUP BY estado", [f]),
            db.query("SELECT count(*)::int AS n FROM pacientes WHERE activo"),
            db.query("SELECT count(*)::int AS n FROM pacientes p WHERE p.activo AND NOT EXISTS (SELECT 1 FROM consentimientos c WHERE c.paciente_id=p.id)"),
            db.query("SELECT COALESCE(sum(monto),0)::int AS n FROM ventas WHERE fecha=$1", [f]),
            db.query("SELECT COALESCE(sum(monto),0)::int AS n FROM ventas WHERE fecha LIKE $1", [mes + "%"]),
            db.query(SQL_RESUMEN, [mes + "%", null]),
            db.query("SELECT count(*)::int AS n FROM productos WHERE activo AND stock <= stock_minimo"),
            listarMantencion(db, f),
            db.query("SELECT c.id, c.hora, p.nombre AS paciente, s.nombre AS servicio, pr.nombre AS profesional, b.nombre AS box, c.estado FROM citas c JOIN pacientes p ON p.id=c.paciente_id JOIN servicios s ON s.id=c.servicio_id JOIN profesionales pr ON pr.id=c.profesional_id JOIN boxes b ON b.id=c.box_id WHERE c.fecha=$1 AND c.estado IN ('AGENDADA','CONFIRMADA','REALIZADA') ORDER BY c.hora", [f]),
            db.query("SELECT count(*)::int AS n FROM citas WHERE fecha=$1 AND estado IN ('AGENDADA','CONFIRMADA')", [sumarDias(f, 1)]),
            db.query("SELECT count(*)::int AS n FROM seguimientos s JOIN pacientes p ON p.id=s.paciente_id WHERE s.proximo_control IS NOT NULL AND NOT s.control_resuelto AND s.proximo_control <= $1 AND p.activo", [sumarDias(f, 7)]),
            db.query(`SELECT (SELECT count(*)::int FROM prospectos WHERE estado IN ('NUEVO','CONTACTADO','EVALUACION')) AS prospectos_abiertos,
                (SELECT count(*)::int FROM prospectos WHERE estado IN ('NUEVO','CONTACTADO','EVALUACION') AND (estado='NUEVO' OR proximo_contacto <= $1::text)) AS prospectos_por_contactar,
                (SELECT count(*)::int FROM presupuestos WHERE estado='ENVIADO' AND (fecha::date + validez_dias) >= ($1::text)::date) AS presupuestos_pendientes,
                (SELECT count(*)::int FROM encuestas WHERE puntaje IS NOT NULL AND puntaje <= 6 AND NOT gestionada) AS detractores_por_gestionar,
                (SELECT round(100.0 * (count(*) FILTER (WHERE puntaje >= 9) - count(*) FILTER (WHERE puntaje <= 6)) / NULLIF(count(*), 0))::int
                   FROM encuestas WHERE puntaje IS NOT NULL AND respondida_en > now() - interval '90 days') AS nps`, [f]),
        ]);
        res.json({
            rol: "ADMIN", fecha: f,
            citas_hoy: citas.reduce((a, x) => a + x.n, 0), citas_por_estado: Object.fromEntries(citas.map((x) => [x.estado, x.n])),
            pacientes: pacs[0].n, pacientes_sin_consentimiento: sinCons[0].n,
            ventas_hoy: vHoy[0].n, ventas_mes: vMes[0].n, comision_mes: com.reduce((a, x) => a + x.comision, 0),
            productos_stock_bajo: stock[0].n, pacientes_por_contactar: mant.length, citas_manana: rec[0].n, proximas: prox,
            ganancia_centro_mes: vMes[0].n - com.reduce((a, x) => a + x.comision, 0), controles_pendientes: ctl[0].n,
            ...crm[0],
        });
    });
    r.get("/auditoria", soloAdmin, async (req, res) => {
        const f = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), paciente_id: z.coerce.number().int().optional(), accion: z.string().max(40).optional() }), req.query);
        res.json(await db.query("SELECT id, usuario_nombre, accion, entidad, entidad_id, paciente_id, detalle, created_at FROM auditoria WHERE ($1::int IS NULL OR paciente_id=$1) AND ($3::text IS NULL OR accion=$3) ORDER BY id DESC LIMIT $2", [f.paciente_id ?? null, f.limit, f.accion ?? null]));
    });
    /** Verifica la cadena de hashes: detecta si alguien alteró o borró registros directamente en la base de datos. */
    r.get("/auditoria/verificar", soloAdmin, async (req, res) => {
        const [alterados, rotos, total] = await Promise.all([
            db.query("SELECT a.id FROM auditoria a WHERE a.hash IS DISTINCT FROM auditoria_hash(a.hash_anterior, a) ORDER BY a.id LIMIT 50"),
            // Cada registro debe apuntar al hash de un registro existente, y ningún hash puede ser "padre" de dos registros.
            db.query(`SELECT a.id FROM auditoria a WHERE a.hash_anterior IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auditoria b WHERE b.hash = a.hash_anterior)
                UNION SELECT min(a.id) FROM auditoria a WHERE a.hash_anterior IS NOT NULL GROUP BY a.hash_anterior HAVING count(*) > 1
                UNION SELECT a.id FROM auditoria a WHERE a.hash_anterior IS NULL AND a.id <> (SELECT min(id) FROM auditoria) LIMIT 50`),
            db.query("SELECT count(*)::int AS n FROM auditoria"),
        ]);
        const ok = !alterados.length && !rotos.length;
        await audit(db, req, "VERIFICAR_AUDITORIA", "auditoria", null, null, ok ? "íntegra" : `alterados=${alterados.length} rotos=${rotos.length}`);
        res.json({ ok, registros: total[0].n, alterados: alterados.map((x) => x.id), cadena_rota: rotos.map((x) => x.id) });
    });
    void mesSchema;
    return r;
}
