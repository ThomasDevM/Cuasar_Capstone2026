import crypto from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
/* ---------- Política de contraseñas ---------- */
const COMUNES = new Set([
    "password", "password1", "password123", "contraseña", "contrasena", "123456789", "1234567890", "12345678910", "qwerty123", "qwertyuiop",
    "admin12345", "administrador", "deva123456", "deva2026", "deva20261", "bienvenido1", "bienvenida1", "iloveyou12", "abc1234567", "sandra12345",
]);
export function problemaPassword(pw, username) {
    if (pw.length < 10)
        return "debe tener al menos 10 caracteres";
    if (pw.length > 128)
        return "es demasiado larga (máximo 128 caracteres)";
    if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(pw) || !/\d/.test(pw))
        return "debe combinar letras y números";
    if (COMUNES.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw))
        return "es demasiado común; elija otra";
    if (username && username.length >= 3 && pw.toLowerCase().includes(username.toLowerCase()))
        return "no puede contener el nombre de usuario";
    return null;
}
export const passwordSchema = z.string().superRefine((pw, ctx) => { const p = problemaPassword(pw); if (p)
    ctx.addIssue({ code: "custom", message: `la clave ${p}` }); });
/* ---------- Tokens de sesión (opacos; en la base solo se guarda su hash) ---------- */
export const nuevoToken = () => crypto.randomBytes(32).toString("base64url");
export const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");
/* ---------- Cifrado simétrico (AES-256-GCM) para secretos guardados en la base ---------- */
const clave = () => crypto.createHash("sha256").update("deva:cifrado:" + config.jwtSecret).digest();
/** Formato: IV (12 bytes) + etiqueta de autenticación (16 bytes) + texto cifrado. */
export function cifrarBuffer(dato) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", clave(), iv);
    const ct = Buffer.concat([c.update(dato), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
}
/** Lanza error si el dato fue alterado (GCM verifica la integridad). */
export function descifrarBuffer(b) {
    const d = crypto.createDecipheriv("aes-256-gcm", clave(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}
export const cifrar = (texto) => cifrarBuffer(Buffer.from(texto, "utf8")).toString("base64");
export const descifrar = (dato) => descifrarBuffer(Buffer.from(dato, "base64")).toString("utf8");
/* ---------- Tipo real de una imagen por su firma de bytes (no por la extensión ni el Content-Type) ---------- */
export function tipoImagen(b) {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
        return "image/jpeg";
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return "image/png";
    return null;
}
/* ---------- Segundo factor TOTP (RFC 6238, compatible con Google Authenticator / Microsoft Authenticator) ---------- */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(buf) {
    let bits = 0, val = 0, out = "";
    for (const byte of buf) {
        val = ((val << 8) | byte) & 0xffff;
        bits += 8;
        while (bits >= 5) {
            out += B32[(val >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0)
        out += B32[(val << (5 - bits)) & 31];
    return out;
}
export function desdeBase32(s) {
    const limpio = s.replace(/[\s=]/g, "").toUpperCase();
    let bits = 0, val = 0;
    const out = [];
    for (const ch of limpio) {
        const i = B32.indexOf(ch);
        if (i < 0)
            throw new Error("base32 inválido");
        val = ((val << 5) | i) & 0xffff;
        bits += 5;
        if (bits >= 8) {
            out.push((val >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}
export const PASO_TOTP = 30;
export function codigoTotp(secreto, paso) {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(paso));
    const h = crypto.createHmac("sha1", desdeBase32(secreto)).update(msg).digest();
    const o = h[h.length - 1] & 15;
    const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(n % 1_000_000).padStart(6, "0");
}
export const pasoActual = (ms = Date.now()) => Math.floor(ms / 1000 / PASO_TOTP);
/** Devuelve el paso válido (para impedir reutilizar el mismo código) o null. Tolera ±1 paso de desfase de reloj. */
export function verificarTotp(secreto, codigo, ultimoPaso, ms = Date.now()) {
    const c = String(codigo).replace(/\s/g, "");
    if (!/^\d{6}$/.test(c))
        return null;
    const actual = pasoActual(ms);
    for (const p of [actual - 1, actual, actual + 1]) {
        if (ultimoPaso != null && p <= ultimoPaso)
            continue;
        if (crypto.timingSafeEqual(Buffer.from(codigoTotp(secreto, p)), Buffer.from(c)))
            return p;
    }
    return null;
}
export const nuevoSecretoTotp = () => base32(crypto.randomBytes(20));
export const otpauthUrl = (secreto, usuario, emisor = "Deva Aesthetic House") => `otpauth://totp/${encodeURIComponent(`${emisor}:${usuario}`)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=${PASO_TOTP}`;
