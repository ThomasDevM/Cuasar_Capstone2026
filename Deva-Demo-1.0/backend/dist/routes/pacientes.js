import express, { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { soloAdmin } from "../auth.js";
import { config } from "../config.js";
import { cifrarBuffer, descifrarBuffer, tipoImagen } from "../seguridad.js";
import { HttpError, audit, canalSchema, esViolacionUnica, fechaSchema, hoy, idParam, parse, rutSchema, limpiarRut } from "../util.js";
const etiquetasLimpias = (e) => (e ? [...new Set(e.map((x) => x.toLowerCase()))] : undefined);
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
    // CRM
    fecha_nacimiento: z.union([z.literal(""), fechaSchema]).nullish(),
    canal_origen: canalSchema.nullish(),
    referido_por: z.number().int().nullish(),
    acepta_marketing: z.boolean().optional(),
    acepta_fotos: z.boolean().optional(),
    etiquetas: z.array(z.string().trim().min(1).max(30)).max(15).optional(),
});
// Las fuentes estándar del PDF solo admiten Latin-1: se reemplazan los caracteres no soportados.
const latin1 = (s) => String(s).replace(/→/g, "->").replace(/[^\u0000-\u00FF]/g, "?");
export function pacienteRoutes(db) {
    const r = Router();
    async function puedeVer(req, pacienteId, q = db) {
        if (req.user.rol === "ADMIN")
            return true;
        const rows = await q.query("SELECT 1 FROM pacientes p WHERE p.id=$1 AND (p.creado_por=$2 OR EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id=p.id AND c.profesional_id=$3))", [pacienteId, req.user.id, req.user.profesionalId]);
        return rows.length > 0;
    }
    async function exigirAcceso(req, id) {
        const [p] = await db.query("SELECT id FROM pacientes WHERE id=$1 AND activo", [id]);
        if (!p)
            throw new HttpError(404, "Paciente no encontrado");
        if (!(await puedeVer(req, id)))
            throw new HttpError(403, "Solo puede ver pacientes que usted atiende o registró");
    }
    r.get("/pacientes", async (req, res) => {
        const q = String(req.query.q || "").trim();
        const like = `%${q}%`, rutLimpio = limpiarRut(q), rutLike = /\d/.test(rutLimpio) ? `%${rutLimpio}%` : null;
        const rows = await db.query(`SELECT p.id, p.rut, p.nombre, p.celular, p.email,
              EXISTS (SELECT 1 FROM consentimientos c WHERE c.paciente_id=p.id) AS tiene_consentimiento,
              (SELECT max(fecha) FROM citas c WHERE c.paciente_id=p.id AND c.estado='REALIZADA') AS ultima_atencion
       FROM pacientes p
       WHERE p.activo
         AND ($1 = '' OR p.nombre ILIKE $2 OR ($3::text IS NOT NULL AND replace(replace(p.rut,'.',''),'-','') ILIKE $3))
         AND ($4 = 'ADMIN' OR p.creado_por = $5 OR EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id=p.id AND c.profesional_id=$6))
       ORDER BY p.nombre LIMIT 200`, [q, like, rutLike, req.user.rol, req.user.id, req.user.profesionalId]);
        res.json(rows);
    });
    r.post("/pacientes", async (req, res) => {
        const d = parse(fichaSchema, req.body);
        try {
            const out = await db.tx(async (t) => {
                const [p] = await t.query(`INSERT INTO pacientes(rut,nombre,edad,celular,email,motivo,creado_por,fecha_nacimiento,canal_origen,referido_por,acepta_marketing,marketing_actualizado_en,etiquetas,acepta_fotos,fotos_actualizado_en)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $11 THEN now() END, $12, $13, CASE WHEN $13 THEN now() END) RETURNING id`, [d.rut, d.nombre.trim(), d.edad ?? null, d.celular ?? null, d.email || null, d.motivo ?? null, req.user.id, d.fecha_nacimiento || null, d.canal_origen ?? null, d.referido_por ?? null, d.acepta_marketing ?? false, JSON.stringify(etiquetasLimpias(d.etiquetas) ?? []), d.acepta_fotos ?? false]);
                await t.query("INSERT INTO fichas(paciente_id, antecedentes, medicamentos, otras) VALUES ($1,$2,$3,$4)", [p.id, JSON.stringify(d.antecedentes), d.medicamentos ?? null, d.otras ?? null]);
                await audit(t, req, "CREAR_FICHA", "paciente", p.id, p.id);
                if (d.acepta_marketing)
                    await audit(t, req, "CONSENTIMIENTO_MARKETING", "paciente", p.id, p.id, "otorgado");
                if (d.acepta_fotos)
                    await audit(t, req, "CONSENTIMIENTO_FOTOS", "paciente", p.id, p.id, "otorgado");
                return p;
            });
            res.status(201).json({ id: out.id });
        }
        catch (e) {
            if (esViolacionUnica(e))
                throw new HttpError(409, "Ya existe un paciente con ese RUT");
            throw e;
        }
    });
    r.get("/pacientes/:id", async (req, res) => {
        const id = idParam(req.params.id);
        await exigirAcceso(req, id);
        const [p] = await db.query("SELECT p.*, f.antecedentes, f.medicamentos, f.otras, r.nombre AS referido_por_nombre FROM pacientes p JOIN fichas f ON f.paciente_id=p.id LEFT JOIN pacientes r ON r.id=p.referido_por WHERE p.id=$1", [id]);
        const admin = req.user.rol === "ADMIN";
        const [presupuestos, encuestas, referidos] = await Promise.all([
            admin ? db.query("SELECT id, fecha, estado, total, validez_dias, (fecha::date + validez_dias) < $2::date AS vencido FROM presupuestos WHERE paciente_id=$1 ORDER BY id DESC", [id, hoy()]) : Promise.resolve([]),
            admin ? db.query("SELECT e.id, e.puntaje, e.comentario, e.respondida_en, e.gestionada, s.nombre AS servicio FROM encuestas e LEFT JOIN citas c ON c.id=e.cita_id LEFT JOIN servicios s ON s.id=c.servicio_id WHERE e.paciente_id=$1 AND e.respondida_en IS NOT NULL ORDER BY e.respondida_en DESC", [id]) : Promise.resolve([]),
            admin ? db.query("SELECT id, nombre FROM pacientes WHERE referido_por=$1 AND activo ORDER BY nombre", [id]) : Promise.resolve([]),
        ]);
        const [planes, consentimientos, citas, ventas, seguimientos, versiones, fotos] = await Promise.all([
            db.query("SELECT pl.*, s.nombre AS servicio FROM planes pl JOIN servicios s ON s.id=pl.servicio_id WHERE pl.paciente_id=$1 ORDER BY pl.created_at DESC", [id]),
            db.query("SELECT c.id, c.tratamiento, c.version_texto, c.firmado_en FROM consentimientos c WHERE c.paciente_id=$1 ORDER BY c.firmado_en DESC", [id]),
            db.query(`SELECT c.id, c.fecha, c.hora, c.estado, c.nro_sesion, c.plan_id, c.notas, s.nombre AS servicio, pr.nombre AS profesional, b.nombre AS box,
                e.observaciones, e.procedimiento, e.recomendaciones, EXISTS (SELECT 1 FROM ventas v WHERE v.cita_id=c.id) AS pagada
         FROM citas c JOIN servicios s ON s.id=c.servicio_id JOIN profesionales pr ON pr.id=c.profesional_id JOIN boxes b ON b.id=c.box_id
         LEFT JOIN evoluciones e ON e.cita_id=c.id WHERE c.paciente_id=$1 ORDER BY c.fecha DESC, c.hora DESC`, [id]),
            db.query("SELECT COALESCE(sum(monto),0)::int AS total FROM ventas WHERE paciente_id=$1", [id]),
            db.query("SELECT s.id, s.tipo, s.texto, s.proximo_control, s.control_resuelto, s.cita_id, s.usuario_id, s.usuario_nombre, s.created_at, pr.nombre AS profesional FROM seguimientos s LEFT JOIN profesionales pr ON pr.id=s.profesional_id WHERE s.paciente_id=$1 ORDER BY s.created_at DESC", [id]),
            db.query("SELECT id, datos, usuario_nombre, created_at FROM ficha_versiones WHERE paciente_id=$1 ORDER BY id DESC LIMIT 20", [id]),
            db.query("SELECT id, cita_id, tipo, nota, mime, bytes, autor_id, autor_nombre, created_at FROM fotos WHERE paciente_id=$1 ORDER BY created_at", [id]),
        ]);
        await audit(db, req, "VER_FICHA", "paciente", id, id);
        res.json({ ...p, planes, consentimientos, citas, seguimientos, versiones, fotos, presupuestos, encuestas, referidos, total_comprado: admin ? ventas[0].total : undefined });
    });
    r.put("/pacientes/:id", async (req, res) => {
        const id = idParam(req.params.id);
        await exigirAcceso(req, id);
        const d = parse(fichaSchema, req.body);
        try {
            await db.tx(async (t) => {
                const [ant] = await t.query("SELECT p.nombre,p.rut,p.edad,p.celular,p.email,p.motivo,f.antecedentes,f.medicamentos,f.otras FROM pacientes p JOIN fichas f ON f.paciente_id=p.id WHERE p.id=$1", [id]);
                const nuevo = { nombre: d.nombre.trim(), rut: d.rut, edad: d.edad ?? null, celular: d.celular ?? null, email: d.email || null, motivo: d.motivo ?? null, antecedentes: d.antecedentes, medicamentos: d.medicamentos ?? null, otras: d.otras ?? null };
                if (JSON.stringify(ant) !== JSON.stringify(nuevo))
                    await t.query("INSERT INTO ficha_versiones(paciente_id,datos,usuario_id,usuario_nombre) VALUES ($1,$2,$3,$4)", [id, JSON.stringify(ant), req.user.id, req.user.nombre]);
                if (d.referido_por === id)
                    throw new HttpError(400, "Un paciente no puede ser referido por sí mismo");
                const [crm] = await t.query("SELECT acepta_marketing, acepta_fotos, etiquetas, canal_origen, referido_por, fecha_nacimiento FROM pacientes WHERE id=$1", [id]);
                const marketing = d.acepta_marketing ?? crm.acepta_marketing;
                const fotos = d.acepta_fotos ?? crm.acepta_fotos;
                await t.query(`UPDATE pacientes SET rut=$2,nombre=$3,edad=$4,celular=$5,email=$6,motivo=$7,fecha_nacimiento=$8,canal_origen=$9,referido_por=$10,
                  acepta_marketing=$11, marketing_actualizado_en = CASE WHEN $11 <> acepta_marketing THEN now() ELSE marketing_actualizado_en END, etiquetas=$12,
                  acepta_fotos=$13, fotos_actualizado_en = CASE WHEN $13 <> acepta_fotos THEN now() ELSE fotos_actualizado_en END WHERE id=$1`, [id, d.rut, d.nombre.trim(), d.edad ?? null, d.celular ?? null, d.email || null, d.motivo ?? null,
                    d.fecha_nacimiento === undefined ? crm.fecha_nacimiento : d.fecha_nacimiento || null, d.canal_origen === undefined ? crm.canal_origen : d.canal_origen,
                    d.referido_por === undefined ? crm.referido_por : d.referido_por, marketing, JSON.stringify(etiquetasLimpias(d.etiquetas) ?? crm.etiquetas), fotos]);
                await t.query("UPDATE fichas SET antecedentes=$2, medicamentos=$3, otras=$4, updated_at=now() WHERE paciente_id=$1", [id, JSON.stringify(d.antecedentes), d.medicamentos ?? null, d.otras ?? null]);
                await audit(t, req, "EDITAR_FICHA", "paciente", id, id);
                if (marketing !== crm.acepta_marketing)
                    await audit(t, req, "CONSENTIMIENTO_MARKETING", "paciente", id, id, marketing ? "otorgado" : "retirado");
                if (fotos !== crm.acepta_fotos)
                    await audit(t, req, "CONSENTIMIENTO_FOTOS", "paciente", id, id, fotos ? "otorgado" : "retirado");
            });
            res.json({ ok: true });
        }
        catch (e) {
            if (esViolacionUnica(e))
                throw new HttpError(409, "Ya existe otro paciente con ese RUT");
            throw e;
        }
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
        const [c] = await db.query("INSERT INTO consentimientos(paciente_id,tratamiento,version_texto,texto,firma,firmado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, firmado_en", [id, d.tratamiento, cfg.version_consentimiento || "v1", cfg.texto_consentimiento || "", d.firma, req.user.id]);
        await audit(db, req, "FIRMAR_CONSENTIMIENTO", "consentimiento", c.id, id, d.tratamiento);
        res.status(201).json(c);
    });
    r.get("/consentimientos/:id/pdf", async (req, res) => {
        const [c] = await db.query("SELECT c.*, p.nombre, p.rut FROM consentimientos c JOIN pacientes p ON p.id=c.paciente_id WHERE c.id=$1", [idParam(req.params.id)]);
        if (!c)
            throw new HttpError(404, "Consentimiento no encontrado");
        if (!(await puedeVer(req, c.paciente_id)))
            throw new HttpError(403, "Sin acceso a este paciente");
        const pdf = await PDFDocument.create();
        const page = pdf.addPage([595, 842]);
        const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        const plum = rgb(0.357, 0.165, 0.435);
        page.drawText("Deva Aesthetic House", { x: 50, y: 790, size: 20, font: bold, color: plum });
        page.drawText("Consentimiento informado", { x: 50, y: 765, size: 13, font, color: rgb(0.3, 0.3, 0.3) });
        const lineas = [`Paciente: ${c.nombre}`, `RUT: ${c.rut}`, `Tratamiento: ${c.tratamiento}`, `Fecha de firma: ${new Date(c.firmado_en).toLocaleString("es-CL", { timeZone: "America/Santiago" })}`, `Versión del texto: ${c.version_texto}`];
        lineas.forEach((l, i) => page.drawText(latin1(l), { x: 50, y: 725 - i * 18, size: 11, font }));
        // Texto con salto de línea simple por ancho
        let y = 610;
        const maxW = 495;
        for (const parrafo of latin1(c.texto).split("\n")) {
            let linea = "";
            for (const palabra of parrafo.split(" ")) {
                const prueba = linea ? `${linea} ${palabra}` : palabra;
                if (font.widthOfTextAtSize(prueba, 10.5) > maxW) {
                    page.drawText(linea, { x: 50, y, size: 10.5, font });
                    y -= 15;
                    linea = palabra;
                }
                else
                    linea = prueba;
            }
            page.drawText(linea, { x: 50, y, size: 10.5, font });
            y -= 20;
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
        if (d.tipo === "CONTROL" && !d.proximo_control)
            throw new HttpError(400, "Indique la fecha del próximo control");
        const [s] = await db.query("INSERT INTO seguimientos(paciente_id,cita_id,tipo,texto,proximo_control,profesional_id,usuario_id,usuario_nombre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [id, d.cita_id ?? null, d.tipo, d.texto, d.proximo_control ?? null, req.user.profesionalId, req.user.id, req.user.nombre]);
        await audit(db, req, "REGISTRAR_SEGUIMIENTO", "seguimiento", s.id, id, d.tipo);
        res.status(201).json(s);
    });
    async function seguimientoPropio(req) {
        const [s] = await db.query("SELECT * FROM seguimientos WHERE id=$1", [idParam(req.params.id)]);
        if (!s)
            throw new HttpError(404, "Registro no encontrado");
        if (req.user.rol !== "ADMIN" && s.usuario_id !== req.user.id)
            throw new HttpError(403, "Solo puede modificar sus propios registros");
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
        if (fut.n)
            throw new HttpError(409, `El paciente tiene ${fut.n} cita(s) futura(s). Cancélelas o elimínelas antes de archivar.`);
        const [p] = await db.query("UPDATE pacientes SET activo=FALSE WHERE id=$1 RETURNING id", [id]);
        if (!p)
            throw new HttpError(404, "Paciente no encontrado");
        await audit(db, req, "ARCHIVAR_PACIENTE", "paciente", id, id);
        res.json({ ok: true });
    });
    /* ---- Consentimiento de comunicaciones comerciales (se puede retirar en cualquier momento) ---- */
    r.post("/pacientes/:id/marketing", async (req, res) => {
        const id = idParam(req.params.id);
        await exigirAcceso(req, id);
        const { acepta } = parse(z.object({ acepta: z.boolean() }), req.body);
        const [p] = await db.query("UPDATE pacientes SET acepta_marketing=$2, marketing_actualizado_en=now() WHERE id=$1 AND acepta_marketing <> $2 RETURNING id", [id, acepta]);
        if (p) {
            // Si retira el consentimiento, se excluye de las campañas aún no enviadas.
            if (!acepta)
                await db.query("UPDATE campana_destinatarios SET estado='EXCLUIDO', detalle='Retiró el consentimiento' WHERE paciente_id=$1 AND estado='PENDIENTE'", [id]);
            await audit(db, req, "CONSENTIMIENTO_MARKETING", "paciente", id, id, acepta ? "otorgado" : "retirado");
        }
        res.json({ ok: true, acepta_marketing: acepta });
    });
    /* ---- Consentimiento específico para fotografías clínicas (independiente del consentimiento del tratamiento) ---- */
    r.post("/pacientes/:id/consentimiento-fotos", async (req, res) => {
        const id = idParam(req.params.id);
        await exigirAcceso(req, id);
        const { acepta } = parse(z.object({ acepta: z.boolean() }), req.body);
        const [p] = await db.query("UPDATE pacientes SET acepta_fotos=$2, fotos_actualizado_en=now() WHERE id=$1 AND acepta_fotos <> $2 RETURNING fotos_actualizado_en", [id, acepta]);
        if (p)
            await audit(db, req, "CONSENTIMIENTO_FOTOS", "paciente", id, id, acepta ? "otorgado" : "retirado");
        res.json({ ok: true, acepta_fotos: acepta });
    });
    /* ---- Fotos clínicas antes/después: cifradas en disco, fuera de la carpeta pública ---- */
    async function dirFotos() {
        const dir = path.resolve(config.dataDir, "fotos");
        const pub = path.resolve(config.staticDir);
        if (dir === pub || dir.startsWith(pub + path.sep))
            throw new Error("DATA_DIR no puede estar dentro de la carpeta pública del frontend");
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        return dir;
    }
    const archivoFoto = async (nombre) => path.join(await dirFotos(), nombre);
    const accesoAntesDeLeer = async (req, _res, next) => { await exigirAcceso(req, idParam(req.params.id)); next(); };
    r.post("/pacientes/:id/fotos", accesoAntesDeLeer, express.raw({ type: () => true, limit: config.fotoMaxBytes }), async (req, res) => {
        const id = idParam(req.params.id);
        const d = parse(z.object({ cita_id: z.coerce.number().int().positive("indique la sesión"), tipo: z.enum(["ANTES", "DESPUES", "OTRA"]) }), req.query);
        let nota = null;
        try {
            nota = req.get("x-nota") ? decodeURIComponent(req.get("x-nota")).trim().slice(0, 500) || null : null;
        }
        catch {
            throw new HttpError(400, "Nota inválida");
        }
        const [p] = await db.query("SELECT acepta_fotos FROM pacientes WHERE id=$1", [id]);
        if (!p.acepta_fotos)
            throw new HttpError(403, "El paciente no ha autorizado el registro de fotografías clínicas", "CONSENTIMIENTO_FOTOS_REQUERIDO");
        const [c] = await db.query("SELECT id, estado FROM citas WHERE id=$1 AND paciente_id=$2", [d.cita_id, id]);
        if (!c)
            throw new HttpError(400, "La sesión no corresponde a este paciente");
        if (c.estado === "CANCELADA")
            throw new HttpError(400, "No se pueden asociar fotos a una cita cancelada");
        const img = req.body;
        if (!Buffer.isBuffer(img) || img.length === 0)
            throw new HttpError(400, "Adjunte una imagen");
        const mime = tipoImagen(img);
        if (!mime)
            throw new HttpError(415, "Solo se aceptan imágenes JPEG o PNG");
        const nombre = `${crypto.randomUUID()}.enc`, ruta = await archivoFoto(nombre);
        await fs.writeFile(ruta, cifrarBuffer(img), { flag: "wx", mode: 0o600 });
        try {
            const f = await db.tx(async (t) => {
                const [f] = await t.query("INSERT INTO fotos(paciente_id,cita_id,tipo,nota,archivo,mime,bytes,sha256,autor_id,autor_nombre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, cita_id, tipo, nota, mime, bytes, autor_id, autor_nombre, created_at", [id, c.id, d.tipo, nota, nombre, mime, img.length, crypto.createHash("sha256").update(img).digest("hex"), req.user.id, req.user.nombre]);
                await audit(t, req, "SUBIR_FOTO", "foto", f.id, id, `${d.tipo} · cita ${c.id}`);
                return f;
            });
            res.status(201).json(f);
        }
        catch (e) {
            await fs.rm(ruta, { force: true });
            throw e;
        }
    });
    async function fotoConAcceso(req) {
        const [f] = await db.query("SELECT * FROM fotos WHERE id=$1", [idParam(req.params.id)]);
        if (!f)
            throw new HttpError(404, "Foto no encontrada");
        await exigirAcceso(req, f.paciente_id);
        return f;
    }
    r.get("/fotos/:id/imagen", async (req, res) => {
        const f = await fotoConAcceso(req);
        let img;
        try {
            img = descifrarBuffer(await fs.readFile(await archivoFoto(f.archivo)));
        }
        catch (e) {
            if (e?.code === "ENOENT")
                throw new HttpError(404, "El archivo de la foto no está disponible");
            throw new HttpError(500, "No se pudo descifrar la foto (archivo alterado o clave distinta)");
        }
        await audit(db, req, "VER_FOTO", "foto", f.id, f.paciente_id);
        res.setHeader("Content-Type", f.mime);
        res.setHeader("Cache-Control", "no-store, private");
        res.setHeader("Content-Disposition", `inline; filename="foto_${f.id}.${f.mime === "image/png" ? "png" : "jpg"}"`);
        res.send(img);
    });
    r.delete("/fotos/:id", async (req, res) => {
        const f = await fotoConAcceso(req);
        if (req.user.rol !== "ADMIN" && f.autor_id !== req.user.id)
            throw new HttpError(403, "Solo quien subió la foto o Dirección puede eliminarla");
        await db.tx(async (t) => {
            await t.query("DELETE FROM fotos WHERE id=$1", [f.id]);
            await audit(t, req, "ELIMINAR_FOTO", "foto", f.id, f.paciente_id, `${f.tipo} · cita ${f.cita_id}`);
        });
        await fs.rm(await archivoFoto(f.archivo), { force: true });
        res.json({ ok: true });
    });
    /* ---- Derecho de acceso y portabilidad (Ley 19.628 / Ley 21.719): todos los datos del paciente en formato estructurado ---- */
    r.get("/pacientes/:id/exportar", soloAdmin, async (req, res) => {
        const id = idParam(req.params.id);
        const [p] = await db.query("SELECT p.id, p.rut, p.nombre, p.edad, p.fecha_nacimiento, p.celular, p.email, p.motivo, p.canal_origen, p.acepta_marketing, p.marketing_actualizado_en, p.acepta_fotos, p.fotos_actualizado_en, p.etiquetas, p.activo, p.created_at, f.antecedentes, f.medicamentos, f.otras FROM pacientes p JOIN fichas f ON f.paciente_id=p.id WHERE p.id=$1", [id]);
        if (!p)
            throw new HttpError(404, "Paciente no encontrado");
        const q = (sql) => db.query(sql, [id]);
        const [consentimientos, planes, citas, evoluciones, seguimientos, ventas, presupuestos, encuestas, fotos] = await Promise.all([
            q("SELECT tratamiento, version_texto, texto, firmado_en FROM consentimientos WHERE paciente_id=$1 ORDER BY firmado_en"),
            q("SELECT s.nombre AS servicio, pl.sesiones_total, pl.sesiones_realizadas, pl.estado, pl.origen, pl.created_at FROM planes pl JOIN servicios s ON s.id=pl.servicio_id WHERE pl.paciente_id=$1 ORDER BY pl.id"),
            q("SELECT c.fecha, c.hora, c.estado, c.nro_sesion, s.nombre AS servicio, pr.nombre AS profesional, c.notas FROM citas c JOIN servicios s ON s.id=c.servicio_id JOIN profesionales pr ON pr.id=c.profesional_id WHERE c.paciente_id=$1 ORDER BY c.fecha, c.hora"),
            q("SELECT c.fecha, e.observaciones, e.procedimiento, e.recomendaciones FROM evoluciones e JOIN citas c ON c.id=e.cita_id WHERE e.paciente_id=$1 ORDER BY c.fecha"),
            q("SELECT tipo, texto, proximo_control, usuario_nombre, created_at FROM seguimientos WHERE paciente_id=$1 ORDER BY created_at"),
            q("SELECT fecha, descripcion, monto, medio_pago, nro_boleta FROM ventas WHERE paciente_id=$1 ORDER BY fecha"),
            q("SELECT pr.fecha, pr.estado, pr.total, json_agg(json_build_object('descripcion', i.descripcion, 'sesiones', i.sesiones, 'precio_unitario', i.precio_unitario)) AS items FROM presupuestos pr JOIN presupuesto_items i ON i.presupuesto_id=pr.id WHERE pr.paciente_id=$1 GROUP BY pr.id ORDER BY pr.id"),
            q("SELECT puntaje, comentario, respondida_en FROM encuestas WHERE paciente_id=$1 AND respondida_en IS NOT NULL ORDER BY respondida_en"),
            // Solo los datos de cada foto; las imágenes se entregan por separado a solicitud del titular.
            q("SELECT f.id, c.fecha AS fecha_sesion, f.tipo, f.nota, f.mime, f.bytes, f.sha256, f.created_at FROM fotos f JOIN citas c ON c.id=f.cita_id WHERE f.paciente_id=$1 ORDER BY f.created_at"),
        ]);
        await audit(db, req, "EXPORTAR_DATOS_PACIENTE", "paciente", id, id);
        res.setHeader("Content-Disposition", `attachment; filename="datos_paciente_${limpiarRut(p.rut)}.json"`);
        res.json({ generado_en: new Date().toISOString(), responsable: "Deva Aesthetic House", titular: p, consentimientos, planes, citas, evoluciones, seguimientos, compras: ventas, presupuestos, encuestas, fotos });
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
        const linea = (txt, o = {}) => {
            const size = o.size ?? 10, f = o.b ? bold : font;
            let l = "";
            const salto = () => { y -= size + 4; if (y < 60) {
                page = pdf.addPage([595, 842]);
                y = 800;
            } };
            for (const w of latin1(txt).split(" ")) {
                const prueba = l ? `${l} ${w}` : w;
                if (f.widthOfTextAtSize(prueba, size) > 495) {
                    salto();
                    page.drawText(l, { x: 50, y, size, font: f });
                    l = w;
                }
                else
                    l = prueba;
            }
            salto();
            page.drawText(l, { x: 50, y, size, font: f });
            y -= o.gap ?? 0;
        };
        const fch = (f) => f.split("-").reverse().join("-");
        linea("Deva Aesthetic House - Historial clínico", { size: 16, b: true, gap: 6 });
        linea(`Paciente: ${p.nombre}   RUT: ${p.rut}${p.edad ? `   Edad: ${p.edad}` : ""}`, { b: true });
        linea(`Contacto: ${p.celular || "-"}  ${p.email || ""}`);
        linea(`Emitido: ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })} por ${req.user.nombre}`, { gap: 8 });
        linea("Ficha clínica", { b: true, size: 12 });
        linea(`Motivo de consulta: ${p.motivo || "-"}`);
        linea(`Antecedentes: ${p.antecedentes.join(", ") || "sin antecedentes registrados"}`);
        linea(`Medicamentos: ${p.medicamentos || "-"}`);
        linea(`Otras enfermedades / observaciones: ${p.otras || "-"}`, { gap: 8 });
        linea("Planes de tratamiento", { b: true, size: 12 });
        if (!planes.length)
            linea("Sin planes registrados.");
        planes.forEach((pl) => linea(`- ${pl.servicio}: ${pl.sesiones_realizadas} de ${pl.sesiones_total} sesiones (${pl.estado})`));
        y -= 8;
        linea("Atenciones y evolución", { b: true, size: 12 });
        if (!citas.length)
            linea("Sin atenciones registradas.");
        citas.forEach((c) => {
            linea(`${fch(c.fecha)} ${c.hora} - ${c.servicio}${c.nro_sesion ? ` (sesión ${c.nro_sesion})` : ""} - ${c.profesional} - ${c.estado}`, { b: true });
            if (c.observaciones)
                linea(`   Evolución: ${c.observaciones}`);
            if (c.procedimiento)
                linea(`   Procedimiento: ${c.procedimiento}`);
            if (c.recomendaciones)
                linea(`   Recomendaciones: ${c.recomendaciones}`);
        });
        y -= 8;
        linea("Seguimiento", { b: true, size: 12 });
        if (!segs.length)
            linea("Sin registros de seguimiento.");
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
        if (!s)
            throw new HttpError(400, "Servicio no válido");
        const [pl] = await db.query("INSERT INTO planes(paciente_id,servicio_id,sesiones_total,origen) VALUES ($1,$2,$3,$4) RETURNING *", [id, d.servicio_id, d.sesiones_total, d.origen]);
        await audit(db, req, "CREAR_PLAN", "plan", pl.id, id, `${d.sesiones_total} sesiones`);
        res.status(201).json(pl);
    });
    r.patch("/planes/:id", async (req, res) => {
        const d = parse(z.object({ estado: z.enum(["ACTIVO", "COMPLETADO", "CANCELADO"]).optional(), sesiones_total: z.number().int().min(1).max(60).optional() }), req.body);
        const [cur] = await db.query("SELECT * FROM planes WHERE id=$1", [idParam(req.params.id)]);
        if (!cur)
            throw new HttpError(404, "Plan no encontrado");
        await exigirAcceso(req, cur.paciente_id);
        const total = d.sesiones_total ?? cur.sesiones_total;
        if (total < cur.sesiones_realizadas)
            throw new HttpError(400, "El total no puede ser menor a las sesiones ya realizadas");
        const [pl] = await db.query("UPDATE planes SET estado=$2, sesiones_total=$3 WHERE id=$1 RETURNING *", [cur.id, d.estado ?? cur.estado, total]);
        await audit(db, req, "EDITAR_PLAN", "plan", cur.id, cur.paciente_id);
        res.json(pl);
    });
    return r;
}
