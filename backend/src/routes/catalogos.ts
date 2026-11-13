import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import type { Db, Queryable } from "../db.js";
import { soloAdmin } from "../auth.js";
import { HttpError, audit, esViolacionUnica, parse, idParam } from "../util.js";
import { cifrar, enviarCorreo } from "../correo.js";

const opt = <T extends z.ZodType>(s: T) => s.optional();

export function catalogoRoutes(db: Db) {
  const r = Router();
  const dup = (e: any, msg: string): never => { if (esViolacionUnica(e)) throw new HttpError(409, msg); throw e; };

  /* ---- Profesionales ---- */
  const profSchema = z.object({
    nombre: z.string().min(2), especialidad: z.string().nullish(), turnos: z.string().nullish(),
    contrato: z.enum(["PORCENTAJE", "OTRO"]), porcentaje: z.number().int().min(0).max(100), activo: z.boolean().optional(),
  });
  r.get("/profesionales", async (_req, res) => res.json(await db.query("SELECT * FROM profesionales ORDER BY activo DESC, nombre")));
  const sugerirUsuario = async (q: Queryable, nombre: string) => {
    const [n, ...resto] = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, "").trim().split(/\s+/);
    const base = (n?.[0] ?? "u") + (resto.pop() ?? n ?? "usuario");
    let u = base, i = 1;
    while ((await q.query("SELECT 1 FROM usuarios WHERE username=$1", [u])).length) u = base + ++i;
    return u;
  };
  const claveTemporal = () => crypto.randomBytes(8).toString("base64url").slice(0, 10);
  r.post("/profesionales", soloAdmin, async (req, res) => {
    const d = parse(profSchema.extend({ acceso: z.object({ username: z.string().min(3).regex(/^[a-zA-Z0-9._-]+$/, "solo letras, números, punto, guion").optional(), password: z.string().min(8, "mínimo 8 caracteres").optional() }).optional() }), req.body);
    if (d.contrato === "OTRO" && d.porcentaje !== 0) throw new HttpError(400, "Un contrato distinto de porcentaje debe tener 0%");
    try {
      const out = await db.tx(async (t) => {
        const [p] = await t.query("INSERT INTO profesionales(nombre,especialidad,turnos,contrato,porcentaje) VALUES ($1,$2,$3,$4,$5) RETURNING *", [d.nombre, d.especialidad ?? null, d.turnos ?? null, d.contrato, d.porcentaje]);
        let acceso: { username: string; password_temporal: string } | undefined;
        if (d.acceso) {
          const username = d.acceso.username ?? (await sugerirUsuario(t, d.nombre)), pass = d.acceso.password ?? claveTemporal();
          await t.query("INSERT INTO usuarios(username,nombre,password_hash,rol,profesional_id,debe_cambiar_clave) VALUES ($1,$2,$3,'PROFESIONAL',$4,TRUE)", [username, d.nombre, await bcrypt.hash(pass, 10), p.id]);
          acceso = { username, password_temporal: pass };
        }
        await audit(t, req, "CREAR", "profesional", p.id, null, `${d.contrato} ${d.porcentaje}%${acceso ? " + acceso" : ""}`);
        return { ...p, acceso };
      });
      res.status(201).json(out);
    } catch (e) { dup(e, "Ese nombre de usuario ya existe"); }
  });

  /* Porcentaje especial por tratamiento (opcional): reemplaza al % base del profesional para ese tratamiento */
  r.get("/profesionales/:id/comisiones", soloAdmin, async (req, res) => {
    res.json(await db.query("SELECT s.id AS servicio_id, s.nombre AS servicio, s.precio, cs.porcentaje FROM servicios s LEFT JOIN comision_servicio cs ON cs.servicio_id=s.id AND cs.profesional_id=$1 WHERE s.activo OR cs.porcentaje IS NOT NULL ORDER BY s.nombre", [idParam(req.params.id)]));
  });
  r.put("/profesionales/:id/comisiones/:servicioId", soloAdmin, async (req, res) => {
    const { porcentaje } = parse(z.object({ porcentaje: z.number().int().min(0).max(100) }), req.body);
    const pid = idParam(req.params.id), sid = idParam(req.params.servicioId);
    const [p] = await db.query("SELECT id FROM profesionales WHERE id=$1", [pid]); if (!p) throw new HttpError(404, "Profesional no encontrado");
    await db.query("INSERT INTO comision_servicio(profesional_id,servicio_id,porcentaje) VALUES ($1,$2,$3) ON CONFLICT (profesional_id,servicio_id) DO UPDATE SET porcentaje=EXCLUDED.porcentaje", [pid, sid, porcentaje]);
    await audit(db, req, "EDITAR_COMISION_TRATAMIENTO", "profesional", pid, null, `servicio #${sid}: ${porcentaje}%`); res.json({ ok: true });
  });
  r.delete("/profesionales/:id/comisiones/:servicioId", soloAdmin, async (req, res) => {
    await db.query("DELETE FROM comision_servicio WHERE profesional_id=$1 AND servicio_id=$2", [idParam(req.params.id), idParam(req.params.servicioId)]);
    await audit(db, req, "QUITAR_COMISION_TRATAMIENTO", "profesional", idParam(req.params.id)); res.json({ ok: true });
  });
  r.patch("/profesionales/:id", soloAdmin, async (req, res) => {
    const d = parse(profSchema.partial(), req.body); const id = idParam(req.params.id);
    const [cur] = await db.query("SELECT * FROM profesionales WHERE id=$1", [id]);
    if (!cur) throw new HttpError(404, "Profesional no encontrado");
    const n = { ...cur, ...d };
    if (n.contrato === "OTRO") n.porcentaje = 0;
    const [p] = await db.query("UPDATE profesionales SET nombre=$2, especialidad=$3, turnos=$4, contrato=$5, porcentaje=$6, activo=$7 WHERE id=$1 RETURNING *", [id, n.nombre, n.especialidad, n.turnos, n.contrato, n.porcentaje, n.activo]);
    await audit(db, req, "EDITAR", "profesional", id, null, `porcentaje ${cur.porcentaje}→${n.porcentaje}; contrato ${cur.contrato}→${n.contrato}`); res.json(p);
  });

  /* ---- Boxes ---- */
  r.get("/boxes", async (_req, res) => res.json(await db.query("SELECT * FROM boxes ORDER BY nombre")));
  r.post("/boxes", soloAdmin, async (req, res) => {
    const { nombre } = parse(z.object({ nombre: z.string().min(1) }), req.body);
    try { const [b] = await db.query("INSERT INTO boxes(nombre) VALUES ($1) RETURNING *", [nombre]); res.status(201).json(b); } catch (e) { dup(e, "Ya existe un box con ese nombre"); }
  });
  r.patch("/boxes/:id", soloAdmin, async (req, res) => {
    const d = parse(z.object({ nombre: opt(z.string().min(1)), activo: opt(z.boolean()) }), req.body);
    const [b] = await db.query("UPDATE boxes SET nombre = COALESCE($2, nombre), activo = COALESCE($3, activo) WHERE id=$1 RETURNING *", [idParam(req.params.id), d.nombre ?? null, d.activo ?? null]);
    if (!b) throw new HttpError(404, "Box no encontrado"); res.json(b);
  });

  /* ---- Servicios ---- */
  const servSchema = z.object({ nombre: z.string().min(2), precio: z.number().int().min(0), sesiones: z.number().int().min(1), duracion_min: z.number().int().min(30).max(240).refine((v) => v % 30 === 0, "la duración debe ser múltiplo de 30 minutos"), intervalo_mantencion_dias: z.number().int().min(1).nullish(), activo: z.boolean().optional() });
  r.get("/servicios", async (_req, res) => res.json(await db.query("SELECT * FROM servicios ORDER BY activo DESC, nombre")));
  r.post("/servicios", soloAdmin, async (req, res) => {
    const d = parse(servSchema, req.body);
    try {
      const [s] = await db.query("INSERT INTO servicios(nombre,precio,sesiones,duracion_min,intervalo_mantencion_dias) VALUES ($1,$2,$3,$4,$5) RETURNING *", [d.nombre, d.precio, d.sesiones, d.duracion_min, d.intervalo_mantencion_dias ?? null]);
      await audit(db, req, "CREAR", "servicio", s.id); res.status(201).json(s);
    } catch (e) { dup(e, "Ya existe un servicio con ese nombre"); }
  });
  r.patch("/servicios/:id", soloAdmin, async (req, res) => {
    const d = parse(servSchema.partial(), req.body); const id = idParam(req.params.id);
    const [cur] = await db.query("SELECT * FROM servicios WHERE id=$1", [id]);
    if (!cur) throw new HttpError(404, "Servicio no encontrado");
    const n = { ...cur, ...d };
    const [s] = await db.query("UPDATE servicios SET nombre=$2, precio=$3, sesiones=$4, duracion_min=$5, intervalo_mantencion_dias=$6, activo=$7 WHERE id=$1 RETURNING *", [id, n.nombre, n.precio, n.sesiones, n.duracion_min, n.intervalo_mantencion_dias ?? null, n.activo]);
    await audit(db, req, "EDITAR", "servicio", id, null, `${cur.nombre}: precio ${cur.precio}→${n.precio}; duración ${cur.duracion_min}→${n.duracion_min} min`); res.json(s);
  });

  /* ---- Enfermedades / antecedentes (catálogo editable) ---- */
  r.get("/enfermedades", async (_req, res) => res.json(await db.query("SELECT * FROM enfermedades ORDER BY activo DESC, nombre")));
  r.post("/enfermedades", soloAdmin, async (req, res) => {
    const { nombre } = parse(z.object({ nombre: z.string().trim().min(2).max(80) }), req.body);
    try { const [e] = await db.query("INSERT INTO enfermedades(nombre) VALUES ($1) RETURNING *", [nombre]); await audit(db, req, "CREAR", "enfermedad", e.id, null, nombre); res.status(201).json(e); } catch (e) { dup(e, "Esa enfermedad ya existe en el catálogo"); }
  });
  r.patch("/enfermedades/:id", soloAdmin, async (req, res) => {
    const d = parse(z.object({ nombre: opt(z.string().trim().min(2).max(80)), activo: opt(z.boolean()) }), req.body);
    try {
      const [e] = await db.query("UPDATE enfermedades SET nombre = COALESCE($2, nombre), activo = COALESCE($3, activo) WHERE id=$1 RETURNING *", [idParam(req.params.id), d.nombre ?? null, d.activo ?? null]);
      if (!e) throw new HttpError(404, "Enfermedad no encontrada"); res.json(e);
    } catch (e) { dup(e, "Esa enfermedad ya existe en el catálogo"); }
  });

  /* ---- Usuarios (solo Dirección): crear, modificar, cambiar clave, activar y eliminar ---- */
  const userSchema = z.string().min(3, "mínimo 3 caracteres").regex(/^[a-zA-Z0-9._-]+$/, "solo letras, números, punto, guion");
  const SEL_USUARIO = "SELECT u.id,u.username,u.nombre,u.rol,u.profesional_id,u.activo,u.debe_cambiar_clave,p.nombre AS profesional FROM usuarios u LEFT JOIN profesionales p ON p.id=u.profesional_id";
  const adminsActivos = async (q: Queryable, excluir: number) => (await q.query("SELECT count(*)::int AS n FROM usuarios WHERE rol='ADMIN' AND activo AND id <> $1", [excluir]))[0].n as number;

  r.get("/usuarios", soloAdmin, async (_req, res) => res.json(await db.query(`${SEL_USUARIO} ORDER BY u.activo DESC, u.rol, u.nombre`)));

  r.post("/usuarios", soloAdmin, async (req, res) => {
    const d = parse(z.object({ username: userSchema, nombre: z.string().min(2), password: z.string().min(8, "mínimo 8 caracteres"), rol: z.enum(["ADMIN", "PROFESIONAL"]), profesional_id: z.number().int().nullish(), debe_cambiar_clave: z.boolean().optional() }), req.body);
    if (d.rol === "PROFESIONAL" && !d.profesional_id) throw new HttpError(400, "Un usuario Profesional debe vincularse a un profesional");
    try {
      const [u] = await db.query("INSERT INTO usuarios(username,nombre,password_hash,rol,profesional_id,debe_cambiar_clave) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [d.username, d.nombre, await bcrypt.hash(d.password, 10), d.rol, d.rol === "ADMIN" ? null : d.profesional_id ?? null, d.debe_cambiar_clave ?? true]);
      await audit(db, req, "CREAR", "usuario", u.id, null, `${d.username} (${d.rol})`);
      res.status(201).json((await db.query(`${SEL_USUARIO} WHERE u.id=$1`, [u.id]))[0]);
    } catch (e) { dup(e, "Ese nombre de usuario ya existe"); }
  });

  r.patch("/usuarios/:id", soloAdmin, async (req, res) => {
    const d = parse(z.object({ username: opt(userSchema), nombre: opt(z.string().min(2)), rol: opt(z.enum(["ADMIN", "PROFESIONAL"])), profesional_id: z.number().int().nullish(), activo: opt(z.boolean()), password: opt(z.string().min(8, "mínimo 8 caracteres")), debe_cambiar_clave: opt(z.boolean()) }), req.body);
    const id = idParam(req.params.id), propio = id === req.user!.id;
    const [cur] = await db.query("SELECT * FROM usuarios WHERE id=$1", [id]);
    if (!cur) throw new HttpError(404, "Usuario no encontrado");
    const rol = d.rol ?? cur.rol, activo = d.activo ?? cur.activo;
    const prof = rol === "ADMIN" ? null : d.profesional_id === undefined ? cur.profesional_id : d.profesional_id;
    if (rol === "PROFESIONAL" && !prof) throw new HttpError(400, "Un usuario Profesional debe vincularse a un profesional");
    if (propio && (activo === false || rol !== "ADMIN")) throw new HttpError(400, "No puede desactivarse ni quitarse el perfil de Dirección a sí misma");
    if (cur.rol === "ADMIN" && cur.activo && (rol !== "ADMIN" || !activo) && (await adminsActivos(db, id)) === 0) throw new HttpError(400, "Debe quedar al menos un usuario de Dirección activo");
    const hash = d.password ? await bcrypt.hash(d.password, 10) : cur.password_hash;
    const forzar = d.password ? (d.debe_cambiar_clave ?? !propio) : (d.debe_cambiar_clave ?? cur.debe_cambiar_clave);
    try {
      await db.query("UPDATE usuarios SET username=$2, nombre=$3, rol=$4, profesional_id=$5, activo=$6, password_hash=$7, debe_cambiar_clave=$8, intentos_fallidos=CASE WHEN $9 THEN 0 ELSE intentos_fallidos END, bloqueado_hasta=CASE WHEN $9 THEN NULL ELSE bloqueado_hasta END WHERE id=$1",
        [id, d.username ?? cur.username, d.nombre ?? cur.nombre, rol, prof, activo, hash, forzar, Boolean(d.password) || (d.activo === true && !cur.activo)]);
    } catch (e) { dup(e, "Ese nombre de usuario ya existe"); }
    await audit(db, req, d.password ? "CAMBIAR_CLAVE_USUARIO" : "EDITAR", "usuario", id, null, [d.username && `usuario ${cur.username}→${d.username}`, d.rol && `perfil ${cur.rol}→${d.rol}`, d.activo !== undefined && `activo=${d.activo}`].filter(Boolean).join("; ") || undefined);
    res.json((await db.query(`${SEL_USUARIO} WHERE u.id=$1`, [id]))[0]);
  });

  r.post("/usuarios/:id/reset-clave", soloAdmin, async (req, res) => {
    const id = idParam(req.params.id), pass = claveTemporal();
    const [u] = await db.query("UPDATE usuarios SET password_hash=$2, debe_cambiar_clave=TRUE, intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=$1 RETURNING username", [id, await bcrypt.hash(pass, 10)]);
    if (!u) throw new HttpError(404, "Usuario no encontrado");
    await audit(db, req, "RESET_PASSWORD", "usuario", id); res.json({ username: u.username, password_temporal: pass });
  });

  r.delete("/usuarios/:id", soloAdmin, async (req, res) => {
    const id = idParam(req.params.id);
    const [cur] = await db.query("SELECT * FROM usuarios WHERE id=$1", [id]);
    if (!cur) throw new HttpError(404, "Usuario no encontrado");
    if (id === req.user!.id) throw new HttpError(400, "No puede eliminar su propio usuario");
    if (cur.rol === "ADMIN" && cur.activo && (await adminsActivos(db, id)) === 0) throw new HttpError(400, "Debe quedar al menos un usuario de Dirección activo");
    try { await db.query("DELETE FROM usuarios WHERE id=$1", [id]); }
    catch (e: any) { if (e?.code === "23503") throw new HttpError(409, "Este usuario tiene historial en el sistema (citas, fichas o cobros) y no puede eliminarse. Desactívelo para impedir su acceso.", "TIENE_HISTORIAL"); throw e; }
    await audit(db, req, "ELIMINAR", "usuario", id, null, cur.username); res.json({ ok: true });
  });

  /* ---- Configuración del centro ---- */
  const CLAVES = ["nombre_centro", "enlace_encuesta", "mensaje_recordatorio", "texto_consentimiento", "version_consentimiento", "horario_inicio", "horario_fin", "hora_recordatorio", "email_avisos", "email_informe_semanal",
    "smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from", "smtp_seguro"] as const;
  r.get("/config", async (req, res) => {
    const rows = await db.query("SELECT clave, valor FROM config");
    const c: Record<string, string> = Object.fromEntries(rows.map((x) => [x.clave, x.valor]));
    const pass = Boolean(c.smtp_pass); delete c.smtp_pass; delete c.ultimo_recordatorio; delete c.ultimo_informe;
    if (req.user!.rol !== "ADMIN") { for (const k of ["smtp_host", "smtp_port", "smtp_user", "smtp_from", "smtp_seguro", "email_informe_semanal"]) delete c[k]; res.json(c); return; }
    res.json({ ...c, smtp_pass_configurada: pass ? "true" : "false" });
  });
  r.put("/config", soloAdmin, async (req, res) => {
    const d = parse(z.record(z.string(), z.string()), req.body);
    for (const [k, v0] of Object.entries(d)) {
      if (!(CLAVES as readonly string[]).includes(k)) throw new HttpError(400, `Clave de configuración no permitida: ${k}`);
      let v = v0.trim();
      if (k === "smtp_pass") { if (!v) continue; v = cifrar(v0); }                       // vacío = conservar la actual
      if ((k === "horario_inicio" || k === "horario_fin") && !/^([01]\d|2[0-3]):[03]0$/.test(v)) throw new HttpError(400, "Los horarios deben estar en bloques de 30 minutos (HH:00 o HH:30)");
      if (k === "hora_recordatorio" && !(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 23)) throw new HttpError(400, "La hora del recordatorio debe estar entre 0 y 23");
      if (k === "email_informe_semanal" && v && !z.email().safeParse(v).success) throw new HttpError(400, "Correo para el informe semanal inválido");
      if (k === "smtp_port" && v && !(Number(v) > 0 && Number(v) < 65536)) throw new HttpError(400, "Puerto SMTP inválido");
      await db.query("INSERT INTO config(clave, valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor", [k, v]);
    }
    await audit(db, req, "EDITAR", "config", null, null, Object.keys(d).filter((k) => k !== "smtp_pass").join(",")); res.json({ ok: true });
  });
  r.post("/correo/prueba", soloAdmin, async (req, res) => {
    const { to } = parse(z.object({ to: z.email("correo inválido") }), req.body);
    const out = await enviarCorreo(db, { to, subject: "Prueba de correo · Deva Aesthetic House", text: "Si recibes este mensaje, el envío automático de correos del sistema está funcionando correctamente." });
    await audit(db, req, "PRUEBA_CORREO", "config", null, null, out.ok ? "ok" : out.error);
    res.json(out);
  });
  return r;
}
