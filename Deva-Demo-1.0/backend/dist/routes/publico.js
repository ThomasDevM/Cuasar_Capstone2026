import { Router } from "express";
import { z } from "zod";
import { hashToken } from "../seguridad.js";
import { HttpError, leerConfig, parse, primerNombre } from "../util.js";
/**
 * Rutas sin sesión. Solo exponen lo mínimo para que el paciente responda su encuesta con el enlace único que recibió:
 * el token es aleatorio (256 bits), se guarda solo su hash, vence y admite una única respuesta.
 */
export function publicoRoutes(db) {
    const r = Router();
    const token = z.string().regex(/^[A-Za-z0-9_-]{30,100}$/, "Enlace no válido");
    async function cargar(t) {
        const [e] = await db.query(`SELECT e.id, e.puntaje, e.respondida_en, (e.expira_en < now()) AS vencida, p.nombre, s.nombre AS servicio, c.fecha
       FROM encuestas e JOIN pacientes p ON p.id=e.paciente_id LEFT JOIN citas c ON c.id=e.cita_id LEFT JOIN servicios s ON s.id=c.servicio_id
       WHERE e.token_hash=$1`, [hashToken(t)]);
        if (!e || e.vencida)
            throw new HttpError(404, "Este enlace no es válido o ya venció. Gracias por tu interés.");
        return e;
    }
    r.get("/encuesta/:token", async (req, res) => {
        const e = await cargar(parse(token, req.params.token));
        const conf = await leerConfig(db);
        res.json({ centro: conf.nombre_centro || "Deva Aesthetic House", nombre: primerNombre(e.nombre), servicio: e.servicio, fecha: e.fecha, respondida: Boolean(e.respondida_en) });
    });
    r.post("/encuesta/:token", async (req, res) => {
        const e = await cargar(parse(token, req.params.token));
        const d = parse(z.object({ puntaje: z.number().int().min(0).max(10), comentario: z.string().max(1000).nullish() }), req.body);
        if (e.respondida_en)
            throw new HttpError(409, "Esta encuesta ya fue respondida. ¡Gracias!");
        const comentario = d.comentario ? d.comentario.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim() || null : null;
        const [ok] = await db.query("UPDATE encuestas SET puntaje=$2, comentario=$3, respondida_en=now() WHERE id=$1 AND respondida_en IS NULL RETURNING id", [e.id, d.puntaje, comentario]);
        if (!ok)
            throw new HttpError(409, "Esta encuesta ya fue respondida. ¡Gracias!");
        res.json({ ok: true });
    });
    return r;
}
