import express from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
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
import { crmRoutes } from "./routes/crm.js";
import { publicoRoutes } from "./routes/publico.js";
export function createApp(db) {
    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", 1);
    app.use(helmet({
        contentSecurityPolicy: { directives: {
                defaultSrc: ["'self'"], scriptSrc: ["'self'"], imgSrc: ["'self'", "data:", "blob:"], connectSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], fontSrc: ["'self'", "https://fonts.gstatic.com"],
                objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: null,
            } },
        strictTransportSecurity: config.cookieSecure,
    }));
    app.use(compression());
    app.use(express.json({ limit: "1mb" }));
    app.use(cookieParser());
    const api = express.Router();
    // Datos clínicos y personales: el navegador no debe guardarlos en caché.
    api.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
    api.get("/health", async (_req, res) => { await db.query("SELECT 1"); res.json({ status: "ok", db: db.kind }); });
    api.use("/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Demasiados intentos, espere unos minutos" } }));
    api.use("/auth", authRoutes(db));
    // Rutas públicas (sin sesión): solo la encuesta de satisfacción que responde el paciente con su enlace único.
    api.use("/publico", rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Demasiadas solicitudes, intente más tarde" } }), publicoRoutes(db));
    api.use(authRequired(db));
    api.use(catalogoRoutes(db), pacienteRoutes(db), citaRoutes(db), ventaRoutes(db), comisionRoutes(db), seguimientoRoutes(db), reporteRoutes(db), crmRoutes(db));
    api.use((_req, _res) => { throw new HttpError(404, "Recurso no encontrado"); });
    app.use("/api/v1", api);
    // Frontend compilado (mismo dominio que la API)
    if (fs.existsSync(path.join(config.staticDir, "index.html"))) {
        app.use(express.static(config.staticDir, { maxAge: "1h", index: false }));
        app.use((req, res, next) => { if (req.method === "GET" && !req.path.startsWith("/api"))
            return res.sendFile(path.join(config.staticDir, "index.html")); next(); });
    }
    app.use((err, _req, res, _next) => {
        if (err instanceof HttpError)
            return res.status(err.status).json({ error: err.message, code: err.code });
        if (err?.type === "entity.parse.failed")
            return res.status(400).json({ error: "JSON inválido" });
        if (err?.type === "entity.too.large")
            return res.status(413).json({ error: "El contenido enviado es demasiado grande" });
        console.error("[error]", err);
        res.status(500).json({ error: "Error interno del servidor" });
    });
    return app;
}
