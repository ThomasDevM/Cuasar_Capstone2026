import { Router } from "express";
import nodemailer from "nodemailer";
import { z } from "zod";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { soloAdmin } from "../auth.js";
import { config } from "../config.js";
import { HttpError, NOMBRE_CANAL, audit, canalSchema, fechaSchema, hoy, idParam, leerConfig, limpiarRut, normalizarCelular, parse, primerNombre, rellenar, rutSchema, sumarDias, waLink, } from "../util.js";
const ESTADOS_PROSPECTO = ["NUEVO", "CONTACTADO", "EVALUACION", "CONVERTIDO", "PERDIDO"];
const latin1 = (s) => String(s).replace(/→/g, "->").replace(/[^\u0000-ÿ]/g, "?");
const clp = (n) => "$" + Math.round(n).toLocaleString("es-CL");
const textoOpcional = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
/* ======================= Prospectos (embudo de ventas) ======================= */
const prospectoSchema = z.object({
    nombre: z.string().trim().min(2, "ingrese el nombre"),
    celular: textoOpcional(30),
    email: z.union([z.literal(""), z.email("correo inválido")]).nullish().transform((v) => v || null),
    canal: canalSchema,
    servicio_id: z.number().int().nullish(),
    interes: textoOpcional(1000),
    proximo_contacto: z.union([z.literal(""), fechaSchema]).nullish().transform((v) => v || null),
    valor_estimado: z.number().int().min(0).nullish(),
    responsable_id: z.number().int().nullish(),
    referido_por: z.number().int().nullish(),
    acepta_marketing: z.boolean().optional(),
});
async function registrarActividad(q, req, prospectoId, tipo, texto) {
    await q.query("INSERT INTO prospecto_actividades(prospecto_id,tipo,texto,usuario_id,usuario_nombre) VALUES ($1,$2,$3,$4,$5)", [prospectoId, tipo, texto, req.user.id, req.user.nombre]);
}
/** Crea los planes de tratamiento de un presupuesto aceptado, con el precio por sesión pactado (descuento prorrateado). */
async function crearPlanes(t, presupuestoId, pacienteId) {
    const [pr] = await t.query("SELECT subtotal, total FROM presupuestos WHERE id=$1", [presupuestoId]);
    const items = await t.query("SELECT i.*, s.sesiones AS sesiones_servicio FROM presupuesto_items i JOIN servicios s ON s.id=i.servicio_id WHERE i.presupuesto_id=$1", [presupuestoId]);
    const factor = pr.subtotal > 0 ? pr.total / pr.subtotal : 1;
    let creados = 0;
    for (const it of items) {
        if (it.sesiones <= 1 && it.sesiones_servicio <= 1)
            continue;
        await t.query("INSERT INTO planes(paciente_id,servicio_id,sesiones_total,origen,precio_sesion) VALUES ($1,$2,$3,'EVALUACION',$4)", [pacienteId, it.servicio_id, it.sesiones, Math.round((it.total * factor) / it.sesiones)]);
        creados++;
    }
    return creados;
}
/* ======================= Segmentación ======================= */
const filtroSchema = z.object({
    servicio_id: z.number().int().nullish(),
    sin_visita_dias: z.number().int().min(1).max(3650).nullish(),
    canal_origen: canalSchema.nullish(),
    cumple_mes: z.number().int().min(1).max(12).nullish(),
    etiqueta: z.string().trim().toLowerCase().max(30).nullish().transform((v) => v || null),
    gasto_minimo: z.number().int().min(0).nullish(),
    con_plan_activo: z.boolean().nullish(),
}).default({ etiqueta: null });
/** Pacientes que cumplen el filtro. Solo se incluyen los que autorizaron comunicaciones comerciales (salvo para contar excluidos). */
function segmento(q, canal, f, soloConsentimiento = true) {
    return q.query(`SELECT p.id, p.nombre, p.celular, p.email, p.acepta_marketing,
            (SELECT max(fecha) FROM citas c WHERE c.paciente_id=p.id AND c.estado='REALIZADA') AS ultima_visita,
            (SELECT COALESCE(sum(monto),0)::int FROM ventas v WHERE v.paciente_id=p.id) AS total_gastado
     FROM pacientes p
     WHERE p.activo AND ($10::boolean = FALSE OR p.acepta_marketing)
       AND (CASE WHEN $1 = 'EMAIL' THEN COALESCE(p.email,'') <> '' ELSE COALESCE(p.celular,'') <> '' END)
       AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id=p.id AND c.servicio_id=$2 AND c.estado='REALIZADA'))
       AND ($3::int IS NULL OR (EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id=p.id AND c.estado='REALIZADA')
            AND NOT EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id=p.id AND c.estado IN ('REALIZADA','AGENDADA','CONFIRMADA') AND c.fecha > (($9::text)::date - $3::int)::text)))
       AND ($4::text IS NULL OR p.canal_origen = $4)
       AND ($5::int IS NULL OR (p.fecha_nacimiento IS NOT NULL AND substring(p.fecha_nacimiento, 6, 2)::int = $5))
       AND ($6::text IS NULL OR p.etiquetas @> jsonb_build_array($6::text))
       AND ($7::int IS NULL OR (SELECT COALESCE(sum(monto),0) FROM ventas v WHERE v.paciente_id=p.id) >= $7)
       AND ($8::boolean IS NULL OR $8 = EXISTS (SELECT 1 FROM planes pl WHERE pl.paciente_id=p.id AND pl.estado='ACTIVO'))
     ORDER BY p.nombre`, [canal, f.servicio_id ?? null, f.sin_visita_dias ?? null, f.canal_origen ?? null, f.cumple_mes ?? null, f.etiqueta ?? null, f.gasto_minimo ?? null, f.con_plan_activo ?? null, hoy(), soloConsentimiento]);
}
function mensajeCampana(plantilla, paciente, conf) {
    const cuerpo = rellenar(plantilla, { nombre: primerNombre(paciente.nombre ?? ""), centro: conf.nombre_centro || "Deva Aesthetic House" });
    return conf.pie_campanas ? `${cuerpo}\n\n${conf.pie_campanas}` : cuerpo;
}
export function crmRoutes(db) {
    const r = Router();
    r.use("/crm", soloAdmin);
    /* ---------- Prospectos ---------- */
    r.get("/crm/prospectos", async (req, res) => {
        const f = parse(z.object({ estado: z.enum(ESTADOS_PROSPECTO).optional(), q: z.string().max(100).optional() }), req.query);
        const like = f.q ? `%${f.q}%` : null;
        res.json(await db.query(`SELECT p.*, s.nombre AS servicio, u.nombre AS responsable, pa.nombre AS paciente,
              (SELECT max(a.created_at) FROM prospecto_actividades a WHERE a.prospecto_id=p.id AND a.tipo <> 'ESTADO') AS ultimo_contacto,
              (SELECT count(*)::int FROM presupuestos pr WHERE pr.prospecto_id=p.id) AS presupuestos
       FROM prospectos p LEFT JOIN servicios s ON s.id=p.servicio_id LEFT JOIN usuarios u ON u.id=p.responsable_id LEFT JOIN pacientes pa ON pa.id=p.paciente_id
       WHERE ($1::text IS NULL OR p.estado=$1) AND ($2::text IS NULL OR p.nombre ILIKE $2 OR p.celular ILIKE $2 OR p.email ILIKE $2)
       ORDER BY CASE p.estado WHEN 'NUEVO' THEN 0 WHEN 'CONTACTADO' THEN 1 WHEN 'EVALUACION' THEN 2 ELSE 3 END, COALESCE(p.proximo_contacto, '9999'), p.created_at DESC
       LIMIT 500`, [f.estado ?? null, like]));
    });
    r.post("/crm/prospectos", async (req, res) => {
        const d = parse(prospectoSchema, req.body);
        if (!d.celular && !d.email)
            throw new HttpError(400, "Indique al menos un celular o un correo para poder contactarlo");
        const cel = normalizarCelular(d.celular);
        if (cel) {
            const [dup] = await db.query("SELECT id, nombre FROM prospectos WHERE estado IN ('NUEVO','CONTACTADO','EVALUACION') AND regexp_replace(COALESCE(celular,''), '\\D', '', 'g') IN ($1, $2)", [cel, cel.replace(/^56/, "")]);
            if (dup)
                throw new HttpError(409, `Ya existe un prospecto abierto con ese celular (${dup.nombre}, #${dup.id})`);
        }
        let valor = d.valor_estimado ?? null;
        if (valor == null && d.servicio_id) {
            const [s] = await db.query("SELECT precio * sesiones AS v FROM servicios WHERE id=$1", [d.servicio_id]);
            valor = s?.v ?? null;
        }
        const p = await db.tx(async (t) => {
            const [p] = await t.query(`INSERT INTO prospectos(nombre,celular,email,canal,servicio_id,interes,proximo_contacto,valor_estimado,responsable_id,referido_por,acepta_marketing,creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [d.nombre, d.celular, d.email, d.canal, d.servicio_id ?? null, d.interes, d.proximo_contacto ?? sumarDias(hoy(), 1), valor, d.responsable_id ?? req.user.id, d.referido_por ?? null, d.acepta_marketing ?? false, req.user.id]);
            await registrarActividad(t, req, p.id, "ESTADO", `Prospecto ingresado (llegó por ${NOMBRE_CANAL[d.canal]})`);
            await audit(t, req, "CREAR_PROSPECTO", "prospecto", p.id);
            return p;
        });
        res.status(201).json(p);
    });
    async function cargarProspecto(id, q = db) {
        const [p] = await q.query("SELECT * FROM prospectos WHERE id=$1", [id]);
        if (!p)
            throw new HttpError(404, "Prospecto no encontrado");
        return p;
    }
    r.get("/crm/prospectos/:id", async (req, res) => {
        const id = idParam(req.params.id);
        const [p] = await db.query("SELECT p.*, s.nombre AS servicio, u.nombre AS responsable, rf.nombre AS referido_por_nombre FROM prospectos p LEFT JOIN servicios s ON s.id=p.servicio_id LEFT JOIN usuarios u ON u.id=p.responsable_id LEFT JOIN pacientes rf ON rf.id=p.referido_por WHERE p.id=$1", [id]);
        if (!p)
            throw new HttpError(404, "Prospecto no encontrado");
        const [actividades, presupuestos, conf] = await Promise.all([
            db.query("SELECT * FROM prospecto_actividades WHERE prospecto_id=$1 ORDER BY created_at DESC, id DESC", [id]),
            db.query("SELECT id, fecha, estado, total, validez_dias, (fecha::date + validez_dias) < $2::date AS vencido FROM presupuestos WHERE prospecto_id=$1 ORDER BY id DESC", [id, hoy()]),
            leerConfig(db),
        ]);
        const saludo = `Hola ${primerNombre(p.nombre)}, te escribimos de ${conf.nombre_centro || "Deva Aesthetic House"}${p.servicio ? ` por tu consulta sobre ${p.servicio}` : ""}. ¿Te gustaría agendar una evaluación?`;
        res.json({ ...p, actividades, presupuestos, wa_link: waLink(p.celular, saludo) });
    });
    r.patch("/crm/prospectos/:id", async (req, res) => {
        const id = idParam(req.params.id);
        const d = parse(prospectoSchema.partial().extend({ estado: z.enum(["NUEVO", "CONTACTADO", "EVALUACION", "PERDIDO"]).optional(), motivo_perdida: textoOpcional(300) }), req.body);
        const cur = await cargarProspecto(id);
        if (cur.estado === "CONVERTIDO")
            throw new HttpError(400, "El prospecto ya es paciente; edite la ficha del paciente");
        // Solo se modifican los campos que vienen en la solicitud.
        const n = { ...cur };
        for (const k of Object.keys(req.body ?? {}))
            if (k in d)
                n[k] = d[k];
        if (n.estado === "PERDIDO" && !n.motivo_perdida)
            throw new HttpError(400, "Indique el motivo por el que se perdió el prospecto");
        if (!n.celular && !n.email)
            throw new HttpError(400, "Indique al menos un celular o un correo");
        const out = await db.tx(async (t) => {
            const [p] = await t.query(`UPDATE prospectos SET nombre=$2,celular=$3,email=$4,canal=$5,servicio_id=$6,interes=$7,proximo_contacto=$8,valor_estimado=$9,responsable_id=$10,
                referido_por=$11,acepta_marketing=$12,estado=$13,motivo_perdida=$14,updated_at=now() WHERE id=$1 RETURNING *`, [id, n.nombre, n.celular, n.email, n.canal, n.servicio_id, n.interes, n.proximo_contacto, n.valor_estimado, n.responsable_id, n.referido_por, n.acepta_marketing, n.estado, n.estado === "PERDIDO" ? n.motivo_perdida : null]);
            if (n.estado !== cur.estado) {
                await registrarActividad(t, req, id, "ESTADO", `${cur.estado} → ${n.estado}${n.estado === "PERDIDO" ? ` (${n.motivo_perdida})` : ""}`);
                await audit(t, req, "ESTADO_PROSPECTO", "prospecto", id, null, `${cur.estado} → ${n.estado}`);
            }
            return p;
        });
        res.json(out);
    });
    r.post("/crm/prospectos/:id/actividades", async (req, res) => {
        const id = idParam(req.params.id);
        const d = parse(z.object({ tipo: z.enum(["NOTA", "LLAMADA", "WHATSAPP", "CORREO"]), texto: z.string().trim().min(2, "escriba el detalle").max(2000), proximo_contacto: z.union([z.literal(""), fechaSchema]).nullish() }), req.body);
        const cur = await cargarProspecto(id);
        if (cur.estado === "CONVERTIDO")
            throw new HttpError(400, "El prospecto ya es paciente: registre el seguimiento en su ficha");
        await db.tx(async (t) => {
            await registrarActividad(t, req, id, d.tipo, d.texto);
            const contacto = d.tipo !== "NOTA" && cur.estado === "NUEVO";
            const prox = d.proximo_contacto === undefined ? cur.proximo_contacto : d.proximo_contacto || null;
            await t.query("UPDATE prospectos SET estado = CASE WHEN $2 THEN 'CONTACTADO' ELSE estado END, proximo_contacto = $3, updated_at=now() WHERE id=$1", [id, contacto, prox]);
            if (contacto)
                await registrarActividad(t, req, id, "ESTADO", "NUEVO → CONTACTADO");
        });
        res.status(201).json({ ok: true });
    });
    /** Convertir en paciente: crea la ficha (o vincula una existente por RUT) y traspasa sus presupuestos. */
    r.post("/crm/prospectos/:id/convertir", async (req, res) => {
        const id = idParam(req.params.id);
        const d = parse(z.object({ rut: rutSchema, edad: z.number().int().min(0).max(120).nullish(), fecha_nacimiento: z.union([z.literal(""), fechaSchema]).nullish(), motivo: textoOpcional(2000), antecedentes: z.array(z.string()).default([]) }), req.body);
        const out = await db.tx(async (t) => {
            const p = await cargarProspecto(id, t);
            if (p.estado === "CONVERTIDO")
                throw new HttpError(400, "Este prospecto ya fue convertido en paciente");
            let [pac] = await t.query("SELECT id, activo FROM pacientes WHERE rut=$1", [d.rut]);
            const existente = Boolean(pac);
            if (pac && !pac.activo)
                await t.query("UPDATE pacientes SET activo=TRUE WHERE id=$1", [pac.id]);
            if (!pac) {
                [pac] = await t.query(`INSERT INTO pacientes(rut,nombre,edad,celular,email,motivo,creado_por,fecha_nacimiento,canal_origen,referido_por,acepta_marketing,marketing_actualizado_en)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $11 THEN now() END) RETURNING id`, [d.rut, p.nombre, d.edad ?? null, p.celular, p.email, d.motivo ?? p.interes, req.user.id, d.fecha_nacimiento || null, p.canal, p.referido_por, p.acepta_marketing]);
                await t.query("INSERT INTO fichas(paciente_id, antecedentes) VALUES ($1,$2)", [pac.id, JSON.stringify(d.antecedentes)]);
                await audit(t, req, "CREAR_FICHA", "paciente", pac.id, pac.id, `desde prospecto #${id}`);
            }
            await t.query("UPDATE prospectos SET estado='CONVERTIDO', paciente_id=$2, convertido_en=now(), updated_at=now() WHERE id=$1", [id, pac.id]);
            const traspasados = await t.query("UPDATE presupuestos SET paciente_id=$2 WHERE prospecto_id=$1 RETURNING id, estado", [id, pac.id]);
            let planes = 0;
            for (const pr of traspasados.filter((x) => x.estado === "ACEPTADO"))
                planes += await crearPlanes(t, pr.id, pac.id);
            await registrarActividad(t, req, id, "ESTADO", `${p.estado} → CONVERTIDO${existente ? " (vinculado a ficha existente)" : ""}`);
            await audit(t, req, "CONVERTIR_PROSPECTO", "prospecto", id, pac.id);
            return { paciente_id: pac.id, existente, planes_creados: planes };
        });
        res.json(out);
    });
    r.delete("/crm/prospectos/:id", async (req, res) => {
        const id = idParam(req.params.id);
        const p = await cargarProspecto(id);
        if (p.estado === "CONVERTIDO")
            throw new HttpError(400, "Un prospecto convertido no se elimina: sus datos ya son parte de la ficha del paciente");
        await db.tx(async (t) => {
            await t.query("DELETE FROM presupuestos WHERE prospecto_id=$1 AND paciente_id IS NULL", [id]);
            await t.query("DELETE FROM prospectos WHERE id=$1", [id]);
            await audit(t, req, "ELIMINAR_PROSPECTO", "prospecto", id, null, p.nombre);
        });
        res.json({ ok: true });
    });
    /* ---------- Presupuestos ---------- */
    const SELECT_PRESUPUESTO = `
    SELECT pr.*, COALESCE(pa.nombre, ps.nombre) AS destinatario, COALESCE(pa.celular, ps.celular) AS celular, COALESCE(pa.email, ps.email) AS email,
           pa.rut, (pr.fecha::date + pr.validez_dias)::text AS vence, (pr.fecha::date + pr.validez_dias) < $2::date AS vencido, u.nombre AS creado_por_nombre
    FROM presupuestos pr LEFT JOIN pacientes pa ON pa.id=pr.paciente_id LEFT JOIN prospectos ps ON ps.id=pr.prospecto_id LEFT JOIN usuarios u ON u.id=pr.creado_por`;
    async function cargarPresupuesto(id, q = db) {
        const [p] = await q.query(`${SELECT_PRESUPUESTO} WHERE pr.id=$1`, [id, hoy()]);
        if (!p)
            throw new HttpError(404, "Presupuesto no encontrado");
        p.items = await q.query("SELECT * FROM presupuesto_items WHERE presupuesto_id=$1 ORDER BY id", [id]);
        return p;
    }
    r.get("/crm/presupuestos", async (req, res) => {
        const f = parse(z.object({ estado: z.enum(["BORRADOR", "ENVIADO", "ACEPTADO", "RECHAZADO"]).optional() }), req.query);
        res.json(await db.query(`${SELECT_PRESUPUESTO} WHERE ($1::text IS NULL OR pr.estado=$1) ORDER BY pr.id DESC LIMIT 300`, [f.estado ?? null, hoy()]));
    });
    r.post("/crm/presupuestos", async (req, res) => {
        const d = parse(z.object({
            paciente_id: z.number().int().nullish(), prospecto_id: z.number().int().nullish(),
            items: z.array(z.object({ servicio_id: z.number().int(), descripcion: textoOpcional(200), sesiones: z.number().int().min(1).max(60), precio_unitario: z.number().int().min(0).nullish() })).min(1, "agregue al menos un servicio").max(20),
            descuento: z.number().int().min(0).default(0), validez_dias: z.number().int().min(1).max(365).default(30), notas: textoOpcional(2000),
        }), req.body);
        if (!d.paciente_id === !d.prospecto_id)
            throw new HttpError(400, "El presupuesto es para un paciente o para un prospecto (uno de los dos)");
        const out = await db.tx(async (t) => {
            if (d.paciente_id) {
                const [x] = await t.query("SELECT id FROM pacientes WHERE id=$1 AND activo", [d.paciente_id]);
                if (!x)
                    throw new HttpError(400, "Paciente no válido");
            }
            if (d.prospecto_id) {
                const p = await cargarProspecto(d.prospecto_id, t);
                if (p.estado === "CONVERTIDO")
                    throw new HttpError(400, "El prospecto ya es paciente: haga el presupuesto a su ficha");
            }
            const items = [];
            for (const it of d.items) {
                const [s] = await t.query("SELECT id, nombre, precio FROM servicios WHERE id=$1 AND activo", [it.servicio_id]);
                if (!s)
                    throw new HttpError(400, `Servicio #${it.servicio_id} no válido`);
                const precio = it.precio_unitario ?? s.precio;
                items.push({ servicio_id: s.id, descripcion: it.descripcion || s.nombre, sesiones: it.sesiones, precio_unitario: precio, total: precio * it.sesiones });
            }
            const subtotal = items.reduce((a, x) => a + x.total, 0);
            if (d.descuento > subtotal)
                throw new HttpError(400, "El descuento no puede superar el subtotal");
            const [p] = await t.query("INSERT INTO presupuestos(paciente_id,prospecto_id,fecha,validez_dias,subtotal,descuento,total,notas,creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id", [d.paciente_id ?? null, d.prospecto_id ?? null, hoy(), d.validez_dias, subtotal, d.descuento, subtotal - d.descuento, d.notas, req.user.id]);
            for (const it of items)
                await t.query("INSERT INTO presupuesto_items(presupuesto_id,servicio_id,descripcion,sesiones,precio_unitario,total) VALUES ($1,$2,$3,$4,$5,$6)", [p.id, it.servicio_id, it.descripcion, it.sesiones, it.precio_unitario, it.total]);
            if (d.prospecto_id) {
                await t.query("UPDATE prospectos SET estado = CASE WHEN estado IN ('NUEVO','CONTACTADO') THEN 'EVALUACION' ELSE estado END, updated_at=now() WHERE id=$1", [d.prospecto_id]);
                await registrarActividad(t, req, d.prospecto_id, "ESTADO", `Presupuesto #${p.id} por ${clp(subtotal - d.descuento)}`);
            }
            await audit(t, req, "CREAR_PRESUPUESTO", "presupuesto", p.id, d.paciente_id ?? null, clp(subtotal - d.descuento));
            return p.id;
        });
        res.status(201).json(await cargarPresupuesto(out));
    });
    r.get("/crm/presupuestos/:id", async (req, res) => res.json(await cargarPresupuesto(idParam(req.params.id))));
    function mensajePresupuesto(p, conf) {
        const lineas = p.items.map((i) => `• ${i.descripcion}${i.sesiones > 1 ? ` (${i.sesiones} sesiones)` : ""}: ${clp(i.total)}`).join("\n");
        return `Hola ${primerNombre(p.destinatario)}, te compartimos tu presupuesto de ${conf.nombre_centro || "Deva Aesthetic House"}:\n${lineas}` +
            `${p.descuento ? `\nDescuento: -${clp(p.descuento)}` : ""}\nTotal: ${clp(p.total)}\nVálido hasta el ${p.vence.split("-").reverse().join("-")}. ¿Te agendamos para comenzar?`;
    }
    /** Marca como enviado y entrega el mensaje listo para WhatsApp. */
    r.post("/crm/presupuestos/:id/enviar", async (req, res) => {
        const id = idParam(req.params.id);
        const p = await cargarPresupuesto(id);
        if (p.estado === "ACEPTADO" || p.estado === "RECHAZADO")
            throw new HttpError(400, "El presupuesto ya fue respondido");
        if (p.estado === "BORRADOR") {
            await db.query("UPDATE presupuestos SET estado='ENVIADO' WHERE id=$1", [id]);
            if (p.prospecto_id && !p.paciente_id)
                await registrarActividad(db, req, p.prospecto_id, "WHATSAPP", `Se envió el presupuesto #${id}`);
            await audit(db, req, "ENVIAR_PRESUPUESTO", "presupuesto", id, p.paciente_id);
        }
        const mensaje = mensajePresupuesto(p, await leerConfig(db));
        res.json({ mensaje, wa_link: waLink(p.celular, mensaje) });
    });
    r.post("/crm/presupuestos/:id/responder", async (req, res) => {
        const id = idParam(req.params.id);
        const d = parse(z.object({ estado: z.enum(["ACEPTADO", "RECHAZADO"]), motivo_rechazo: textoOpcional(300) }), req.body);
        const out = await db.tx(async (t) => {
            const p = await cargarPresupuesto(id, t);
            if (p.estado === "ACEPTADO" || p.estado === "RECHAZADO")
                throw new HttpError(400, "El presupuesto ya fue respondido");
            if (d.estado === "ACEPTADO" && p.vencido)
                throw new HttpError(400, "El presupuesto está vencido. Cree uno nuevo con los valores vigentes.");
            await t.query("UPDATE presupuestos SET estado=$2, motivo_rechazo=$3, respondido_en=now() WHERE id=$1", [id, d.estado, d.estado === "RECHAZADO" ? d.motivo_rechazo : null]);
            let planes = 0;
            if (d.estado === "ACEPTADO" && p.paciente_id)
                planes = await crearPlanes(t, id, p.paciente_id);
            if (p.prospecto_id && !p.paciente_id)
                await registrarActividad(t, req, p.prospecto_id, "ESTADO", `Presupuesto #${id} ${d.estado.toLowerCase()}${d.motivo_rechazo ? ` (${d.motivo_rechazo})` : ""}`);
            await audit(t, req, d.estado === "ACEPTADO" ? "ACEPTAR_PRESUPUESTO" : "RECHAZAR_PRESUPUESTO", "presupuesto", id, p.paciente_id);
            return { planes_creados: planes };
        });
        res.json({ ...(await cargarPresupuesto(id)), ...out });
    });
    r.delete("/crm/presupuestos/:id", async (req, res) => {
        const id = idParam(req.params.id);
        const p = await cargarPresupuesto(id);
        if (p.estado !== "BORRADOR")
            throw new HttpError(400, "Solo se eliminan presupuestos en borrador; los enviados se marcan como rechazados");
        await db.query("DELETE FROM presupuestos WHERE id=$1", [id]);
        await audit(db, req, "ELIMINAR_PRESUPUESTO", "presupuesto", id, p.paciente_id);
        res.json({ ok: true });
    });
    r.get("/crm/presupuestos/:id/pdf", async (req, res) => {
        const id = idParam(req.params.id);
        const p = await cargarPresupuesto(id);
        const conf = await leerConfig(db);
        const pdf = await PDFDocument.create();
        const page = pdf.addPage([595, 842]);
        const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        const plum = rgb(0.357, 0.165, 0.435), gris = rgb(0.4, 0.4, 0.4);
        const txt = (s, x, y, o = {}) => page.drawText(latin1(s), { x, y, size: o.size ?? 10.5, font: o.b ? bold : font, color: o.color });
        const der = (s, xDer, y, b = false) => { const f = b ? bold : font; txt(s, xDer - f.widthOfTextAtSize(latin1(s), 10.5), y, { b }); };
        const fch = (f) => f.split("-").reverse().join("-");
        txt(conf.nombre_centro || "Deva Aesthetic House", 50, 790, { size: 20, b: true, color: plum });
        txt(`Presupuesto N° ${p.id}`, 50, 765, { size: 13, color: gris });
        [`Para: ${p.destinatario}${p.rut ? `  ·  RUT ${p.rut}` : ""}`, `Fecha: ${fch(p.fecha)}`, `Válido hasta: ${fch(p.vence)}`].forEach((l, i) => txt(l, 50, 730 - i * 17));
        let y = 660;
        page.drawRectangle({ x: 45, y: y - 6, width: 505, height: 22, color: rgb(0.95, 0.92, 0.96) });
        txt("Servicio", 52, y, { b: true });
        der("Sesiones", 370, y, true);
        der("Valor unitario", 460, y, true);
        der("Total", 545, y, true);
        y -= 26;
        for (const it of p.items) {
            txt(String(it.descripcion).slice(0, 55), 52, y);
            der(String(it.sesiones), 370, y);
            der(clp(it.precio_unitario), 460, y);
            der(clp(it.total), 545, y);
            y -= 20;
        }
        page.drawLine({ start: { x: 45, y: y + 8 }, end: { x: 550, y: y + 8 }, thickness: 0.6, color: gris });
        y -= 8;
        der("Subtotal", 460, y);
        der(clp(p.subtotal), 545, y);
        y -= 18;
        if (p.descuento) {
            der("Descuento", 460, y);
            der("-" + clp(p.descuento), 545, y);
            y -= 18;
        }
        der("TOTAL", 460, y, true);
        der(clp(p.total), 545, y, true);
        y -= 36;
        if (p.notas) {
            txt("Observaciones:", 50, y, { b: true });
            y -= 16;
            for (const l of String(p.notas).split("\n").slice(0, 8)) {
                txt(l.slice(0, 95), 50, y);
                y -= 15;
            }
        }
        txt("Los valores se cobran por sesión realizada. Este documento no es una boleta.", 50, 70, { size: 9, color: gris });
        await audit(db, req, "DESCARGAR_PRESUPUESTO", "presupuesto", id, p.paciente_id);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="presupuesto_${id}${p.rut ? "_" + limpiarRut(p.rut) : ""}.pdf"`);
        res.send(Buffer.from(await pdf.save()));
    });
    /* ---------- Segmentos y campañas ---------- */
    r.post("/crm/segmentos/previsualizar", async (req, res) => {
        const d = parse(z.object({ canal: z.enum(["WHATSAPP", "EMAIL"]).default("WHATSAPP"), filtro: filtroSchema }), req.body);
        const [con, todos] = await Promise.all([segmento(db, d.canal, d.filtro), segmento(db, d.canal, d.filtro, false)]);
        res.json({ total: con.length, sin_consentimiento: todos.length - con.length, muestra: con.slice(0, 25) });
    });
    r.post("/crm/campanas", async (req, res) => {
        const d = parse(z.object({
            nombre: z.string().trim().min(3, "ponga un nombre a la campaña").max(120), canal: z.enum(["WHATSAPP", "EMAIL"]),
            asunto: textoOpcional(150), mensaje: z.string().trim().min(10, "escriba el mensaje").max(1500), filtro: filtroSchema,
        }), req.body);
        if (d.canal === "EMAIL" && !d.asunto)
            throw new HttpError(400, "Indique el asunto del correo");
        const out = await db.tx(async (t) => {
            const dest = await segmento(t, d.canal, d.filtro);
            if (!dest.length)
                throw new HttpError(400, "Ningún paciente con autorización de marketing cumple ese filtro");
            const [c] = await t.query("INSERT INTO campanas(nombre,canal,asunto,mensaje,filtro,creada_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [d.nombre, d.canal, d.asunto, d.mensaje, JSON.stringify(d.filtro), req.user.id]);
            for (const p of dest)
                await t.query("INSERT INTO campana_destinatarios(campana_id,paciente_id) VALUES ($1,$2)", [c.id, p.id]);
            await audit(t, req, "CREAR_CAMPANA", "campana", c.id, null, `${d.nombre} (${dest.length} destinatarios)`);
            return { id: c.id, destinatarios: dest.length };
        });
        res.status(201).json(out);
    });
    r.get("/crm/campanas", async (_req, res) => {
        res.json(await db.query(`SELECT c.id, c.nombre, c.canal, c.created_at, u.nombre AS creada_por,
              count(d.id)::int AS total, count(d.id) FILTER (WHERE d.estado='ENVIADO')::int AS enviados,
              count(d.id) FILTER (WHERE d.estado='PENDIENTE')::int AS pendientes, count(d.id) FILTER (WHERE d.estado IN ('ERROR','EXCLUIDO'))::int AS no_enviados
       FROM campanas c LEFT JOIN campana_destinatarios d ON d.campana_id=c.id LEFT JOIN usuarios u ON u.id=c.creada_por
       GROUP BY c.id, u.nombre ORDER BY c.id DESC`));
    });
    async function cargarCampana(id) {
        const [c] = await db.query("SELECT * FROM campanas WHERE id=$1", [id]);
        if (!c)
            throw new HttpError(404, "Campaña no encontrada");
        // Si alguien retiró su consentimiento después de crear la campaña, ya no se le envía.
        await db.query("UPDATE campana_destinatarios d SET estado='EXCLUIDO', detalle='Retiró el consentimiento' FROM pacientes p WHERE p.id=d.paciente_id AND d.campana_id=$1 AND d.estado='PENDIENTE' AND (NOT p.acepta_marketing OR NOT p.activo)", [id]);
        return c;
    }
    r.get("/crm/campanas/:id", async (req, res) => {
        const c = await cargarCampana(idParam(req.params.id));
        const conf = await leerConfig(db);
        const dest = await db.query("SELECT d.id, d.estado, d.detalle, d.enviado_en, p.id AS paciente_id, p.nombre, p.celular, p.email FROM campana_destinatarios d JOIN pacientes p ON p.id=d.paciente_id WHERE d.campana_id=$1 ORDER BY p.nombre", [c.id]);
        res.json({ ...c, smtp_configurado: Boolean(config.smtp.host), destinatarios: dest.map((x) => {
                const mensaje = mensajeCampana(c.mensaje, x, conf);
                return { ...x, mensaje, wa_link: c.canal === "WHATSAPP" && x.estado !== "EXCLUIDO" ? waLink(x.celular, mensaje) : "" };
            }) });
    });
    r.post("/crm/campanas/:id/destinatarios/:did/enviado", async (req, res) => {
        const [d] = await db.query("UPDATE campana_destinatarios SET estado='ENVIADO', enviado_en=now(), detalle=NULL WHERE id=$2 AND campana_id=$1 AND estado <> 'EXCLUIDO' RETURNING id", [idParam(req.params.id), idParam(req.params.did)]);
        if (!d)
            throw new HttpError(404, "Destinatario no encontrado o excluido");
        res.json({ ok: true });
    });
    r.post("/crm/campanas/:id/enviar-correos", async (req, res) => {
        const c = await cargarCampana(idParam(req.params.id));
        if (c.canal !== "EMAIL")
            throw new HttpError(400, "Esta campaña es por WhatsApp: envíe cada mensaje con su botón");
        if (!config.smtp.host)
            throw new HttpError(400, "El envío de correos no está configurado (SMTP) en este servidor");
        const conf = await leerConfig(db);
        const pend = await db.query("SELECT d.id, p.nombre, p.email FROM campana_destinatarios d JOIN pacientes p ON p.id=d.paciente_id WHERE d.campana_id=$1 AND d.estado IN ('PENDIENTE','ERROR') AND p.email IS NOT NULL", [c.id]);
        const tr = nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined });
        let ok = 0, error = 0;
        for (const x of pend) {
            try {
                await tr.sendMail({ from: config.smtp.from, to: x.email, subject: c.asunto, text: mensajeCampana(c.mensaje, x, conf) });
                await db.query("UPDATE campana_destinatarios SET estado='ENVIADO', enviado_en=now(), detalle=NULL WHERE id=$1", [x.id]);
                ok++;
            }
            catch (e) {
                await db.query("UPDATE campana_destinatarios SET estado='ERROR', detalle=$2 WHERE id=$1", [x.id, String(e.message).slice(0, 300)]);
                error++;
            }
        }
        await audit(db, req, "ENVIAR_CAMPANA", "campana", c.id, null, `enviados=${ok} errores=${error}`);
        res.json({ enviados: ok, errores: error });
    });
    r.delete("/crm/campanas/:id", async (req, res) => {
        const id = idParam(req.params.id);
        const [{ n }] = await db.query("SELECT count(*)::int AS n FROM campana_destinatarios WHERE campana_id=$1 AND estado='ENVIADO'", [id]);
        if (n)
            throw new HttpError(400, "La campaña ya tiene mensajes enviados y se conserva como registro");
        const [c] = await db.query("DELETE FROM campanas WHERE id=$1 RETURNING nombre", [id]);
        if (!c)
            throw new HttpError(404, "Campaña no encontrada");
        await audit(db, req, "ELIMINAR_CAMPANA", "campana", id, null, c.nombre);
        res.json({ ok: true });
    });
    /* ---------- Encuestas de satisfacción (NPS) ---------- */
    r.get("/crm/encuestas", async (req, res) => {
        const f = parse(z.object({ detractores: z.enum(["true", "false"]).optional() }), req.query);
        res.json(await db.query(`SELECT e.id, e.puntaje, e.comentario, e.respondida_en, e.gestionada, e.paciente_id, p.nombre AS paciente, p.celular, s.nombre AS servicio, pr.nombre AS profesional
       FROM encuestas e JOIN pacientes p ON p.id=e.paciente_id LEFT JOIN citas c ON c.id=e.cita_id LEFT JOIN servicios s ON s.id=c.servicio_id LEFT JOIN profesionales pr ON pr.id=e.profesional_id
       WHERE e.respondida_en IS NOT NULL AND ($1::boolean IS NOT TRUE OR (e.puntaje <= 6 AND NOT e.gestionada))
       ORDER BY e.respondida_en DESC LIMIT 300`, [f.detractores === "true"]));
    });
    /** Gestionar una mala evaluación: queda como llamada en el seguimiento del paciente. */
    r.post("/crm/encuestas/:id/gestionar", async (req, res) => {
        const id = idParam(req.params.id);
        const { nota } = parse(z.object({ nota: z.string().trim().min(3, "describa cómo se gestionó").max(1000) }), req.body);
        const [e] = await db.query("UPDATE encuestas SET gestionada=TRUE WHERE id=$1 AND respondida_en IS NOT NULL RETURNING paciente_id, puntaje", [id]);
        if (!e)
            throw new HttpError(404, "Encuesta no encontrada");
        await db.query("INSERT INTO seguimientos(paciente_id,tipo,texto,usuario_id,usuario_nombre) VALUES ($1,'LLAMADA',$2,$3,$4)", [e.paciente_id, `Gestión de encuesta (nota ${e.puntaje}/10): ${nota}`, req.user.id, req.user.nombre]);
        await audit(db, req, "GESTIONAR_ENCUESTA", "encuesta", id, e.paciente_id);
        res.json({ ok: true });
    });
    /* ---------- Indicadores comerciales ---------- */
    r.get("/crm/indicadores", async (req, res) => {
        const { meses } = parse(z.object({ meses: z.coerce.number().int().min(1).max(24).default(6) }), req.query);
        const h = hoy();
        const ini = new Date(h.slice(0, 7) + "-01T00:00:00Z");
        ini.setUTCMonth(ini.getUTCMonth() - (meses - 1));
        const desde = ini.toISOString().slice(0, 10);
        const [embudo, porCanal, ingresosCanal, mensual, ventasMes, kpi, top, nps, npsProf, perdidas, servicios, cumple] = await Promise.all([
            db.query("SELECT estado, count(*)::int AS n, COALESCE(sum(valor_estimado),0)::int AS valor FROM prospectos WHERE created_at >= $1::date GROUP BY estado", [desde]),
            db.query(`SELECT canal, count(*)::int AS prospectos, count(*) FILTER (WHERE estado='CONVERTIDO')::int AS convertidos, count(*) FILTER (WHERE estado='PERDIDO')::int AS perdidos
                FROM prospectos WHERE created_at >= $1::date GROUP BY canal ORDER BY prospectos DESC`, [desde]),
            db.query(`SELECT COALESCE(p.canal_origen, 'SIN_DATO') AS canal, count(DISTINCT p.id)::int AS pacientes, COALESCE(sum(v.monto),0)::int AS ventas
                FROM pacientes p LEFT JOIN ventas v ON v.paciente_id=p.id AND v.fecha >= $1 WHERE p.activo GROUP BY 1 ORDER BY ventas DESC`, [desde]),
            db.query(`WITH primera AS (SELECT paciente_id, min(fecha) AS f FROM citas WHERE estado='REALIZADA' GROUP BY paciente_id)
                SELECT substring(c.fecha, 1, 7) AS mes,
                       count(*) FILTER (WHERE c.estado='REALIZADA')::int AS atenciones,
                       count(*) FILTER (WHERE c.estado='INASISTENCIA')::int AS inasistencias,
                       count(DISTINCT c.paciente_id) FILTER (WHERE c.estado='REALIZADA' AND substring(pr.f,1,7) = substring(c.fecha,1,7))::int AS nuevos,
                       count(DISTINCT c.paciente_id) FILTER (WHERE c.estado='REALIZADA' AND substring(pr.f,1,7) < substring(c.fecha,1,7))::int AS recurrentes
                FROM citas c LEFT JOIN primera pr ON pr.paciente_id=c.paciente_id
                WHERE c.fecha >= $1 AND c.fecha <= $2 GROUP BY 1 ORDER BY 1`, [desde, h]),
            db.query("SELECT substring(fecha,1,7) AS mes, COALESCE(sum(monto),0)::int AS ingresos, count(*)::int AS ventas FROM ventas WHERE fecha >= $1 AND fecha <= $2 GROUP BY 1", [desde, h]),
            db.query(`SELECT
          (SELECT count(*) FROM citas WHERE estado='INASISTENCIA' AND fecha BETWEEN $1 AND $2)::int AS inasistencias,
          (SELECT count(*) FROM citas WHERE estado IN ('REALIZADA','INASISTENCIA') AND fecha BETWEEN $1 AND $2)::int AS citas_cerradas,
          (SELECT COALESCE(round(avg(monto)),0) FROM ventas WHERE fecha BETWEEN $1 AND $2)::int AS ticket_promedio,
          (SELECT count(*) FROM (SELECT paciente_id FROM citas WHERE estado='REALIZADA' GROUP BY paciente_id HAVING count(*) >= 2) x)::int AS pacientes_recurrentes,
          (SELECT count(DISTINCT paciente_id) FROM citas WHERE estado='REALIZADA')::int AS pacientes_atendidos,
          (SELECT count(*) FROM pacientes p WHERE p.activo AND EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id=p.id AND c.estado='REALIZADA' AND c.fecha > (($2::text)::date - 90)::text))::int AS activos_90d,
          (SELECT count(*) FROM pacientes p WHERE p.activo AND EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id=p.id AND c.estado='REALIZADA')
              AND NOT EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id=p.id AND c.estado IN ('REALIZADA','AGENDADA','CONFIRMADA') AND c.fecha > (($2::text)::date - 90)::text))::int AS inactivos_90d,
          (SELECT count(*) FROM pacientes WHERE activo AND acepta_marketing)::int AS con_marketing,
          (SELECT count(*) FROM pacientes WHERE activo)::int AS pacientes_activos`, [desde, h]),
            db.query(`SELECT p.id, p.nombre, sum(v.monto)::int AS total, count(v.id)::int AS compras, max(v.fecha) AS ultima
                FROM ventas v JOIN pacientes p ON p.id=v.paciente_id WHERE p.activo GROUP BY p.id ORDER BY total DESC LIMIT 10`),
            db.query(`SELECT count(*)::int AS respuestas, count(*) FILTER (WHERE puntaje >= 9)::int AS promotores,
                       count(*) FILTER (WHERE puntaje BETWEEN 7 AND 8)::int AS pasivos, count(*) FILTER (WHERE puntaje <= 6)::int AS detractores,
                       (SELECT count(*) FROM encuestas WHERE creada_en >= $1::date)::int AS enviadas
                FROM encuestas WHERE puntaje IS NOT NULL AND respondida_en >= $1::date`, [desde]),
            db.query(`SELECT pr.nombre AS profesional, count(*)::int AS respuestas, round(avg(e.puntaje)::numeric, 1)::float AS promedio,
                       round(100.0 * (count(*) FILTER (WHERE e.puntaje >= 9) - count(*) FILTER (WHERE e.puntaje <= 6)) / count(*))::int AS nps
                FROM encuestas e JOIN profesionales pr ON pr.id=e.profesional_id WHERE e.puntaje IS NOT NULL AND e.respondida_en >= $1::date GROUP BY pr.nombre ORDER BY nps DESC`, [desde]),
            db.query("SELECT COALESCE(motivo_perdida, 'Sin motivo') AS motivo, count(*)::int AS n FROM prospectos WHERE estado='PERDIDO' AND created_at >= $1::date GROUP BY 1 ORDER BY n DESC", [desde]),
            db.query(`SELECT s.nombre AS servicio, count(*)::int AS atenciones, COALESCE(sum(v.monto),0)::int AS ingresos
                FROM ventas v JOIN citas c ON c.id=v.cita_id JOIN servicios s ON s.id=c.servicio_id WHERE v.fecha BETWEEN $1 AND $2 GROUP BY s.nombre ORDER BY ingresos DESC`, [desde, h]),
            db.query(`SELECT id, nombre, fecha_nacimiento, celular, acepta_marketing FROM pacientes
                WHERE activo AND fecha_nacimiento IS NOT NULL AND substring(fecha_nacimiento, 6, 2) = $1 ORDER BY substring(fecha_nacimiento, 9, 2)`, [h.slice(5, 7)]),
        ]);
        // Serie mensual completa (los meses sin datos quedan en 0)
        const serie = [];
        for (let i = 0; i < meses; i++) {
            const d = new Date(ini);
            d.setUTCMonth(ini.getUTCMonth() + i);
            const mes = d.toISOString().slice(0, 7);
            const m = mensual.find((x) => x.mes === mes), v = ventasMes.find((x) => x.mes === mes);
            serie.push({ mes, atenciones: m?.atenciones ?? 0, inasistencias: m?.inasistencias ?? 0, nuevos: m?.nuevos ?? 0, recurrentes: m?.recurrentes ?? 0, ingresos: v?.ingresos ?? 0, ventas: v?.ventas ?? 0 });
        }
        const k = kpi[0], n = nps[0];
        const totalProspectos = embudo.reduce((a, x) => a + x.n, 0), convertidos = embudo.find((x) => x.estado === "CONVERTIDO")?.n ?? 0;
        res.json({
            desde, hasta: h, meses,
            embudo: ESTADOS_PROSPECTO.map((e) => ({ estado: e, n: embudo.find((x) => x.estado === e)?.n ?? 0, valor: embudo.find((x) => x.estado === e)?.valor ?? 0 })),
            conversion: totalProspectos ? Math.round((100 * convertidos) / totalProspectos) : null,
            por_canal: porCanal, ingresos_por_canal: ingresosCanal, mensual: serie,
            kpi: {
                ...k,
                tasa_inasistencia: k.citas_cerradas ? Math.round((1000 * k.inasistencias) / k.citas_cerradas) / 10 : null,
                retencion: k.pacientes_atendidos ? Math.round((100 * k.pacientes_recurrentes) / k.pacientes_atendidos) : null,
            },
            top_clientes: top,
            nps: { ...n, nps: n.respuestas ? Math.round((100 * (n.promotores - n.detractores)) / n.respuestas) : null, tasa_respuesta: n.enviadas ? Math.round((100 * n.respuestas) / n.enviadas) : null },
            nps_profesional: npsProf, motivos_perdida: perdidas, servicios, cumpleanos_mes: cumple,
        });
    });
    return r;
}
