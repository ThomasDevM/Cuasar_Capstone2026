import { z } from "zod";
import { config } from "./config.js";
export class HttpError extends Error {
    status;
    code;
    constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
export function parse(schema, data) {
    const r = schema.safeParse(data);
    if (!r.success) {
        const msg = r.error.issues.map((i) => `${i.path.join(".") || "dato"}: ${i.message}`).join("; ");
        throw new HttpError(400, msg);
    }
    return r.data;
}
/* ---------- RUT chileno ---------- */
export const limpiarRut = (r) => r.replace(/[^0-9kK]/g, "").toUpperCase();
export function dvRut(cuerpo) {
    let suma = 0, mult = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
        suma += Number(cuerpo[i]) * mult;
        mult = mult === 7 ? 2 : mult + 1;
    }
    const r = 11 - (suma % 11);
    return r === 11 ? "0" : r === 10 ? "K" : String(r);
}
export function validarRut(r) {
    const c = limpiarRut(r);
    if (c.length < 8 || c.length > 9)
        return false;
    return dvRut(c.slice(0, -1)) === c.slice(-1);
}
export function formatearRut(r) {
    const c = limpiarRut(r);
    return `${c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${c.slice(-1)}`;
}
export const rutSchema = z.string().refine(validarRut, "RUT inválido (revise el dígito verificador)").transform(formatearRut);
/* ---------- Fechas (zona horaria del centro) ---------- */
export const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
export function sumarDias(fecha, dias) {
    const d = new Date(fecha + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}
export const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha debe ser AAAA-MM-DD");
export const horaSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "hora debe ser HH:MM");
export const mesSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mes debe ser AAAA-MM");
export const minutos = (hora) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
/* ---------- CRM: canales por donde llega un paciente o prospecto ---------- */
export const CANALES = ["INSTAGRAM", "FACEBOOK", "WHATSAPP", "GOOGLE", "WEB", "REFERIDO", "DERIVACION_MEDICA", "PASADA", "OTRO"];
export const canalSchema = z.enum(CANALES);
export const NOMBRE_CANAL = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", WHATSAPP: "WhatsApp", GOOGLE: "Google", WEB: "sitio web", REFERIDO: "referido por paciente", DERIVACION_MEDICA: "derivación médica", PASADA: "pasó por el centro", OTRO: "otro" };
export const rellenar = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
export async function leerConfig(q) {
    return Object.fromEntries((await q.query("SELECT clave, valor FROM config")).map((x) => [x.clave, x.valor]));
}
export const primerNombre = (n) => String(n).trim().split(/\s+/)[0];
/* ---------- Mensajería ---------- */
export function normalizarCelular(c) {
    const d = (c || "").replace(/\D/g, "");
    if (!d)
        return "";
    if (d.length === 9 && d.startsWith("9"))
        return "56" + d;
    return d;
}
export function waLink(celular, mensaje) {
    const n = normalizarCelular(celular);
    return n ? `https://wa.me/${n}?text=${encodeURIComponent(mensaje)}` : "";
}
/* ---------- Auditoría ---------- */
export async function audit(q, req, accion, entidad, entidadId, pacienteId, detalle) {
    const u = req?.user;
    await q.query("INSERT INTO auditoria(usuario_id, usuario_nombre, accion, entidad, entidad_id, paciente_id, detalle) VALUES ($1,$2,$3,$4,$5,$6,$7)", [u?.id ?? null, u?.nombre ?? null, accion, entidad, entidadId ?? null, pacienteId ?? null, detalle ?? null]);
}
export function esViolacionUnica(e) { return e?.code === "23505"; }
export function idParam(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1)
        throw new HttpError(400, "Identificador inválido");
    return n;
}
