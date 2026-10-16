import { Router } from "express";
import nodemailer from "nodemailer";
import { z } from "zod";
import { config } from "../config.js";
import { soloAdmin } from "../auth.js";
import { hashToken, nuevoToken } from "../seguridad.js";
import { HttpError, audit, fechaSchema, hoy, parse, sumarDias, waLink, idParam } from "../util.js";
const MSG_DEFECTO = "Hola {nombre}, te recordamos tu cita en {centro}: {fecha} a las {hora} ({servicio}). Responde CONFIRMO o avísanos si necesitas reprogramar. ¡Te esperamos!";
async function cfg(q) {
    return Object.fromEntries((await q.query("SELECT clave, valor FROM config")).map((x) => [x.clave, x.valor]));
}
const fechaLarga = (f) => new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(f + "T12:00:00Z"));
const rellenar = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
async function citasDelDia(q, fecha) {
    return q.query(`SELECT c.id, c.fecha, c.hora, c.estado, c.paciente_id, p.nombre AS paciente, p.celular, p.email, s.nombre AS servicio, pr.nombre AS profesional
     FROM citas c JOIN pacientes p ON p.id=c.paciente_id JOIN servicios s ON s.id=c.servicio_id JOIN profesionales pr ON pr.id=c.profesional_id
     WHERE c.fecha=$1 AND c.estado IN ('AGENDADA','CONFIRMADA') ORDER BY c.hora`, [fecha]);
}
function mensajeRecordatorio(c, conf) {
    return rellenar(conf.mensaje_recordatorio || MSG_DEFECTO, { nombre: String(c.paciente).split(" ")[0], centro: conf.nombre_centro || "Deva Aesthetic House", fecha: fechaLarga(c.fecha), hora: c.hora, servicio: c.servicio, profesional: c.profesional });
}
export async function generarRecordatorios(db, fecha) {
    const conf = await cfg(db);
    const citas = await citasDelDia(db, fecha);
    let creadas = 0;
    for (const c of citas) {
        const msg = mensajeRecordatorio(c, conf);
        const canales = [c.celular ? "WHATSAPP" : null, c.email ? "EMAIL" : null].filter(Boolean);
        for (const canal of canales) {
            const r = await db.query("INSERT INTO notificaciones(cita_id,paciente_id,canal,tipo,mensaje) VALUES ($1,$2,$3,'RECORDATORIO',$4) ON CONFLICT (cita_id,canal,tipo) DO NOTHING RETURNING id", [c.id, c.paciente_id, canal, msg]);
            creadas += r.length;
        }
    }
    const correos = await enviarCorreosPendientes(db, conf);
    return { citas: citas.length, notificaciones_creadas: creadas, ...correos };
}
export async function enviarCorreosPendientes(db, conf) {
    const pendientes = await db.query("SELECT n.id, n.mensaje, p.email FROM notificaciones n JOIN pacientes p ON p.id=n.paciente_id WHERE n.canal='EMAIL' AND n.estado='PENDIENTE' AND n.tipo='RECORDATORIO' AND p.email IS NOT NULL");
    if (!config.smtp.host)
        return { correos_enviados: 0, correos_pendientes: pendientes.length, smtp: false };
    const tr = nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined });
    const centro = (conf ?? await cfg(db)).nombre_centro || "Deva Aesthetic House";
    let ok = 0;
    for (const n of pendientes) {
        try {
            await tr.sendMail({ from: config.smtp.from, to: n.email, subject: `Recordatorio de tu cita en ${centro}`, text: n.mensaje });
            await db.query("UPDATE notificaciones SET estado='ENVIADA', enviada_en=now() WHERE id=$1", [n.id]);
            ok++;
        }
        catch (e) {
            await db.query("UPDATE notificaciones SET estado='ERROR', detalle_error=$2 WHERE id=$1", [n.id, String(e.message).slice(0, 300)]);
        }
    }
    return { correos_enviados: ok, correos_pendientes: pendientes.length - ok, smtp: true };
}
export async function listarMantencion(q, fechaBase = hoy()) {
    return q.query(`SELECT p.id AS paciente_id, p.nombre, p.celular, p.email, s.id AS servicio_id, s.nombre AS servicio, s.intervalo_mantencion_dias AS intervalo,
            max(c.fecha) AS ultima_atencion, (max(c.fecha)::date + s.intervalo_mantencion_dias)::text AS fecha_limite
     FROM citas c JOIN pacientes p ON p.id=c.paciente_id JOIN servicios s ON s.id=c.servicio_id
     WHERE c.estado='REALIZADA' AND s.intervalo_mantencion_dias IS NOT NULL AND p.activo
     GROUP BY p.id, s.id
     HAVING (max(c.fecha)::date + s.intervalo_mantencion_dias) <= ($1::text)::date + 7
        AND NOT EXISTS (SELECT 1 FROM citas f WHERE f.paciente_id=p.id AND f.servicio_id=s.id AND f.fecha >= $1::text AND f.estado IN ('AGENDADA','CONFIRMADA'))
        AND NOT EXISTS (SELECT 1 FROM planes pl WHERE pl.paciente_id=p.id AND pl.servicio_id=s.id AND pl.estado='ACTIVO' AND pl.sesiones_realizadas < pl.sesiones_total)
     ORDER BY fecha_limite`, [fechaBase]);
}
export function seguimientoRoutes(db) {
    const r = Router();
    r.use("/seguimiento", soloAdmin);
    r.get("/seguimiento/recordatorios", async (req, res) => {
        const { fecha } = parse(z.object({ fecha: fechaSchema.default(sumarDias(hoy(), 1)) }), req.query);
        const conf = await cfg(db);
        const citas = await citasDelDia(db, fecha);
        const notifs = await db.query("SELECT cita_id, canal, estado FROM notificaciones WHERE tipo='RECORDATORIO' AND cita_id = ANY($1::int[])", [citas.map((c) => c.id)]);
        res.json({
            fecha,
            smtp_configurado: Boolean(config.smtp.host),
            items: citas.map((c) => {
                const mensaje = mensajeRecordatorio(c, conf);
                const estado = (canal) => notifs.find((n) => n.cita_id === c.id && n.canal === canal)?.estado ?? null;
                return { ...c, mensaje, wa_link: waLink(c.celular, mensaje), estado_whatsapp: estado("WHATSAPP"), estado_email: estado("EMAIL") };
            }),
        });
    });
    r.post("/seguimiento/recordatorios/generar", async (req, res) => {
        const { fecha } = parse(z.object({ fecha: fechaSchema.default(sumarDias(hoy(), 1)) }), req.body ?? {});
        const out = await generarRecordatorios(db, fecha);
        await audit(db, req, "GENERAR_RECORDATORIOS", "notificacion", null, null, `${fecha}: ${out.notificaciones_creadas}`);
        res.json(out);
    });
    r.post("/seguimiento/recordatorios/:citaId/whatsapp-enviado", async (req, res) => {
        const id = idParam(req.params.citaId);
        const [c] = await db.query("SELECT c.id, c.paciente_id, c.fecha, c.hora, p.nombre AS paciente, s.nombre AS servicio, pr.nombre AS profesional FROM citas c JOIN pacientes p ON p.id=c.paciente_id JOIN servicios s ON s.id=c.servicio_id JOIN profesionales pr ON pr.id=c.profesional_id WHERE c.id=$1", [id]);
        if (!c)
            throw new HttpError(404, "Cita no encontrada");
        const msg = mensajeRecordatorio(c, await cfg(db));
        await db.query("INSERT INTO notificaciones(cita_id,paciente_id,canal,tipo,mensaje,estado,enviada_en) VALUES ($1,$2,'WHATSAPP','RECORDATORIO',$3,'ENVIADA',now()) ON CONFLICT (cita_id,canal,tipo) DO UPDATE SET estado='ENVIADA', enviada_en=now()", [id, c.paciente_id, msg]);
        res.json({ ok: true });
    });
    r.get("/seguimiento/mantencion", async (_req, res) => {
        const conf = await cfg(db);
        const rows = await listarMantencion(db);
        res.json(rows.map((x) => {
            const mensaje = `Hola ${String(x.nombre).split(" ")[0]}, desde ${conf.nombre_centro || "Deva Aesthetic House"} te escribimos porque ya es momento de tu mantención de ${x.servicio}. ¿Te agendamos una hora?`;
            return { ...x, mensaje, wa_link: waLink(x.celular, mensaje) };
        }));
    });
    r.get("/seguimiento/controles", async (_req, res) => {
        const rows = await db.query(`SELECT s.id, s.paciente_id, s.texto, s.proximo_control, s.usuario_nombre, p.nombre, p.celular
       FROM seguimientos s JOIN pacientes p ON p.id=s.paciente_id
       WHERE s.proximo_control IS NOT NULL AND NOT s.control_resuelto AND p.activo ORDER BY s.proximo_control`);
        const conf = await cfg(db);
        res.json(rows.map((x) => {
            const mensaje = `Hola ${String(x.nombre).split(" ")[0]}, desde ${conf.nombre_centro || "Deva Aesthetic House"} te escribimos para coordinar tu control (${fechaLarga(x.proximo_control)}). ¿Te agendamos una hora?`;
            return { ...x, mensaje, wa_link: waLink(x.celular, mensaje), vencido: x.proximo_control < hoy() };
        }));
    });
    /**
     * Encuesta de satisfacción después de una atención. Por defecto usa la encuesta propia del sistema (NPS de 0 a 10, con enlace único);
     * si en Configuración se definió un enlace externo (p. ej. Google Forms), se usa ese.
     */
    r.post("/seguimiento/encuesta/:citaId", async (req, res) => {
        const conf = await cfg(db);
        const [c] = await db.query("SELECT c.id, c.estado, c.paciente_id, c.profesional_id, p.nombre, p.celular FROM citas c JOIN pacientes p ON p.id=c.paciente_id WHERE c.id=$1", [idParam(req.params.citaId)]);
        if (!c)
            throw new HttpError(404, "Cita no encontrada");
        if (c.estado !== "REALIZADA")
            throw new HttpError(400, "La encuesta se envía después de una atención realizada");
        let enlace = conf.enlace_encuesta;
        if (!enlace) {
            const [prev] = await db.query("SELECT respondida_en FROM encuestas WHERE cita_id=$1", [c.id]);
            if (prev?.respondida_en)
                throw new HttpError(409, "El paciente ya respondió la encuesta de esta atención");
            const token = nuevoToken();
            // Si ya existía un enlace sin responder, se reemplaza (en la base solo se guarda el hash, no se puede recuperar).
            await db.query(`INSERT INTO encuestas(cita_id,paciente_id,profesional_id,token_hash,expira_en) VALUES ($1,$2,$3,$4, now() + interval '30 days')
         ON CONFLICT (cita_id) DO UPDATE SET token_hash=EXCLUDED.token_hash, expira_en=EXCLUDED.expira_en, creada_en=now()`, [c.id, c.paciente_id, c.profesional_id, hashToken(token)]);
            enlace = `${config.publicUrl || `${req.protocol}://${req.get("host")}`}/encuesta/${token}`;
        }
        const mensaje = `Hola ${String(c.nombre).split(" ")[0]}, gracias por visitarnos en ${conf.nombre_centro || "Deva Aesthetic House"}. ¿Nos cuentas cómo fue tu experiencia? ${enlace}`;
        await db.query("INSERT INTO notificaciones(cita_id,paciente_id,canal,tipo,mensaje,estado,enviada_en) VALUES ($1,$2,'WHATSAPP','ENCUESTA',$3,'ENVIADA',now()) ON CONFLICT (cita_id,canal,tipo) DO UPDATE SET enviada_en=now()", [c.id, c.paciente_id, mensaje]);
        res.json({ mensaje, wa_link: waLink(c.celular, mensaje) });
    });
    return r;
}
