import nodemailer from "nodemailer";
import crypto from "node:crypto";
import { config } from "./config.js";
import type { Db, Queryable } from "./db.js";

/* ---------- Cifrado de la clave SMTP guardada en la base de datos ---------- */
const clave = () => crypto.createHash("sha256").update("deva-smtp:" + config.jwtSecret).digest();
export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", clave(), iv);
  const data = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["enc", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}
export function descifrar(valor: string): string {
  if (!valor.startsWith("enc:")) return valor;
  const [, iv, tag, data] = valor.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", clave(), Buffer.from(iv, "base64")); d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export async function leerAjustes(q: Queryable): Promise<Record<string, string>> {
  return Object.fromEntries((await q.query("SELECT clave, valor FROM config")).map((x) => [x.clave, x.valor]));
}

export interface Smtp { host: string; port: number; user: string; pass: string; from: string; secure: boolean }
/** Configuración guardada en el sistema; si no existe, variables de entorno. */
export function smtpDe(aj: Record<string, string>): Smtp | null {
  const host = aj.smtp_host || config.smtp.host;
  if (!host) return null;
  const port = Number(aj.smtp_host ? aj.smtp_port || 587 : config.smtp.port);
  let pass = "";
  try { pass = aj.smtp_host ? descifrar(aj.smtp_pass || "") : config.smtp.pass; } catch { pass = ""; }
  return { host, port, user: aj.smtp_host ? aj.smtp_user || "" : config.smtp.user, pass, from: aj.smtp_from || config.smtp.from, secure: aj.smtp_seguro ? aj.smtp_seguro === "true" : port === 465 };
}
export const correoConfigurado = async (q: Queryable) => smtpDe(await leerAjustes(q)) !== null;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function plantillaHtml(centro: string, titulo: string, texto: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#2B2233">
<div style="background:#B67389;color:#fff;padding:14px 22px;border-radius:10px 10px 0 0;font-size:18px">${esc(centro)}</div>
<div style="border:1px solid #E7DCE3;border-top:0;padding:22px;border-radius:0 0 10px 10px">
<h3 style="color:#5B2A6F;margin-top:0">${esc(titulo)}</h3><p style="line-height:1.5;white-space:pre-line">${esc(texto)}</p>
<p style="font-size:12px;color:#6B5B73;margin-top:24px">Este es un aviso automático. Para cambios o consultas, responda por WhatsApp al centro.</p></div></div>`;
}

export async function enviarCorreo(db: Queryable, o: { to: string; subject: string; text: string; titulo?: string; attachments?: { filename: string; content: Buffer }[] }): Promise<{ ok: boolean; error?: string }> {
  const aj = await leerAjustes(db), smtp = smtpDe(aj);
  if (!smtp) return { ok: false, error: "El correo saliente no está configurado" };
  try {
    const tr = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, tls: { rejectUnauthorized: false } });
    await tr.sendMail({ from: smtp.from, to: o.to, subject: o.subject, text: o.text, html: plantillaHtml(aj.nombre_centro || "Deva Aesthetic House", o.titulo || o.subject, o.text), attachments: o.attachments });
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
}

/* ---------- Avisos automáticos a pacientes ---------- */
const fechaLarga = (f: string) => new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(f + "T12:00:00Z"));
export type TipoAviso = "RECORDATORIO" | "CONFIRMACION" | "REPROGRAMACION" | "CANCELACION";
const ASUNTO: Record<TipoAviso, string> = { RECORDATORIO: "Recordatorio de tu cita", CONFIRMACION: "Confirmación de tu cita", REPROGRAMACION: "Tu cita fue reprogramada", CANCELACION: "Tu cita fue cancelada" };

export function mensajeAviso(tipo: TipoAviso, c: any, aj: Record<string, string>): string {
  const centro = aj.nombre_centro || "Deva Aesthetic House", nombre = String(c.paciente).split(" ")[0];
  const cuando = `${fechaLarga(c.fecha)} a las ${c.hora}`;
  if (tipo === "RECORDATORIO") return (aj.mensaje_recordatorio || "Hola {nombre}, te recordamos tu cita en {centro}: {fecha} a las {hora} ({servicio}). Responde CONFIRMO o avísanos si necesitas reprogramar. ¡Te esperamos!")
    .replace(/\{(\w+)\}/g, (_, k) => ({ nombre, centro, fecha: fechaLarga(c.fecha), hora: c.hora, servicio: c.servicio, profesional: c.profesional } as any)[k] ?? "");
  if (tipo === "CONFIRMACION") return `Hola ${nombre}, tu cita en ${centro} quedó agendada para el ${cuando}.\nServicio: ${c.servicio}\nProfesional: ${c.profesional}\nSi necesitas cambiarla, avísanos con anticipación. ¡Te esperamos!`;
  if (tipo === "REPROGRAMACION") return `Hola ${nombre}, tu cita en ${centro} fue reprogramada. Tu nuevo horario es el ${cuando}.\nServicio: ${c.servicio}\nProfesional: ${c.profesional}\nSi no puedes asistir, avísanos.`;
  return `Hola ${nombre}, te informamos que tu cita del ${cuando} en ${centro} fue cancelada. Si deseas agendar una nueva hora, escríbenos por WhatsApp.`;
}

async function cargarCita(q: Queryable, id: number) {
  const [c] = await q.query("SELECT c.id, c.fecha, c.hora, c.paciente_id, p.nombre AS paciente, p.email, s.nombre AS servicio, pr.nombre AS profesional FROM citas c JOIN pacientes p ON p.id=c.paciente_id JOIN servicios s ON s.id=c.servicio_id JOIN profesionales pr ON pr.id=c.profesional_id WHERE c.id=$1", [id]);
  return c;
}

/** Registra el aviso por correo de una cita y lo envía de inmediato (si hay correo del paciente y el envío está activo). */
export async function avisarCita(db: Db, citaId: number, tipo: TipoAviso): Promise<void> {
  const aj = await leerAjustes(db);
  if (aj.email_avisos === "false") return;
  const c = await cargarCita(db, citaId);
  if (!c || !c.email) return;
  const [n] = await db.query(
    `INSERT INTO notificaciones(cita_id,paciente_id,canal,tipo,mensaje) VALUES ($1,$2,'EMAIL',$3,$4)
     ON CONFLICT (cita_id,canal,tipo) DO UPDATE SET mensaje=EXCLUDED.mensaje, estado='PENDIENTE', enviada_en=NULL, detalle_error=NULL RETURNING id`,
    [c.id, c.paciente_id, tipo, mensajeAviso(tipo, c, aj)]);
  await enviarNotificacion(db, n.id);
}

export async function enviarNotificacion(db: Db, id: number): Promise<"ENVIADA" | "ERROR" | "PENDIENTE"> {
  const [n] = await db.query("SELECT n.id, n.tipo, n.mensaje, p.email FROM notificaciones n JOIN pacientes p ON p.id=n.paciente_id WHERE n.id=$1", [id]);
  if (!n || !n.email) return "PENDIENTE";
  if (!(await correoConfigurado(db))) { await db.query("UPDATE notificaciones SET detalle_error='Correo saliente no configurado' WHERE id=$1", [id]); return "PENDIENTE"; }
  const r = await enviarCorreo(db, { to: n.email, subject: ASUNTO[n.tipo as TipoAviso] ?? "Aviso", text: n.mensaje });
  if (r.ok) { await db.query("UPDATE notificaciones SET estado='ENVIADA', enviada_en=now(), detalle_error=NULL WHERE id=$1", [id]); return "ENVIADA"; }
  await db.query("UPDATE notificaciones SET estado='ERROR', detalle_error=$2 WHERE id=$1", [id, r.error ?? "error"]); return "ERROR";
}

/** Envía todos los correos pendientes (recordatorios generados, reintentos). */
export async function enviarCorreosPendientes(db: Db) {
  const pend = await db.query("SELECT n.id FROM notificaciones n JOIN pacientes p ON p.id=n.paciente_id WHERE n.canal='EMAIL' AND n.estado IN ('PENDIENTE','ERROR') AND p.email IS NOT NULL AND n.tipo IN ('RECORDATORIO','CONFIRMACION','REPROGRAMACION','CANCELACION') AND n.created_at > now() - interval '3 days'");
  const smtp = await correoConfigurado(db);
  let ok = 0;
  if (smtp) for (const n of pend) if ((await enviarNotificacion(db, n.id)) === "ENVIADA") ok++;
  return { correos_enviados: ok, correos_pendientes: pend.length - ok, smtp };
}

/** Envío en segundo plano: un fallo de correo nunca debe impedir agendar. */
export function avisarEnSegundoPlano(db: Db, citaId: number, tipo: TipoAviso) {
  avisarCita(db, citaId, tipo).catch((e) => console.error("[correo]", e?.message ?? e));
}
