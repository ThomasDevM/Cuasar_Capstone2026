import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import fs from "node:fs";
import { MIGRATIONS } from "./migrations.js";
export async function createDb(opts) {
    let db;
    if (opts.url) {
        pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // bigint -> number
        const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
        db = {
            kind: "pg",
            query: async (sql, params) => (await pool.query(sql, params)).rows,
            exec: async (sql) => { await pool.query(sql); },
            tx: async (fn) => {
                const c = await pool.connect();
                try {
                    await c.query("BEGIN");
                    const r = await fn({ query: async (s, p) => (await c.query(s, p)).rows });
                    await c.query("COMMIT");
                    return r;
                }
                catch (e) {
                    await c.query("ROLLBACK");
                    throw e;
                }
                finally {
                    c.release();
                }
            },
            close: () => pool.end(),
        };
    }
    else {
        let lite;
        if (opts.memory)
            lite = new PGlite();
        else {
            fs.mkdirSync(opts.dataDir, { recursive: true });
            lite = new PGlite(`${opts.dataDir}/pgdata`);
        }
        await lite.waitReady;
        db = {
            kind: "pglite",
            query: async (sql, params) => (await lite.query(sql, params)).rows,
            exec: async (sql) => { await lite.exec(sql); },
            tx: (fn) => lite.transaction((t) => fn({ query: async (s, p) => (await t.query(s, p)).rows })),
            close: () => lite.close(),
        };
    }
    await migrate(db);
    return db;
}
async function migrate(db) {
    await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())");
    const done = new Set((await db.query("SELECT id FROM schema_migrations")).map((r) => r.id));
    for (const m of MIGRATIONS) {
        if (done.has(m.id))
            continue;
        await db.exec(m.sql);
        await db.query("INSERT INTO schema_migrations(id) VALUES ($1)", [m.id]);
    }
}
