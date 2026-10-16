import { config } from "./config.js";
import { hashToken } from "./seguridad.js";
import { HttpError } from "./util.js";
export const COOKIE = "deva_token";
export function tokenDe(req) {
    const header = req.headers.authorization;
    return req.cookies?.[COOKIE] || (header?.startsWith("Bearer ") ? header.slice(7) : "");
}
/**
 * Sesión del lado del servidor: el token es opaco y en la base solo se guarda su hash.
 * Se puede revocar (cerrar sesión, cambio de clave, usuario desactivado) y expira por inactividad.
 * `permitirCambioPendiente`: rutas que se pueden usar aunque el usuario deba cambiar su clave.
 */
export function authRequired(db, opts = {}) {
    return async (req, _res, next) => {
        const token = tokenDe(req);
        if (!token)
            throw new HttpError(401, "Debe iniciar sesión");
        const [s] = await db.query(`SELECT s.id, s.revocada, (s.expira_en < now()) AS expirada,
              (s.ultimo_uso < now() - make_interval(mins => $2::int)) AS inactiva,
              (s.ultimo_uso < now() - interval '1 minute') AS refrescar,
              u.id AS uid, u.nombre, u.rol, u.profesional_id, u.activo, u.debe_cambiar_password
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = $1`, [hashToken(token), config.sesionInactividadMin]);
        if (!s || s.revocada || !s.activo)
            throw new HttpError(401, "Sesión no válida, inicie sesión nuevamente", "SESION_INVALIDA");
        if (s.expirada)
            throw new HttpError(401, "Sesión expirada, inicie sesión nuevamente", "SESION_EXPIRADA");
        if (s.inactiva) {
            await db.query("UPDATE sesiones SET revocada = TRUE WHERE id = $1", [s.id]);
            throw new HttpError(401, "Su sesión se cerró por inactividad", "SESION_INACTIVA");
        }
        if (s.refrescar)
            await db.query("UPDATE sesiones SET ultimo_uso = now() WHERE id = $1", [s.id]);
        req.user = { id: s.uid, nombre: s.nombre, rol: s.rol, profesionalId: s.profesional_id };
        req.sesionId = s.id;
        if (s.debe_cambiar_password && !opts.permitirCambioPendiente)
            throw new HttpError(403, "Debe cambiar su clave antes de continuar", "CAMBIO_PASSWORD_REQUERIDO");
        next();
    };
}
export const soloAdmin = (req, _res, next) => {
    if (req.user?.rol !== "ADMIN")
        throw new HttpError(403, "No tiene permisos para esta acción");
    next();
};
/** Revoca todas las sesiones de un usuario (opcionalmente conservando una). */
export async function revocarSesiones(db, usuarioId, excepto) {
    await db.query("UPDATE sesiones SET revocada = TRUE WHERE usuario_id = $1 AND NOT revocada AND ($2::int IS NULL OR id <> $2)", [usuarioId, excepto ?? null]);
}
