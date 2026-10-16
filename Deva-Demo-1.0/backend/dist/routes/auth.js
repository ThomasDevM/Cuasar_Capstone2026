import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { COOKIE, authRequired, revocarSesiones, tokenDe } from "../auth.js";
import { config } from "../config.js";
import { cifrar, descifrar, hashToken, nuevoSecretoTotp, nuevoToken, otpauthUrl, problemaPassword, verificarTotp } from "../seguridad.js";
import { HttpError, audit, parse } from "../util.js";
// Hash de relleno: si el usuario no existe se compara igual, para no revelar por tiempo de respuesta qué usuarios existen.
const HASH_RELLENO = bcrypt.hashSync("relleno-no-valido", 10);
/** Datos de la sesión que ve el frontend. */
async function perfil(db, id) {
    const [u] = await db.query("SELECT id, username, nombre, rol, profesional_id, debe_cambiar_password, mfa_activo FROM usuarios WHERE id=$1", [id]);
    return { id: u.id, username: u.username, nombre: u.nombre, rol: u.rol, profesionalId: u.profesional_id, debeCambiarPassword: u.debe_cambiar_password, mfaActivo: u.mfa_activo };
}
async function registrarFallo(db, u) {
    const intentos = u.intentos_fallidos + 1;
    if (intentos >= 5)
        await db.query("UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = now() + interval '15 minutes' WHERE id = $1", [u.id]);
    else
        await db.query("UPDATE usuarios SET intentos_fallidos = $2 WHERE id = $1", [u.id, intentos]);
}
export function authRoutes(db) {
    const r = Router();
    const sesion = authRequired(db, { permitirCambioPendiente: true });
    r.post("/login", async (req, res) => {
        const { username, password, codigo } = parse(z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200), codigo: z.string().max(10).optional() }), req.body);
        const [u] = await db.query("SELECT * FROM usuarios WHERE lower(username) = lower($1)", [username]);
        if (!u || !u.activo) {
            await bcrypt.compare(password, HASH_RELLENO);
            throw new HttpError(401, "Usuario o contraseña incorrectos");
        }
        if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date())
            throw new HttpError(423, "Cuenta bloqueada temporalmente por intentos fallidos. Intente en 15 minutos.");
        if (!(await bcrypt.compare(password, u.password_hash))) {
            await registrarFallo(db, u);
            throw new HttpError(401, "Usuario o contraseña incorrectos");
        }
        if (u.mfa_activo) {
            if (!codigo)
                throw new HttpError(401, "Ingrese el código de 6 dígitos de su aplicación de autenticación", "MFA_REQUERIDO");
            const paso = verificarTotp(descifrar(u.mfa_secreto), codigo, u.mfa_ultimo_paso);
            if (paso === null) {
                await registrarFallo(db, u);
                throw new HttpError(401, "Código de verificación incorrecto", "MFA_INVALIDO");
            }
            await db.query("UPDATE usuarios SET mfa_ultimo_paso = $2 WHERE id = $1", [u.id, paso]);
        }
        await db.query("UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1", [u.id]);
        const token = nuevoToken();
        const [s] = await db.query("INSERT INTO sesiones(token_hash, usuario_id, expira_en, ip, agente) VALUES ($1,$2, now() + make_interval(hours => $3::int), $4, $5) RETURNING id", [hashToken(token), u.id, config.sesionHoras, req.ip ?? null, String(req.headers["user-agent"] ?? "").slice(0, 200)]);
        // Limpieza de sesiones viejas del usuario
        await db.query("DELETE FROM sesiones WHERE usuario_id = $1 AND (revocada OR expira_en < now()) AND creada_en < now() - interval '30 days'", [u.id]);
        res.cookie(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: config.cookieSecure, maxAge: config.sesionHoras * 3600 * 1000, path: "/" });
        req.user = { id: u.id, nombre: u.nombre, rol: u.rol, profesionalId: u.profesional_id };
        req.sesionId = s.id;
        await audit(db, req, "LOGIN", "usuario", u.id, null, u.mfa_activo ? "con segundo factor" : undefined);
        res.json(await perfil(db, u.id));
    });
    r.post("/logout", async (req, res) => {
        const token = tokenDe(req);
        if (token)
            await db.query("UPDATE sesiones SET revocada = TRUE WHERE token_hash = $1", [hashToken(token)]);
        res.clearCookie(COOKIE, { path: "/" });
        res.json({ ok: true });
    });
    r.get("/me", sesion, async (req, res) => res.json(await perfil(db, req.user.id)));
    r.post("/password", sesion, async (req, res) => {
        const { actual, nueva } = parse(z.object({ actual: z.string().min(1), nueva: z.string().min(1) }), req.body);
        const [u] = await db.query("SELECT username, password_hash FROM usuarios WHERE id = $1", [req.user.id]);
        if (!(await bcrypt.compare(actual, u.password_hash)))
            throw new HttpError(400, "La contraseña actual no coincide");
        const p = problemaPassword(nueva, u.username);
        if (p)
            throw new HttpError(400, `La nueva clave ${p}`);
        if (await bcrypt.compare(nueva, u.password_hash))
            throw new HttpError(400, "La nueva clave debe ser distinta de la actual");
        await db.query("UPDATE usuarios SET password_hash = $2, debe_cambiar_password = FALSE, password_cambiada_en = now() WHERE id = $1", [req.user.id, await bcrypt.hash(nueva, 12)]);
        await revocarSesiones(db, req.user.id, req.sesionId);
        await audit(db, req, "CAMBIO_PASSWORD", "usuario", req.user.id);
        res.json(await perfil(db, req.user.id));
    });
    /* ---- Sesiones abiertas ---- */
    r.get("/sesiones", sesion, async (req, res) => {
        res.json(await db.query("SELECT id, creada_en, ultimo_uso, ip, agente, (id = $2) AS actual FROM sesiones WHERE usuario_id = $1 AND NOT revocada AND expira_en > now() ORDER BY ultimo_uso DESC", [req.user.id, req.sesionId]));
    });
    r.post("/sesiones/cerrar-otras", sesion, async (req, res) => {
        await revocarSesiones(db, req.user.id, req.sesionId);
        await audit(db, req, "CERRAR_OTRAS_SESIONES", "usuario", req.user.id);
        res.json({ ok: true });
    });
    /* ---- Segundo factor (TOTP) ---- */
    r.post("/mfa/configurar", sesion, async (req, res) => {
        const [u] = await db.query("SELECT username, mfa_activo FROM usuarios WHERE id=$1", [req.user.id]);
        if (u.mfa_activo)
            throw new HttpError(409, "El segundo factor ya está activo");
        const secreto = nuevoSecretoTotp();
        await db.query("UPDATE usuarios SET mfa_secreto_pendiente = $2 WHERE id = $1", [req.user.id, cifrar(secreto)]);
        res.json({ secreto, otpauth: otpauthUrl(secreto, u.username) });
    });
    r.post("/mfa/activar", sesion, async (req, res) => {
        const { codigo } = parse(z.object({ codigo: z.string().min(6).max(10) }), req.body);
        const [u] = await db.query("SELECT mfa_secreto_pendiente FROM usuarios WHERE id=$1", [req.user.id]);
        if (!u.mfa_secreto_pendiente)
            throw new HttpError(400, "Primero genere la clave de configuración");
        const paso = verificarTotp(descifrar(u.mfa_secreto_pendiente), codigo);
        if (paso === null)
            throw new HttpError(400, "El código no coincide. Revise la hora del teléfono e intente con el código siguiente.");
        await db.query("UPDATE usuarios SET mfa_secreto = mfa_secreto_pendiente, mfa_secreto_pendiente = NULL, mfa_activo = TRUE, mfa_ultimo_paso = $2 WHERE id = $1", [req.user.id, paso]);
        await revocarSesiones(db, req.user.id, req.sesionId);
        await audit(db, req, "ACTIVAR_MFA", "usuario", req.user.id);
        res.json(await perfil(db, req.user.id));
    });
    r.post("/mfa/desactivar", sesion, async (req, res) => {
        const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
        const [u] = await db.query("SELECT password_hash FROM usuarios WHERE id=$1", [req.user.id]);
        if (!(await bcrypt.compare(password, u.password_hash)))
            throw new HttpError(400, "La contraseña no coincide");
        await db.query("UPDATE usuarios SET mfa_activo = FALSE, mfa_secreto = NULL, mfa_secreto_pendiente = NULL, mfa_ultimo_paso = NULL WHERE id = $1", [req.user.id]);
        await audit(db, req, "DESACTIVAR_MFA", "usuario", req.user.id);
        res.json(await perfil(db, req.user.id));
    });
    return r;
}
