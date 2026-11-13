import { Router } from "express";
import { z } from "zod";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Db, Queryable } from "../db.js";
import { soloAdmin } from "../auth.js";
import { HttpError, audit, esViolacionUnica, fechaSchema, hoy, idParam, parse, rutSchema, limpiarRut } from "../util.js";

const fichaSchema = z.object({
  nombre: z.string().min(2, "ingrese el nombre completo"),
  rut: rutSchema,
  edad: z.number().int().min(0).max(120).nullish(),
  celular: z.string().max(30).nullish(),
  email: z.union([z.literal(""), z.email("correo inválido")]).nullish(),
  motivo: z.string().max(2000).nullish(),
  antecedentes: z.array(z.string()).default([]),
  medicamentos: z.string().max(2000).nullish(),
  otras: z.string().max(2000).nullish(),
});

// Las fuentes estándar del PDF solo admiten Latin-1: se reemplazan los caracteres no soportados.
const latin1 = (s: string) => String(s).replace(/→/g, "->").replace(/[^\u0000-\u00FF]/g, "?");

export function pacienteRoutes(db: Db) {
  const r = Router();

  async function puedeVer(req: any, pacienteId: number, q: Queryable = db): Promise<boolean> {
    if (req.user.rol === "ADMIN") return true;
    const rows = await q.query(
      "SELECT 1 FROM pacientes p WHERE p.id=$1 AND (p.creado_por=$2 OR EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id=p.id AND c.profesional_id=$3))",
      [pacienteId, req.user.id, req.user.profesionalId],
    );
    return rows.length > 0;
  }
  async function exigirAcceso(req: any, id: number) {
    const [p] = await db.query("SELECT id FROM pacientes WHERE id=$1 AND activo", [id]);
    if (!p) throw new HttpError(404, "Paciente no encontrado");
    if (!(await puedeVer(req, id))) throw new HttpError(403, "Solo puede ver pacientes que usted atiende o registró");
  }

  r.get("/pacientes", async (req, res) => {
    const q = String(req.query.q || "").trim();
    const like = `%${q}%`, rutLimpio = limpiarRut(q), rutLike = /\d/.test(rutLimpio) ? `%${rutLimpio}%` : null;
    const rows = await db.query(
      `SELECT p.id, p.rut, p.nombre, p.celular, p.email,
              EXISTS (SELECT 1 FROM consentimientos c WHERE c.paciente_id=p.id) AS tiene_consentimiento,
              (SELECT max(fecha) FROM citas c WHERE c.paciente_id=p.id AND c.estado='REALIZADA') AS ultima_atencion
       FROM pacientes p
       WHERE p.activo
         AND ($1 = '' OR p.nombre ILIKE $2 OR ($3::text IS NOT NULL AND replace(replace(p.rut,'.',''),'-','') ILIKE $3))
         AND ($4 = 'ADMIN' OR p.creado_por = $5 OR EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id=p.id AND c.profesional_id=$6))
       ORDER BY p.nombre LIMIT 200`,
      [q, like, rutLike, req.user!.rol, req.user!.id, req.user!.profesionalId],
    );
    res.json(rows);
  });

  r.post("/pacientes", async (req, res) => {
    const d = parse(fichaSchema, req.body);
    try {
      const out = await db.tx(async (t) => {
        const [p] = await t.query("INSERT INTO pacientes(rut,nombre,edad,celular,email,motivo,creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [d.rut, d.nombre.trim(), d.edad ?? null, d.celular ?? null, d.email || null, d.motivo ?? null, req.user!.id]);
        await t.query("INSERT INTO fichas(paciente_id, antecedentes, medicamentos, otras) VALUES ($1,$2,$3,$4)", [p.id, JSON.stringify(d.antecedentes), d.medicamentos ?? null, d.otras ?? null]);
        await audit(t, req, "CREAR_FICHA", "paciente", p.id, p.id);
        return p;
      });
      res.status(201).json({ id: out.id });
    } catch (e) { if (esViolacionUnica(e)) throw new HttpError(409, "Ya existe un paciente con ese RUT"); throw e; }
  });

  r.get("/pacientes/:id", async (req, res) => {
    const id = idParam(req.params.id);
    await exigirAcceso(req, id);
    const [p] = await db.query("SELECT p.*, f.antecedentes, f.medicamentos, f.otras FROM pacientes p JOIN fichas f ON f.paciente_id=p.id WHERE p.id=$1", [id]);
    const [planes, consentimientos, citas, ventas, seguimientos, versiones] = await Promise.all([
      db.query("SELECT pl.*, s.nombre AS servicio FROM planes pl JOIN servicios s ON s.id=pl.servicio_id WHERE pl.paciente_id=$1 ORDER BY pl.created_at DESC", [id]),
      db.query("SELECT c.id, c.tratamiento, c.version_texto, c.firmado_en FROM consentimientos c WHERE c.paciente_id=$1 ORDER BY c.firmado_en DESC", [id]),
      db.query(
        `SELECT c.id, c.fecha, c.hora, c.estado, c.nro_sesion, c.plan_id, c.notas, s.nombre AS servicio, pr.nombre AS profesional, b.nombre AS box,
                e.observaciones, e.procedimiento, e.recomendaciones, EXISTS (SELECT 1 FROM ventas v WHERE v.cita_id=c.id) AS pagada
         FROM citas c JOIN servicios s ON s.id=c.servicio_id JOIN profesionales pr ON pr.id=c.profesional_id JOIN boxes b ON b.id=c.box_id
         LEFT JOIN evoluciones e ON e.cita_id=c.id WHERE c.paciente_id=$1 ORDER BY c.fecha DESC, c.hora DESC`, [id]),
      db.query("SELECT COALESCE(sum(monto),0)::int AS total FROM ventas WHERE paciente_id=$1", [id]),
      db.query("SELECT s.id, s.tipo, s.texto, s.proximo_control, s.control_resuelto, s.cita_id, s.usuario_id, s.usuario_nombre, s.created_at, pr.nombre AS profesional FROM seguimientos s LEFT JOIN profesionales pr ON pr.id=s.profesional_id WHERE s.paciente_id=$1 ORDER BY s.created_at DESC", [id]),
      db.query("SELECT id, datos, usuario_nombre, created_at FROM ficha_versiones WHERE paciente_id=$1 ORDER BY id DESC LIMIT 20", [id]),
    ]);
    await audit(db, req, "VER_FICHA", "paciente", id, id);
    res.json({ ...p, planes, consentimientos, citas, seguimientos, versiones, total_comprado: req.user!.rol === "ADMIN" ? ventas[0].total : undefined });
  });

  r.put("/pacientes/:id", async (req, res) => {
    const id = idParam(req.params.id);
    await exigirAcceso(req, id);
    const d = parse(fichaSchema, req.body);
    try {
      await db.tx(async (t) => {
        const [ant] = await t.query("SELECT p.nombre,p.rut,p.edad,p.celular,p.email,p.motivo,f.antecedentes,f.medicamentos,f.otras FROM pacientes p JOIN fichas f ON f.paciente_id=p.id WHERE p.id=$1", [id]);
        const nuevo = { nombre: d.nombre.trim(), rut: d.rut, edad: d.edad ?? null, celular: d.celular ?? null, email: d.email || null, motivo: d.motivo ?? null, antecedentes: d.antecedentes, medicamentos: d.medicamentos ?? null, otras: d.otras ?? null };
        if (JSON.stringify(ant) !== JSON.stringify(nuevo)) await t.query("INSERT INTO ficha_versiones(paciente_id,datos,usuario_id,usuario_nombre) VALUES ($1,$2,$3,$4)", [id, JSON.stringify(ant), req.user!.id, req.user!.nombre]);
        await t.query("UPDATE pacientes SET rut=$2,nombre=$3,edad=$4,celular=$5,email=$6,motivo=$7 WHERE id=$1", [id, d.rut, d.nombre.trim(), d.edad ?? null, d.celular ?? null, d.email || null, d.motivo ?? null]);
        await t.query("UPDATE fichas SET antecedentes=$2, medicamentos=$3, otras=$4, updated_at=now() WHERE paciente_id=$1", [id, JSON.stringify(d.antecedentes), d.medicamentos ?? null, d.otras ?? null]);
        await audit(t, req, "EDITAR_FICHA", "paciente", id, id);
      });
      res.json({ ok: true });
    } catch (e) { if (esViolacionUnica(e)) throw new HttpError(409, "Ya existe otro paciente con ese RUT"); throw e; }
  });

  /* ---- Consentimiento informado digital ---- */
  r.post("/pacientes/:id/consentimientos", async (req, res) => {
    const id = idParam(req.params.id);
    await exigirAcceso(req, id);
    const d = parse(z.object({
      tratamiento: z.string().min(2),
      firma: z.string().startsWith("data:image/png;base64,", "la firma debe ser una imagen PNG").max(600_000, "firma demasiado grande"),
    }), req.body);
    const cfg = Object.fromEntries((await db.query("SELECT clave, valor FROM config")).map((x) => [x.clave, x.valor]));
    const [c] = await db.query("INSERT INTO consentimientos(paciente_id,tratamiento,version_texto,texto,firma,firmado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, firmado_en",
      [id, d.tratamiento, cfg.version_consentimiento || "v1", cfg.texto_consentimiento || "", d.firma, req.user!.id]);
    await audit(db, req, "FIRMAR_CONSENTIMIENTO", "consentimiento", c.id, id, d.tratamiento);
    res.status(201).json(c);
  });

  r.get("/consentimientos/:id/pdf", async (req, res) => {
    const [c] = await db.query("SELECT c.*, p.nombre, p.rut FROM consentimientos c JOIN pacientes p ON p.id=c.paciente_id WHERE c.id=$1", [idParam(req.params.id)]);
    if (!c) throw new HttpError(404, "Consentimiento no encontrado");
    if (!(await puedeVer(req, c.paciente_id))) throw new HttpError(403, "Sin acceso a este paciente");
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const plum = rgb(0.357, 0.165, 0.435);
    page.drawText("Deva Aesthetic House", { x: 50, y: 790, size: 20, font: bold, color: plum });
    page.drawText("Consentimiento informado", { x: 50, y: 765, size: 13, font, color: rgb(0.3, 0.3, 0.3) });
    const lineas = [`Paciente: ${c.nombre}`, `RUT: ${c.rut}`, `Tratamiento: ${c.tratamiento}`, `Fecha de firma: ${new Date(c.firmado_en).toLocaleString("es-CL", { timeZone: "America/Santiago" })}`, `Versión del texto: ${c.version_texto}`];
    lineas.forEach((l, i) => page.drawText(latin1(l), { x: 50, y: 725 - i * 18, size: 11, font }));
    // Texto con salto de línea simple por ancho
    let y = 610; const maxW = 495;
    for (const parrafo of latin1(c.texto).split("\n")) {
      let linea = "";
      for (const palabra of parrafo.split(" ")) {
        const prueba = linea ? `${linea} ${palabra}` : palabra;
        if (font.widthOfTextAtSize(prueba, 10.5) > maxW) { page.drawText(linea, { x: 50, y, size: 10.5, font }); y -= 15; linea = palabra; } else linea = prueba;
      }
      page.drawText(linea, { x: 50, y, size: 10.5, font }); y -= 20;
    }
    const png = await pdf.embedPng(Buffer.from(String(c.firma).split(",")[1], "base64"));
    const dims = png.scaleToFit(240, 90);
    page.drawImage(png, { x: 50, y: Math.max(90, y - dims.height - 20), width: dims.width, height: dims.height });
    page.drawLine({ start: { x: 50, y: Math.max(85, y - dims.height - 25) }, end: { x: 300, y: Math.max(85, y - dims.height - 25) }, thickness: 0.8, color: rgb(0.4, 0.4, 0.4) });
    page.drawText("Firma del paciente", { x: 50, y: Math.max(70, y - dims.height - 40), size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    await audit(db, req, "DESCARGAR_CONSENTIMIENTO", "consentimiento", c.id, c.paciente_id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="consentimiento_${limpiarRut(c.rut)}_${c.id}.pdf"`);
    res.send(Buffer.from(await pdf.save()));
  });

  /* ---- Seguimiento clínico (notas, llamadas, indicaciones, controles) ---- */
  r.post("/pacientes/:id/seguimientos", async (req, res) => {
    const id = idParam(req.params.id);
    await exigirAcceso(req, id);
    const d = parse(z.object({ tipo: z.enum(["NOTA", "LLAMADA", "INDICACION", "CONTROL"]), texto: z.string().min(3, "escriba el detalle"), proximo_control: fechaSchema.nullish(), cita_id: z.number().int().nullish() }), req.body);
    if (d.tipo === "CONTROL" && !d.proximo_control) throw new HttpError(400, "Indique la fecha del próximo control");
    const [s] = await db.query("INSERT INTO seguimientos(paciente_id,cita_id,tipo,texto,proximo_control,profesional_id,usuario_id,usuario_nombre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [id, d.cita_id ?? null, d.tipo, d.texto, d.proximo_control ?? null, req.user!.profesionalId, req.user!.id, req.user!.nombre]);
    await audit(db, req, "REGISTRAR_SEGUIMIENTO", "seguimiento", s.id, id, d.tipo);
    res.status(201).json(s);
  });
  async function seguimientoPropio(req: any) {
    const [s] = await db.query("SELECT * FROM seguimientos WHERE id=$1", [idParam(req.params.id)]);
    if (!s) throw new HttpError(404, "Registro no encontrado");
    if (req.user.rol !== "ADMIN" && s.usuario_id !== req.user.id) throw new HttpError(403, "Solo puede modificar sus propios registros");
    return s;
  }
  r.patch("/seguimientos/:id", async (req, res) => {
    const s = await seguimientoPropio(req);
    const d = parse(z.object({ texto: z.string().min(3).optional(), proximo_control: fechaSchema.nullish(), control_resuelto: z.boolean().optional() }), req.body);
    const [o] = await db.query("UPDATE seguimientos SET texto=$2, proximo_control=$3, control_resuelto=$4 WHERE id=$1 RETURNING *", [s.id, d.texto ?? s.texto, d.proximo_control === undefined ? s.proximo_control : d.proximo_control, d.control_resuelto ?? s.control_resuelto]);
    await audit(db, req, "EDITAR_SEGUIMIENTO", "seguimiento", s.id, s.paciente_id);
    res.json(o);
  });
  r.delete("/seguimientos/:id", async (req, res) => {
    const s = await seguimientoPropio(req);
    await db.query("DELETE FROM seguimientos WHERE id=$1", [s.id]);
    await audit(db, req, "ELIMINAR_SEGUIMIENTO", "seguimiento", s.id, s.paciente_id);
    res.json({ ok: true });
  });

  /* ---- Archivar paciente (no se borra: se conserva el historial) ---- */
  r.post("/pacientes/:id/archivar", soloAdmin, async (req, res) => {
    const id = idParam(req.params.id);
    const [fut] = await db.query("SELECT count(*)::int AS n FROM citas WHERE paciente_id=$1 AND fecha >= $2 AND estado IN ('AGENDADA','CONFIRMADA')", [id, hoy()]);
    if (fut.n) throw new HttpError(409, `El paciente tiene ${fut.n} cita(s) futura(s). Cancélelas o elimínelas antes de archivar.`);
    const [p] = await db.query("UPDATE pacientes SET activo=FALSE WHERE id=$1 RETURNING id", [id]);
    if (!p) throw new HttpError(404, "Paciente no encontrado");
    await audit(db, req, "ARCHIVAR_PACIENTE", "paciente", id, id);
    res.json({ ok: true });
  });

  /* ---- Historial clínico completo en PDF ---- */
  r.get("/pacientes/:id/historial.pdf", async (req, res) => {
    const id = idParam(req.params.id);
    await exigirAcceso(req, id);
    const [p] = await db.query("SELECT p.*, f.antecedentes, f.medicamentos, f.otras FROM pacientes p JOIN fichas f ON f.paciente_id=p.id WHERE p.id=$1", [id]);
    const [planes, citas, segs] = await Promise.all([
      db.query("SELECT pl.*, s.nombre AS servicio FROM planes pl JOIN servicios s ON s.id=pl.servicio_id WHERE pl.paciente_id=$1 ORDER BY pl.created_at", [id]),
      db.query("SELECT c.fecha, c.hora, c.estado, c.nro_sesion, s.nombre AS servicio, pr.nombre AS profesional, e.observaciones, e.procedimiento, e.recomendaciones FROM citas c JOIN servicios s ON s.id=c.servicio_id JOIN profesionales pr ON pr.id=c.profesional_id LEFT JOIN evoluciones e ON e.cita_id=c.id WHERE c.paciente_id=$1 AND c.estado <> 'CANCELADA' ORDER BY c.fecha, c.hora", [id]),
      db.query("SELECT tipo, texto, proximo_control, usuario_nombre, created_at FROM seguimientos WHERE paciente_id=$1 ORDER BY created_at", [id]),
    ]);
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([595, 842]), y = 800;
    const linea = (txt: string, o: { size?: number; b?: boolean; gap?: number } = {}) => {
      const size = o.size ?? 10, f = o.b ? bold : font; let l = "";
      const salto = () => { y -= size + 4; if (y < 60) { page = pdf.addPage([595, 842]); y = 800; } };
      for (const w of latin1(txt).split(" ")) {
        const prueba = l ? `${l} ${w}` : w;
        if (f.widthOfTextAtSize(prueba, size) > 495) { salto(); page.drawText(l, { x: 50, y, size, font: f }); l = w; } else l = prueba;
      }
      salto(); page.drawText(l, { x: 50, y, size, font: f }); y -= o.gap ?? 0;
    };
    const fch = (f: string) => f.split("-").reverse().join("-");
    linea("Deva Aesthetic House - Historial clínico", { size: 16, b: true, gap: 6 });
    linea(`Paciente: ${p.nombre}   RUT: ${p.rut}${p.edad ? `   Edad: ${p.edad}` : ""}`, { b: true });
    linea(`Contacto: ${p.celular || "-"}  ${p.email || ""}`);
    linea(`Emitido: ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })} por ${req.user!.nombre}`, { gap: 8 });
    linea("Ficha clínica", { b: true, size: 12 });
    linea(`Motivo de consulta: ${p.motivo || "-"}`);
    linea(`Antecedentes: ${(p.antecedentes as string[]).join(", ") || "sin antecedentes registrados"}`);
    linea(`Medicamentos: ${p.medicamentos || "-"}`); linea(`Otras enfermedades / observaciones: ${p.otras || "-"}`, { gap: 8 });
    linea("Planes de tratamiento", { b: true, size: 12 });
    if (!planes.length) linea("Sin planes registrados.");
    planes.forEach((pl) => linea(`- ${pl.servicio}: ${pl.sesiones_realizadas} de ${pl.sesiones_total} sesiones (${pl.estado})`));
    y -= 8; linea("Atenciones y evolución", { b: true, size: 12 });
    if (!citas.length) linea("Sin atenciones registradas.");
    citas.forEach((c) => {
      linea(`${fch(c.fecha)} ${c.hora} - ${c.servicio}${c.nro_sesion ? ` (sesión ${c.nro_sesion})` : ""} - ${c.profesional} - ${c.estado}`, { b: true });
      if (c.observaciones) linea(`   Evolución: ${c.observaciones}`);
      if (c.procedimiento) linea(`   Procedimiento: ${c.procedimiento}`);
      if (c.recomendaciones) linea(`   Recomendaciones: ${c.recomendaciones}`);
    });
    y -= 8; linea("Seguimiento", { b: true, size: 12 });
    if (!segs.length) linea("Sin registros de seguimiento.");
    segs.forEach((s) => linea(`${new Date(s.created_at).toLocaleDateString("es-CL", { timeZone: "America/Santiago" })} [${s.tipo}] ${s.texto}${s.proximo_control ? ` (próximo control: ${fch(s.proximo_control)})` : ""} - ${s.usuario_nombre ?? ""}`));
    await audit(db, req, "DESCARGAR_HISTORIAL", "paciente", id, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="historial_${limpiarRut(p.rut)}.pdf"`);
    res.send(Buffer.from(await pdf.save()));
  });

  /* ---- Planes de tratamiento (N° de sesiones) ---- */
  r.post("/pacientes/:id/planes", async (req, res) => {
    const id = idParam(req.params.id);
    await exigirAcceso(req, id);
    const d = parse(z.object({ servicio_id: z.number().int(), sesiones_total: z.number().int().min(1).max(60), origen: z.enum(["EVALUACION", "DERIVACION"]).default("EVALUACION") }), req.body);
    const [s] = await db.query("SELECT id FROM servicios WHERE id=$1 AND activo", [d.servicio_id]);
    if (!s) throw new HttpError(400, "Servicio no válido");
    const [pl] = await db.query("INSERT INTO planes(paciente_id,servicio_id,sesiones_total,origen) VALUES ($1,$2,$3,$4) RETURNING *", [id, d.servicio_id, d.sesiones_total, d.origen]);
    await audit(db, req, "CREAR_PLAN", "plan", pl.id, id, `${d.sesiones_total} sesiones`);
    res.status(201).json(pl);
  });
  r.patch("/planes/:id", async (req, res) => {
    const d = parse(z.object({ estado: z.enum(["ACTIVO", "COMPLETADO", "CANCELADO"]).optional(), sesiones_total: z.number().int().min(1).max(60).optional() }), req.body);
    const [cur] = await db.query("SELECT * FROM planes WHERE id=$1", [idParam(req.params.id)]);
    if (!cur) throw new HttpError(404, "Plan no encontrado");
    await exigirAcceso(req, cur.paciente_id);
    const total = d.sesiones_total ?? cur.sesiones_total;
    if (total < cur.sesiones_realizadas) throw new HttpError(400, "El total no puede ser menor a las sesiones ya realizadas");
    const [pl] = await db.query("UPDATE planes SET estado=$2, sesiones_total=$3 WHERE id=$1 RETURNING *", [cur.id, d.estado ?? cur.estado, total]);
    await audit(db, req, "EDITAR_PLAN", "plan", cur.id, cur.paciente_id);
    res.json(pl);
  });
  return r;
}
