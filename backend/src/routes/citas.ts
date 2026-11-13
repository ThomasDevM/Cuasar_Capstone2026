import { Router } from "express";
import { z } from "zod";
import type { Db, Queryable } from "../db.js";
import { HttpError, audit, esViolacionUnica, fechaSchema, horaSchema, minutos, parse, idParam, porcentajeAplicable } from "../util.js";
import { avisarEnSegundoPlano, leerAjustes } from "../correo.js";

const ESTADOS = ["AGENDADA", "CONFIRMADA", "REALIZADA", "CANCELADA", "INASISTENCIA"] as const;

const BASE_SELECT = `
SELECT c.id, c.fecha, c.hora, c.inicio_min, c.fin_min, c.estado, c.nro_sesion, c.plan_id, c.notas, s.duracion_min AS duracion_servicio,
       (SELECT max(c2.fecha) FROM citas c2 WHERE c2.paciente_id = c.paciente_id AND c2.estado = 'REALIZADA' AND c2.fecha < c.fecha) AS ultima_atencion,
       c.paciente_id, p.nombre AS paciente, p.celular, p.rut,
       c.servicio_id, s.nombre AS servicio, s.precio, s.sesiones AS sesiones_servicio,
       c.profesional_id, pr.nombre AS profesional, c.box_id, b.nombre AS box,
       pl.sesiones_total,
       EXISTS (SELECT 1 FROM ventas v WHERE v.cita_id = c.id) AS pagada,
       EXISTS (SELECT 1 FROM evoluciones e WHERE e.cita_id = c.id) AS tiene_evolucion
FROM citas c
JOIN pacientes p ON p.id = c.paciente_id JOIN servicios s ON s.id = c.servicio_id
JOIN profesionales pr ON pr.id = c.profesional_id JOIN boxes b ON b.id = c.box_id
LEFT JOIN planes pl ON pl.id = c.plan_id`;

export function validarBloque(hora: string, dur: number) {
  if (minutos(hora) % 30 !== 0) throw new HttpError(400, "Las citas se agendan en bloques de 30 minutos (a las :00 o :30)", "FUERA_DE_BLOQUE");
  if (dur < 30 || dur % 30 !== 0) throw new HttpError(400, "La duración debe ser múltiplo de 30 minutos", "DURACION_INVALIDA");
  if (minutos(hora) + dur > 24 * 60) throw new HttpError(400, "La cita no puede terminar después de medianoche");
}

export async function validarDisponibilidad(q: Queryable, a: { fecha: string; ini: number; fin: number; profesional_id: number; box_id: number; paciente_id: number; excluir?: number }) {
  const rows = await q.query(
    `SELECT id, profesional_id, box_id, paciente_id FROM citas
     WHERE fecha=$1 AND estado NOT IN ('CANCELADA','INASISTENCIA') AND inicio_min < $3 AND $2 < fin_min
       AND (profesional_id=$4 OR box_id=$5 OR paciente_id=$7) AND ($6::int IS NULL OR id <> $6)`,
    [a.fecha, a.ini, a.fin, a.profesional_id, a.box_id, a.excluir ?? null, a.paciente_id],
  );
  if (rows.some((x) => x.profesional_id === a.profesional_id)) throw new HttpError(409, "El profesional ya tiene una cita en ese horario", "CONFLICTO_PROFESIONAL");
  if (rows.some((x) => x.paciente_id === a.paciente_id)) throw new HttpError(409, "El paciente ya tiene una cita en ese horario", "CONFLICTO_PACIENTE");
  if (rows.length) throw new HttpError(409, "El box ya está ocupado en ese horario", "CONFLICTO_BOX");
}

/** Resuelve (o crea) el plan de sesiones y calcula el N° de sesión. `excluir` = cita que se está editando. */
async function asignarPlan(t: Queryable, a: { paciente_id: number; servicio: any; plan_id?: number | null; forzar?: boolean; excluir?: number }) {
  if (!a.plan_id && a.servicio.sesiones <= 1) return { planId: null as number | null, nro: null as number | null };
  let plan: any;
  if (a.plan_id) {
    [plan] = await t.query("SELECT * FROM planes WHERE id=$1 AND paciente_id=$2 AND servicio_id=$3 AND estado='ACTIVO'", [a.plan_id, a.paciente_id, a.servicio.id]);
    if (!plan) throw new HttpError(400, "El plan indicado no existe o no está activo para este paciente y servicio");
  } else {
    [plan] = await t.query("SELECT * FROM planes WHERE paciente_id=$1 AND servicio_id=$2 AND estado='ACTIVO' ORDER BY created_at DESC LIMIT 1", [a.paciente_id, a.servicio.id]);
    if (!plan) [plan] = await t.query("INSERT INTO planes(paciente_id,servicio_id,sesiones_total,origen) VALUES ($1,$2,$3,'EVALUACION') RETURNING *", [a.paciente_id, a.servicio.id, a.servicio.sesiones]);
  }
  const [{ n }] = await t.query("SELECT count(*)::int AS n FROM citas WHERE plan_id=$1 AND estado NOT IN ('CANCELADA','INASISTENCIA') AND ($2::int IS NULL OR id <> $2)", [plan.id, a.excluir ?? null]);
  const siguiente = n + 1;
  if (siguiente > plan.sesiones_total && !a.forzar)
    throw new HttpError(409, `El plan tiene ${plan.sesiones_total} sesiones y esta sería la ${siguiente}. ¿Agendar igualmente?`, "PLAN_EXCEDIDO");
  return { planId: plan.id as number, nro: siguiente };
}

export function citaRoutes(db: Db) {
  const r = Router();

  r.get("/citas", async (req, res) => {
    const f = parse(z.object({ fecha: fechaSchema.optional(), desde: fechaSchema.optional(), hasta: fechaSchema.optional(), profesional_id: z.coerce.number().int().optional(), paciente_id: z.coerce.number().int().optional() }), req.query);
    const desde = f.fecha ?? f.desde, hasta = f.fecha ?? f.hasta ?? f.desde;
    if (!desde) throw new HttpError(400, "Indique fecha o desde/hasta");
    const prof = req.user!.rol === "PROFESIONAL" ? req.user!.profesionalId : f.profesional_id ?? null;
    const rows = await db.query(`${BASE_SELECT} WHERE c.fecha BETWEEN $1 AND $2 AND ($3::int IS NULL OR c.profesional_id=$3) AND ($4::int IS NULL OR c.paciente_id=$4) ORDER BY c.fecha, c.hora`, [desde, hasta, prof, f.paciente_id ?? null]);
    res.json(rows);
  });

  /* Bloques de 30 minutos libres de un profesional (y con algún box libre) en una fecha */
  r.get("/citas/disponibilidad", async (req, res) => {
    const f = parse(z.object({ fecha: fechaSchema, profesional_id: z.coerce.number().int(), duracion_min: z.coerce.number().int().min(30).max(240).default(30), paciente_id: z.coerce.number().int().optional(), excluir: z.coerce.number().int().optional() }), req.query);
    if (f.duracion_min % 30 !== 0) throw new HttpError(400, "La duración debe ser múltiplo de 30 minutos");
    const aj = await leerAjustes(db), desde = minutos(aj.horario_inicio || "09:00"), hasta = minutos(aj.horario_fin || "19:00");
    const [dia, boxes] = await Promise.all([
      db.query("SELECT profesional_id, box_id, paciente_id, inicio_min, fin_min FROM citas WHERE fecha=$1 AND estado NOT IN ('CANCELADA','INASISTENCIA') AND ($2::int IS NULL OR id <> $2)", [f.fecha, f.excluir ?? null]),
      db.query("SELECT id FROM boxes WHERE activo ORDER BY nombre"),
    ]);
    const choca = (c: any, m: number) => c.inicio_min < m + f.duracion_min && m < c.fin_min;
    const slots = [];
    for (let m = desde; m + f.duracion_min <= hasta; m += 30) {
      const prof = dia.some((c) => c.profesional_id === f.profesional_id && choca(c, m));
      const pac = f.paciente_id ? dia.some((c) => c.paciente_id === f.paciente_id && choca(c, m)) : false;
      const boxes_libres = boxes.filter((b) => !dia.some((c) => c.box_id === b.id && choca(c, m))).map((b) => b.id);
      const hora = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      slots.push({ hora, libre: !prof && !pac && boxes_libres.length > 0, motivo: prof ? "profesional ocupado" : pac ? "paciente con otra cita" : boxes_libres.length ? null : "sin box libre", boxes_libres });
    }
    res.json({ fecha: f.fecha, inicio: aj.horario_inicio || "09:00", fin: aj.horario_fin || "19:00", slots });
  });

  r.post("/citas", async (req, res) => {
    const d = parse(z.object({
      paciente_id: z.number().int(), servicio_id: z.number().int(), profesional_id: z.number().int(), box_id: z.number().int(),
      fecha: fechaSchema, hora: horaSchema, duracion_min: z.number().int().min(30).max(240).optional(),
      plan_id: z.number().int().nullish(), forzar: z.boolean().optional(), notas: z.string().max(1000).nullish(),
    }), req.body);
    if (req.user!.rol === "PROFESIONAL" && req.user!.profesionalId !== d.profesional_id) throw new HttpError(403, "Solo puede agendar en su propia agenda");
    const ini = minutos(d.hora);
    try {
      const id = await db.tx(async (t) => {
        const [[pac], [srv], [prof], [box]] = await Promise.all([
          t.query("SELECT id FROM pacientes WHERE id=$1 AND activo", [d.paciente_id]),
          t.query("SELECT * FROM servicios WHERE id=$1 AND activo", [d.servicio_id]),
          t.query("SELECT id FROM profesionales WHERE id=$1 AND activo", [d.profesional_id]),
          t.query("SELECT id FROM boxes WHERE id=$1 AND activo", [d.box_id]),
        ]);
        if (!pac) throw new HttpError(400, "Paciente no válido"); if (!srv) throw new HttpError(400, "Servicio no válido");
        if (!prof) throw new HttpError(400, "Profesional no válido"); if (!box) throw new HttpError(400, "Box no válido");
        const dur = d.duracion_min ?? srv.duracion_min, fin = ini + dur;
        validarBloque(d.hora, dur);
        await validarDisponibilidad(t, { fecha: d.fecha, ini, fin, profesional_id: d.profesional_id, box_id: d.box_id, paciente_id: d.paciente_id });

        const { planId, nro } = await asignarPlan(t, { paciente_id: d.paciente_id, servicio: srv, plan_id: d.plan_id, forzar: d.forzar });
        const [c] = await t.query(
          "INSERT INTO citas(plan_id,paciente_id,servicio_id,profesional_id,box_id,fecha,hora,inicio_min,fin_min,nro_sesion,notas,creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id",
          [planId, d.paciente_id, d.servicio_id, d.profesional_id, d.box_id, d.fecha, d.hora, ini, fin, nro, d.notas ?? null, req.user!.id]);
        await t.query("INSERT INTO cita_historial(cita_id, accion, detalle, usuario_id) VALUES ($1,'CREADA',$2,$3)", [c.id, `${d.fecha} ${d.hora}`, req.user!.id]);
        await audit(t, req, "AGENDAR", "cita", c.id, d.paciente_id);
        return c.id as number;
      });
      avisarEnSegundoPlano(db, id, "CONFIRMACION");
      const [cita] = await db.query(`${BASE_SELECT} WHERE c.id=$1`, [id]);
      res.status(201).json(cita);
    } catch (e) { if (esViolacionUnica(e)) throw new HttpError(409, "Ese horario ya está ocupado", "CONFLICTO"); throw e; }
  });

  async function cargarCita(req: any, id: number) {
    const [c] = await db.query("SELECT * FROM citas WHERE id=$1", [id]);
    if (!c) throw new HttpError(404, "Cita no encontrada");
    if (req.user.rol === "PROFESIONAL" && c.profesional_id !== req.user.profesionalId) throw new HttpError(403, "Esta cita pertenece a otro profesional");
    return c;
  }

  /* ---- Editar / reprogramar ---- */
  r.patch("/citas/:id", async (req, res) => {
    const c = await cargarCita(req, idParam(req.params.id));
    const admin = req.user!.rol === "ADMIN";
    const d = parse(z.object({
      fecha: fechaSchema.optional(), hora: horaSchema.optional(), box_id: z.number().int().optional(), profesional_id: z.number().int().optional(),
      duracion_min: z.number().int().min(30).max(240).optional(), servicio_id: z.number().int().optional(), notas: z.string().max(1000).nullish(), forzar: z.boolean().optional(),
    }), req.body);
    const cambiaAgenda = d.fecha || d.hora || d.box_id || d.duracion_min || (d.servicio_id && d.servicio_id !== c.servicio_id);
    const cambiaProf = d.profesional_id !== undefined && d.profesional_id !== c.profesional_id;
    if (cambiaAgenda && !["AGENDADA", "CONFIRMADA"].includes(c.estado)) throw new HttpError(400, "Solo se puede cambiar horario, box o servicio en citas agendadas o confirmadas");
    if (cambiaProf) {
      if (!admin && !["AGENDADA", "CONFIRMADA"].includes(c.estado)) throw new HttpError(403, "Solo Dirección puede corregir el profesional de una atención ya registrada");
      if (["CANCELADA", "INASISTENCIA"].includes(c.estado)) throw new HttpError(400, "No se puede cambiar el profesional de una cita cancelada o con inasistencia");
      if (!admin && d.profesional_id !== req.user!.profesionalId) throw new HttpError(403, "No puede traspasar la cita a otro profesional");
    }
    const n = { fecha: d.fecha ?? c.fecha, hora: d.hora ?? c.hora, box_id: d.box_id ?? c.box_id, profesional_id: d.profesional_id ?? c.profesional_id, servicio_id: d.servicio_id ?? c.servicio_id, dur: d.duracion_min ?? c.fin_min - c.inicio_min };
    const cambiaServicio = n.servicio_id !== c.servicio_id;
    try {
      await db.tx(async (t) => {
        let srvNuevo: any = null;
        if (cambiaServicio) {
          [srvNuevo] = await t.query("SELECT * FROM servicios WHERE id=$1 AND activo", [n.servicio_id]);
          if (!srvNuevo) throw new HttpError(400, "Servicio no válido");
          const [v] = await t.query("SELECT id FROM ventas WHERE cita_id=$1", [c.id]);
          if (v) throw new HttpError(409, "La cita ya tiene un cobro: anúlelo antes de cambiar el tratamiento", "TIENE_COBRO");
          if (d.duracion_min === undefined) n.dur = srvNuevo.duracion_min;
        }
        const ini = minutos(n.hora), fin = ini + n.dur;
        if (cambiaAgenda) validarBloque(n.hora, n.dur);
        const [prof] = await t.query("SELECT * FROM profesionales WHERE id=$1 AND activo", [n.profesional_id]);
        if (!prof) throw new HttpError(400, "Profesional no válido");
        const [box] = await t.query("SELECT id FROM boxes WHERE id=$1 AND activo", [n.box_id]);
        if (!box) throw new HttpError(400, "Box no válido");
        if (["AGENDADA", "CONFIRMADA", "REALIZADA"].includes(c.estado) && (cambiaAgenda || cambiaProf))
          await validarDisponibilidad(t, { fecha: n.fecha, ini, fin, profesional_id: n.profesional_id, box_id: n.box_id, paciente_id: c.paciente_id, excluir: c.id });
        let planId = c.plan_id, nro = c.nro_sesion;
        if (cambiaServicio) ({ planId, nro } = await asignarPlan(t, { paciente_id: c.paciente_id, servicio: srvNuevo, forzar: d.forzar, excluir: c.id }));
        const reprograma = n.fecha !== c.fecha || n.hora !== c.hora;
        await t.query("UPDATE citas SET fecha=$2,hora=$3,inicio_min=$4,fin_min=$5,box_id=$6,profesional_id=$7,servicio_id=$8,plan_id=$9,nro_sesion=$10,notas=$11,estado=CASE WHEN $12 THEN 'AGENDADA' ELSE estado END WHERE id=$1",
          [c.id, n.fecha, n.hora, ini, fin, n.box_id, n.profesional_id, n.servicio_id, planId, nro, d.notas === undefined ? c.notas : d.notas, reprograma]);
        if (reprograma) await t.query("DELETE FROM notificaciones WHERE cita_id=$1 AND tipo='RECORDATORIO'", [c.id]);
        if (cambiaProf) {   // la ganancia sigue a quien atendió
          await t.query("UPDATE ventas SET vendedor_id=$2, porcentaje_aplicado=$3 WHERE cita_id=$1", [c.id, prof.id, await porcentajeAplicable(t, prof.id, n.servicio_id)]);
        }
        const cambios = [reprograma && `${c.fecha} ${c.hora} → ${n.fecha} ${n.hora}`, cambiaProf && `profesional #${c.profesional_id} → #${n.profesional_id}`, n.servicio_id !== c.servicio_id && `servicio #${c.servicio_id} → #${n.servicio_id}`, n.box_id !== c.box_id && `box #${c.box_id} → #${n.box_id}`, d.notas !== undefined && "notas"].filter(Boolean).join("; ");
        await t.query("INSERT INTO cita_historial(cita_id, accion, detalle, usuario_id) VALUES ($1,$2,$3,$4)", [c.id, reprograma ? "REPROGRAMADA" : "EDITADA", cambios || "sin cambios", req.user!.id]);
        await audit(t, req, "EDITAR_CITA", "cita", c.id, c.paciente_id, cambios);
      });
    } catch (e) { if (esViolacionUnica(e)) throw new HttpError(409, "Ese horario ya está ocupado", "CONFLICTO"); throw e; }
    if (n.fecha !== c.fecha || n.hora !== c.hora) avisarEnSegundoPlano(db, c.id, "REPROGRAMACION");
    const [cita] = await db.query(`${BASE_SELECT} WHERE c.id=$1`, [c.id]);
    res.json(cita);
  });

  /* ---- Eliminar ---- */
  r.delete("/citas/:id", async (req, res) => {
    const c = await cargarCita(req, idParam(req.params.id));
    const admin = req.user!.rol === "ADMIN";
    if (!admin && !["AGENDADA", "CONFIRMADA"].includes(c.estado)) throw new HttpError(403, "Solo Dirección puede eliminar una atención ya registrada");
    await db.tx(async (t) => {
      const [[v], [e]] = await Promise.all([t.query("SELECT id FROM ventas WHERE cita_id=$1", [c.id]), t.query("SELECT id FROM evoluciones WHERE cita_id=$1", [c.id])]);
      if (v) throw new HttpError(409, "La cita tiene un cobro registrado. Anule el cobro primero (Ventas).", "TIENE_COBRO");
      if (e) throw new HttpError(409, "La cita tiene evolución clínica registrada y no puede eliminarse. Use «Cancelada» para conservar el historial.", "TIENE_EVOLUCION");
      if (c.plan_id && c.estado === "REALIZADA") await t.query("UPDATE planes SET sesiones_realizadas = GREATEST(sesiones_realizadas - 1, 0), estado = CASE WHEN estado='COMPLETADO' THEN 'ACTIVO' ELSE estado END WHERE id=$1", [c.plan_id]);
      await t.query("DELETE FROM citas WHERE id=$1", [c.id]);
      await audit(t, req, "ELIMINAR_CITA", "cita", c.id, c.paciente_id, `${c.fecha} ${c.hora} (${c.estado})`);
    });
    res.json({ ok: true });
  });

  /* ---- Cambio de estado (con control del plan de sesiones) ---- */
  r.post("/citas/:id/estado", async (req, res) => {
    const { estado } = parse(z.object({ estado: z.enum(ESTADOS) }), req.body);
    const c = await cargarCita(req, idParam(req.params.id));
    if (c.estado === estado) { const [x] = await db.query(`${BASE_SELECT} WHERE c.id=$1`, [c.id]); return res.json(x); }
    if (c.estado === "REALIZADA" && req.user!.rol !== "ADMIN") throw new HttpError(403, "Solo Dirección puede revertir una atención realizada");
    try {
      await db.tx(async (t) => {
        await t.query("UPDATE citas SET estado=$2 WHERE id=$1", [c.id, estado]);
        if (c.plan_id && estado === "REALIZADA")
          await t.query("UPDATE planes SET sesiones_realizadas = sesiones_realizadas + 1, estado = CASE WHEN sesiones_realizadas + 1 >= sesiones_total THEN 'COMPLETADO' ELSE estado END WHERE id=$1", [c.plan_id]);
        if (c.plan_id && c.estado === "REALIZADA")
          await t.query("UPDATE planes SET sesiones_realizadas = GREATEST(sesiones_realizadas - 1, 0), estado = CASE WHEN estado='COMPLETADO' THEN 'ACTIVO' ELSE estado END WHERE id=$1", [c.plan_id]);
        if (estado === "CANCELADA" || estado === "INASISTENCIA") await t.query("DELETE FROM notificaciones WHERE cita_id=$1 AND estado='PENDIENTE'", [c.id]);
        await t.query("INSERT INTO cita_historial(cita_id, accion, detalle, usuario_id) VALUES ($1,'ESTADO',$2,$3)", [c.id, `${c.estado} → ${estado}`, req.user!.id]);
        await audit(t, req, "CAMBIAR_ESTADO_CITA", "cita", c.id, c.paciente_id, `${c.estado} → ${estado}`);
      });
    } catch (e) { if (esViolacionUnica(e)) throw new HttpError(409, "No se puede reactivar: el horario ya fue ocupado", "CONFLICTO"); throw e; }
    if (estado === "CANCELADA") avisarEnSegundoPlano(db, c.id, "CANCELACION");
    const [x] = await db.query(`${BASE_SELECT} WHERE c.id=$1`, [c.id]);
    res.json(x);
  });

  /* ---- Evolución de la sesión ---- */
  r.post("/citas/:id/evolucion", async (req, res) => {
    const c = await cargarCita(req, idParam(req.params.id));
    if (c.estado === "CANCELADA") throw new HttpError(400, "No se registra evolución en una cita cancelada");
    const d = parse(z.object({ observaciones: z.string().min(3, "escriba las observaciones"), procedimiento: z.string().max(2000).nullish(), recomendaciones: z.string().max(2000).nullish() }), req.body);
    const [e] = await db.query(
      `INSERT INTO evoluciones(cita_id,paciente_id,profesional_id,observaciones,procedimiento,recomendaciones) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (cita_id) DO UPDATE SET observaciones=EXCLUDED.observaciones, procedimiento=EXCLUDED.procedimiento, recomendaciones=EXCLUDED.recomendaciones, updated_at=now() RETURNING *`,
      [c.id, c.paciente_id, c.profesional_id, d.observaciones, d.procedimiento ?? null, d.recomendaciones ?? null]);
    await audit(db, req, "REGISTRAR_EVOLUCION", "cita", c.id, c.paciente_id);
    res.status(201).json(e);
  });
  r.get("/citas/:id/evolucion", async (req, res) => {
    const c = await cargarCita(req, idParam(req.params.id));
    const [e] = await db.query("SELECT * FROM evoluciones WHERE cita_id=$1", [c.id]);
    res.json(e ?? null);
  });
  r.get("/citas/:id/historial", async (req, res) => {
    const c = await cargarCita(req, idParam(req.params.id));
    res.json(await db.query("SELECT h.accion, h.detalle, h.created_at, u.nombre AS usuario FROM cita_historial h LEFT JOIN usuarios u ON u.id=h.usuario_id WHERE h.cita_id=$1 ORDER BY h.id", [c.id]));
  });
  return r;
}
