import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { revocarSesiones, soloAdmin } from "../auth.js";
import { problemaPassword } from "../seguridad.js";
import { HttpError, audit, esViolacionUnica, parse, idParam } from "../util.js";
const opt = (s) => s.optional();
export function catalogoRoutes(db) {
    const r = Router();
    const dup = (e, msg) => { if (esViolacionUnica(e))
        throw new HttpError(409, msg); throw e; };
    /* ---- Profesionales ---- */
    const profSchema = z.object({
        nombre: z.string().min(2), especialidad: z.string().nullish(), turnos: z.string().nullish(),
        contrato: z.enum(["PORCENTAJE", "OTRO"]), porcentaje: z.number().int().min(0).max(100), activo: z.boolean().optional(),
    });
    r.get("/profesionales", async (_req, res) => res.json(await db.query("SELECT * FROM profesionales ORDER BY activo DESC, nombre")));
    r.post("/profesionales", soloAdmin, async (req, res) => {
        const d = parse(profSchema, req.body);
        if (d.contrato === "OTRO" && d.porcentaje !== 0)
            throw new HttpError(400, "Un contrato distinto de porcentaje debe tener 0%");
        const [p] = await db.query("INSERT INTO profesionales(nombre,especialidad,turnos,contrato,porcentaje) VALUES ($1,$2,$3,$4,$5) RETURNING *", [d.nombre, d.especialidad ?? null, d.turnos ?? null, d.contrato, d.porcentaje]);
        await audit(db, req, "CREAR", "profesional", p.id);
        res.status(201).json(p);
    });
    r.patch("/profesionales/:id", soloAdmin, async (req, res) => {
        const d = parse(profSchema.partial(), req.body);
        const id = idParam(req.params.id);
        const [cur] = await db.query("SELECT * FROM profesionales WHERE id=$1", [id]);
        if (!cur)
            throw new HttpError(404, "Profesional no encontrado");
        const n = { ...cur, ...d };
        if (n.contrato === "OTRO")
            n.porcentaje = 0;
        const [p] = await db.query("UPDATE profesionales SET nombre=$2, especialidad=$3, turnos=$4, contrato=$5, porcentaje=$6, activo=$7 WHERE id=$1 RETURNING *", [id, n.nombre, n.especialidad, n.turnos, n.contrato, n.porcentaje, n.activo]);
        await audit(db, req, "EDITAR", "profesional", id, null, `porcentaje=${n.porcentaje}`);
        res.json(p);
    });
    /* ---- Boxes ---- */
    r.get("/boxes", async (_req, res) => res.json(await db.query("SELECT * FROM boxes ORDER BY nombre")));
    r.post("/boxes", soloAdmin, async (req, res) => {
        const { nombre } = parse(z.object({ nombre: z.string().min(1) }), req.body);
        try {
            const [b] = await db.query("INSERT INTO boxes(nombre) VALUES ($1) RETURNING *", [nombre]);
            res.status(201).json(b);
        }
        catch (e) {
            dup(e, "Ya existe un box con ese nombre");
        }
    });
    r.patch("/boxes/:id", soloAdmin, async (req, res) => {
        const d = parse(z.object({ nombre: opt(z.string().min(1)), activo: opt(z.boolean()) }), req.body);
        const [b] = await db.query("UPDATE boxes SET nombre = COALESCE($2, nombre), activo = COALESCE($3, activo) WHERE id=$1 RETURNING *", [idParam(req.params.id), d.nombre ?? null, d.activo ?? null]);
        if (!b)
            throw new HttpError(404, "Box no encontrado");
        res.json(b);
    });
    /* ---- Servicios ---- */
    const servSchema = z.object({ nombre: z.string().min(2), precio: z.number().int().min(0), sesiones: z.number().int().min(1), intervalo_mantencion_dias: z.number().int().min(1).nullish(), activo: z.boolean().optional() });
    r.get("/servicios", async (_req, res) => res.json(await db.query("SELECT * FROM servicios ORDER BY activo DESC, nombre")));
    r.post("/servicios", soloAdmin, async (req, res) => {
        const d = parse(servSchema, req.body);
        try {
            const [s] = await db.query("INSERT INTO servicios(nombre,precio,sesiones,intervalo_mantencion_dias) VALUES ($1,$2,$3,$4) RETURNING *", [d.nombre, d.precio, d.sesiones, d.intervalo_mantencion_dias ?? null]);
            await audit(db, req, "CREAR", "servicio", s.id);
            res.status(201).json(s);
        }
        catch (e) {
            dup(e, "Ya existe un servicio con ese nombre");
        }
    });
    r.patch("/servicios/:id", soloAdmin, async (req, res) => {
        const d = parse(servSchema.partial(), req.body);
        const id = idParam(req.params.id);
        const [cur] = await db.query("SELECT * FROM servicios WHERE id=$1", [id]);
        if (!cur)
            throw new HttpError(404, "Servicio no encontrado");
        const n = { ...cur, ...d };
        const [s] = await db.query("UPDATE servicios SET nombre=$2, precio=$3, sesiones=$4, intervalo_mantencion_dias=$5, activo=$6 WHERE id=$1 RETURNING *", [id, n.nombre, n.precio, n.sesiones, n.intervalo_mantencion_dias ?? null, n.activo]);
        await audit(db, req, "EDITAR", "servicio", id, null, `precio=${n.precio}`);
        res.json(s);
    });
    /* ---- Productos y stock ---- */
    const prodSchema = z.object({ nombre: z.string().min(2), precio: z.number().int().min(0), stock: z.number().int().min(0).optional(), stock_minimo: z.number().int().min(0).optional(), activo: z.boolean().optional() });
    r.get("/productos", async (_req, res) => res.json(await db.query("SELECT *, (stock <= stock_minimo) AS stock_bajo FROM productos ORDER BY activo DESC, nombre")));
    r.post("/productos", soloAdmin, async (req, res) => {
        const d = parse(prodSchema, req.body);
        try {
            const [p] = await db.query("INSERT INTO productos(nombre,precio,stock,stock_minimo) VALUES ($1,$2,$3,$4) RETURNING *", [d.nombre, d.precio, d.stock ?? 0, d.stock_minimo ?? 0]);
            res.status(201).json(p);
        }
        catch (e) {
            dup(e, "Ya existe un producto con ese nombre");
        }
    });
    r.patch("/productos/:id", soloAdmin, async (req, res) => {
        const d = parse(prodSchema.partial(), req.body);
        const id = idParam(req.params.id);
        const [cur] = await db.query("SELECT * FROM productos WHERE id=$1", [id]);
        if (!cur)
            throw new HttpError(404, "Producto no encontrado");
        const n = { ...cur, ...d };
        const [p] = await db.query("UPDATE productos SET nombre=$2, precio=$3, stock_minimo=$4, activo=$5 WHERE id=$1 RETURNING *", [id, n.nombre, n.precio, n.stock_minimo, n.activo]);
        res.json(p);
    });
    r.post("/productos/:id/stock", soloAdmin, async (req, res) => {
        const { delta } = parse(z.object({ delta: z.number().int().refine((v) => v !== 0, "delta no puede ser 0") }), req.body);
        const id = idParam(req.params.id);
        const [p] = await db.query("UPDATE productos SET stock = stock + $2 WHERE id=$1 AND stock + $2 >= 0 RETURNING *", [id, delta]);
        if (!p)
            throw new HttpError(409, "Stock insuficiente o producto inexistente");
        await audit(db, req, "AJUSTE_STOCK", "producto", id, null, `delta=${delta}`);
        res.json(p);
    });
    /* ---- Usuarios (solo Dirección) ---- */
    const COLS_USUARIO = "id,username,nombre,rol,profesional_id,activo,mfa_activo,debe_cambiar_password";
    r.get("/usuarios", soloAdmin, async (_req, res) => res.json(await db.query(`SELECT u.id,u.username,u.nombre,u.rol,u.profesional_id,u.activo,u.mfa_activo,u.debe_cambiar_password,p.nombre AS profesional,
            (SELECT max(ultimo_uso) FROM sesiones s WHERE s.usuario_id=u.id) AS ultimo_acceso
     FROM usuarios u LEFT JOIN profesionales p ON p.id=u.profesional_id ORDER BY u.activo DESC, u.nombre`)));
    r.post("/usuarios", soloAdmin, async (req, res) => {
        const d = parse(z.object({ username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, "solo letras, números, punto, guion"), nombre: z.string().min(2), password: z.string(), rol: z.enum(["ADMIN", "PROFESIONAL"]), profesional_id: z.number().int().nullish() }), req.body);
        const p = problemaPassword(d.password, d.username);
        if (p)
            throw new HttpError(400, `La clave ${p}`);
        if (d.rol === "PROFESIONAL" && !d.profesional_id)
            throw new HttpError(400, "Un usuario Profesional debe vincularse a un profesional");
        try {
            // La clave la define Dirección: el usuario debe cambiarla en su primer ingreso.
            const [u] = await db.query(`INSERT INTO usuarios(username,nombre,password_hash,rol,profesional_id,debe_cambiar_password) VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING ${COLS_USUARIO}`, [d.username, d.nombre, await bcrypt.hash(d.password, 12), d.rol, d.profesional_id ?? null]);
            await audit(db, req, "CREAR", "usuario", u.id);
            res.status(201).json(u);
        }
        catch (e) {
            dup(e, "Ese nombre de usuario ya existe");
        }
    });
    r.patch("/usuarios/:id", soloAdmin, async (req, res) => {
        const d = parse(z.object({ nombre: opt(z.string().min(2)), activo: opt(z.boolean()), rol: opt(z.enum(["ADMIN", "PROFESIONAL"])), profesional_id: z.number().int().nullish(), password: opt(z.string()), reiniciar_mfa: opt(z.boolean()) }), req.body);
        const id = idParam(req.params.id);
        if (id === req.user.id && (d.activo === false || d.rol === "PROFESIONAL"))
            throw new HttpError(400, "No puede desactivar ni quitarse el perfil de Dirección a sí mismo");
        const [cur] = await db.query("SELECT * FROM usuarios WHERE id=$1", [id]);
        if (!cur)
            throw new HttpError(404, "Usuario no encontrado");
        if (d.password) {
            const p = problemaPassword(d.password, cur.username);
            if (p)
                throw new HttpError(400, `La clave ${p}`);
        }
        const hash = d.password ? await bcrypt.hash(d.password, 12) : cur.password_hash;
        const u = await db.tx(async (t) => {
            const [u] = await t.query(`UPDATE usuarios SET nombre=$2, activo=$3, rol=$4, profesional_id=$5, password_hash=$6,
                debe_cambiar_password = debe_cambiar_password OR $7, intentos_fallidos = CASE WHEN $7 THEN 0 ELSE intentos_fallidos END, bloqueado_hasta = CASE WHEN $7 THEN NULL ELSE bloqueado_hasta END,
                mfa_activo = CASE WHEN $8 THEN FALSE ELSE mfa_activo END, mfa_secreto = CASE WHEN $8 THEN NULL ELSE mfa_secreto END
         WHERE id=$1 RETURNING ${COLS_USUARIO}`, [id, d.nombre ?? cur.nombre, d.activo ?? cur.activo, d.rol ?? cur.rol, d.profesional_id === undefined ? cur.profesional_id : d.profesional_id, hash, Boolean(d.password), Boolean(d.reiniciar_mfa)]);
            // Una clave nueva, un cambio de perfil o la desactivación cierran todas las sesiones abiertas de ese usuario.
            if (d.password || d.activo === false || (d.rol && d.rol !== cur.rol) || d.reiniciar_mfa)
                await revocarSesiones(t, id);
            return u;
        });
        await audit(db, req, d.password ? "RESET_PASSWORD" : d.reiniciar_mfa ? "REINICIAR_MFA" : "EDITAR", "usuario", id);
        res.json(u);
    });
    /* ---- Configuración del centro ---- */
    const CLAVES = ["nombre_centro", "enlace_encuesta", "mensaje_recordatorio", "texto_consentimiento", "version_consentimiento", "texto_marketing", "pie_campanas"];
    r.get("/config", async (_req, res) => {
        const rows = await db.query("SELECT clave, valor FROM config");
        res.json(Object.fromEntries(rows.map((x) => [x.clave, x.valor])));
    });
    r.put("/config", soloAdmin, async (req, res) => {
        const d = parse(z.record(z.string(), z.string()), req.body);
        for (const [k, v] of Object.entries(d)) {
            if (!CLAVES.includes(k))
                throw new HttpError(400, `Clave de configuración no permitida: ${k}`);
            await db.query("INSERT INTO config(clave, valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor", [k, v]);
        }
        await audit(db, req, "EDITAR", "config", null, null, Object.keys(d).join(","));
        res.json({ ok: true });
    });
    return r;
}
