import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const env = process.env;
export const isProd = env.NODE_ENV === "production";
const dataDir = path.resolve(env.DATA_DIR || "./data");
function resolveJwtSecret() {
    if (env.JWT_SECRET)
        return env.JWT_SECRET;
    if (isProd && env.DATABASE_URL)
        throw new Error("JWT_SECRET es obligatorio en producción");
    // Modo demo/local: se genera una vez y se guarda junto a los datos.
    fs.mkdirSync(dataDir, { recursive: true });
    const f = path.join(dataDir, ".jwt_secret");
    if (!fs.existsSync(f))
        fs.writeFileSync(f, crypto.randomBytes(48).toString("hex"), { mode: 0o600 });
    return fs.readFileSync(f, "utf8").trim();
}
export const config = {
    port: Number(env.PORT || 3000),
    databaseUrl: env.DATABASE_URL || "",
    dataDir,
    get jwtSecret() { return resolveJwtSecret(); },
    cookieSecure: env.COOKIE_SECURE === "true",
    staticDir: path.resolve(env.STATIC_DIR || path.join(__dirnameSafe(), "../../frontend/dist")),
    adminUser: env.ADMIN_USER || "sandra",
    adminPassword: env.ADMIN_PASSWORD || "",
    seedDemo: env.SEED_DEMO === "true",
    demoPassword: env.DEMO_PASSWORD || "Deva2026!",
    timezone: env.TZ_CENTRO || "America/Santiago",
    smtp: { host: env.SMTP_HOST || "", port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER || "", pass: env.SMTP_PASS || "", from: env.SMTP_FROM || "Deva Aesthetic House <no-responder@example.com>" },
    cronEnabled: env.CRON_ENABLED !== "false",
    /** Duración máxima de una sesión y cierre automático por inactividad. */
    sesionHoras: Number(env.SESION_HORAS || 10),
    sesionInactividadMin: Number(env.SESION_INACTIVIDAD_MIN || 30),
    /** URL pública del sistema (para enlaces de encuestas que recibe el paciente). Si no se define, se usa la del navegador. */
    publicUrl: (env.PUBLIC_URL || "").replace(/\/+$/, ""),
    /** Tamaño máximo de cada foto clínica (el frontend las reduce antes de subirlas). */
    fotoMaxBytes: Number(env.FOTO_MAX_MB || 8) * 1024 * 1024,
};
function __dirnameSafe() { return path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")); }
