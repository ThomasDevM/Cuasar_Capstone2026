import cron from "node-cron";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { createDb } from "./db.js";
import { seedBase, seedDemo } from "./seed.js";
import { ejecutarTareas } from "./tareas.js";

async function main() {
  const db = await createDb(config.databaseUrl ? { url: config.databaseUrl } : { dataDir: config.dataDir });
  await seedBase(db);
  if (config.seedDemo) await seedDemo(db);
  const app = createApp(db);
  const server = app.listen(config.port, () => {
    console.log(`Deva · Sistema de Gestión listo en http://localhost:${config.port}  (base de datos: ${db.kind === "pg" ? "PostgreSQL" : "embebida PGlite"})`);
  });
  if (config.cronEnabled) {
    // Cada hora (minuto 5): recordatorios del día siguiente a la hora configurada e informe semanal los lunes.
    cron.schedule("5 * * * *", async () => {
      try { const h = await ejecutarTareas(db); if (h.length) console.log("[tareas]", h.join(", ")); } catch (e) { console.error("[tareas] error", e); }
    }, { timezone: config.timezone });
  }
  const cerrar = async () => { server.close(); await db.close(); process.exit(0); };
  process.on("SIGINT", cerrar); process.on("SIGTERM", cerrar);
}
main().catch((e) => { console.error(e); process.exit(1); });
