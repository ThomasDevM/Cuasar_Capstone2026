import cron from "node-cron";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { createDb } from "./db.js";
import { seedBase, seedDemo } from "./seed.js";
import { generarRecordatorios } from "./routes/seguimiento.js";
import { hoy, sumarDias } from "./util.js";
async function main() {
    const db = await createDb(config.databaseUrl ? { url: config.databaseUrl } : { dataDir: config.dataDir });
    await seedBase(db);
    if (config.seedDemo)
        await seedDemo(db);
    const app = createApp(db);
    const server = app.listen(config.port, () => {
        console.log(`Deva · Sistema de Gestión listo en http://localhost:${config.port}  (base de datos: ${db.kind === "pg" ? "PostgreSQL" : "embebida PGlite"})`);
    });
    if (config.cronEnabled) {
        // Todos los días a las 18:00 se preparan los recordatorios de las citas de mañana.
        cron.schedule("0 18 * * *", async () => {
            try {
                console.log("[cron] recordatorios:", await generarRecordatorios(db, sumarDias(hoy(), 1)));
            }
            catch (e) {
                console.error("[cron] error", e);
            }
        }, { timezone: config.timezone });
    }
    const cerrar = async () => { server.close(); await db.close(); process.exit(0); };
    process.on("SIGINT", cerrar);
    process.on("SIGTERM", cerrar);
}
main().catch((e) => { console.error(e); process.exit(1); });
