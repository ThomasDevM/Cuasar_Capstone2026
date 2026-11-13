import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { HttpError } from "./util.js";

export interface SessionUser { id: number; nombre: string; rol: "ADMIN" | "PROFESIONAL"; profesionalId: number | null }

declare global { namespace Express { interface Request { user?: SessionUser } } }

export const COOKIE = "deva_token";
export const signToken = (u: SessionUser) => jwt.sign(u, config.jwtSecret, { expiresIn: "8h" });

export function authRequired(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = req.cookies?.[COOKIE] || (header?.startsWith("Bearer ") ? header.slice(7) : "");
  if (!token) throw new HttpError(401, "Debe iniciar sesión");
  try {
    const p = jwt.verify(token, config.jwtSecret) as SessionUser;
    req.user = { id: p.id, nombre: p.nombre, rol: p.rol, profesionalId: p.profesionalId };
  } catch { throw new HttpError(401, "Sesión expirada, inicie sesión nuevamente"); }
  next();
}

export const soloAdmin = (req: Request, _res: Response, next: NextFunction) => {
  if (req.user?.rol !== "ADMIN") throw new HttpError(403, "No tiene permisos para esta acción");
  next();
};
