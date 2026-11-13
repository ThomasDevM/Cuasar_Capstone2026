import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Db } from "../db.js";
import { COOKIE, authRequired, signToken, type SessionUser } from "../auth.js";
import { config } from "../config.js";
import { HttpError, audit, parse } from "../util.js";

export function authRoutes(db: Db) {
  const r = Router();

  r.post("/login", async (req, res) => {
    const { username, password } = parse(z.object({ username: z.string().min(1), password: z.string().min(1) }), req.body);
    const [u] = await db.query("SELECT * FROM usuarios WHERE lower(username) = lower($1)", [username]);
    if (!u || !u.activo) throw new HttpError(401, "Usuario o contraseña incorrectos");
    if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) throw new HttpError(423, "Cuenta bloqueada temporalmente por intentos fallidos. Intente en 15 minutos.");
    if (!(await bcrypt.compare(password, u.password_hash))) {
      const intentos = u.intentos_fallidos + 1;
      if (intentos >= 5) await db.query("UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = now() + interval '15 minutes' WHERE id = $1", [u.id]);
      else await db.query("UPDATE usuarios SET intentos_fallidos = $2 WHERE id = $1", [u.id, intentos]);
      throw new HttpError(401, "Usuario o contraseña incorrectos");
    }
    await db.query("UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1", [u.id]);
    const user: SessionUser = { id: u.id, nombre: u.nombre, rol: u.rol, profesionalId: u.profesional_id };
    res.cookie(COOKIE, signToken(user), { httpOnly: true, sameSite: "strict", secure: config.cookieSecure, maxAge: 8 * 3600 * 1000 });
    req.user = user;
    await audit(db, req, "LOGIN", "usuario", u.id);
    res.json({ ...user, debe_cambiar_clave: u.debe_cambiar_clave });
  });

  r.post("/logout", (_req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });
  r.get("/me", authRequired, async (req, res) => {
    const [u] = await db.query("SELECT debe_cambiar_clave, activo FROM usuarios WHERE id=$1", [req.user!.id]);
    if (!u || !u.activo) throw new HttpError(401, "Usuario inactivo");
    res.json({ ...req.user, debe_cambiar_clave: u.debe_cambiar_clave });
  });

  r.post("/password", authRequired, async (req, res) => {
    const { actual, nueva } = parse(z.object({ actual: z.string().min(1), nueva: z.string().min(8, "mínimo 8 caracteres") }), req.body);
    const [u] = await db.query("SELECT password_hash FROM usuarios WHERE id = $1", [req.user!.id]);
    if (!(await bcrypt.compare(actual, u.password_hash))) throw new HttpError(400, "La contraseña actual no coincide");
    if (actual === nueva) throw new HttpError(400, "La nueva contraseña debe ser distinta de la actual");
    await db.query("UPDATE usuarios SET password_hash = $2, debe_cambiar_clave = FALSE WHERE id = $1", [req.user!.id, await bcrypt.hash(nueva, 10)]);
    await audit(db, req, "CAMBIO_PASSWORD", "usuario", req.user!.id);
    res.json({ ok: true });
  });
  return r;
}
