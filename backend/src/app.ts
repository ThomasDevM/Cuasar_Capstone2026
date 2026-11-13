import express, { type NextFunction, type Request, type Response } from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { authRequired } from "./auth.js";
import { HttpError } from "./util.js";
import { authRoutes } from "./routes/auth.js";
import { catalogoRoutes } from "./routes/catalogos.js";
import { pacienteRoutes } from "./routes/pacientes.js";
import { citaRoutes } from "./routes/citas.js";
import { ventaRoutes } from "./routes/ventas.js";
import { comisionRoutes } from "./routes/comisiones.js";
import { seguimientoRoutes } from "./routes/seguimiento.js";
import { reporteRoutes } from "./routes/reportes.js";
import { informeRoutes } from "./routes/informes.js";

export function createApp(db: Db) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: null,
    } },
    strictTransportSecurity: config.cookieSecure,
  }));
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.get("/health", async (_req, res) => { await db.query("SELECT 1"); res.json({ status: "ok", db: db.kind }); });
  api.use("/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Demasiados intentos, espere unos minutos" } }));
  api.use("/auth", authRoutes(db));
  api.use(authRequired);
  api.use(async (req, _res, next) => {   // cuenta activa y sin cambio de clave pendiente
    const [u] = await db.query("SELECT activo, debe_cambiar_clave FROM usuarios WHERE id=$1", [req.user!.id]);
    if (!u || !u.activo) throw new HttpError(401, "Usuario inactivo");
    if (u.debe_cambiar_clave) throw new HttpError(403, "Debe cambiar su contraseña antes de continuar", "CAMBIAR_CLAVE");
    next();
  });
  api.use(catalogoRoutes(db), informeRoutes(db), pacienteRoutes(db), citaRoutes(db), ventaRoutes(db), comisionRoutes(db), seguimientoRoutes(db), reporteRoutes(db));
  api.use((_req, _res) => { throw new HttpError(404, "Recurso no encontrado"); });
  app.use("/api/v1", api);

  // Frontend compilado (mismo dominio que la API)
  if (fs.existsSync(path.join(config.staticDir, "index.html"))) {
    app.use(express.static(config.staticDir, { maxAge: "1h", index: false }));
    app.use((req, res, next) => { if (req.method === "GET" && !req.path.startsWith("/api")) return res.sendFile(path.join(config.staticDir, "index.html")); next(); });
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido" });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "El contenido enviado es demasiado grande" });
    console.error("[error]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  });
  return app;
}
