import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { soloAdmin } from "../auth.js";
import { HttpError, audit, esViolacionUnica, fechaSchema, hoy, mesSchema, parse, idParam } from "../util.js";
const MEDIOS = ["EFECTIVO", "TRANSFERENCIA", "DEBITO", "CREDITO", "OTRO"];
const LISTA = `
SELECT v.id, v.fecha, v.descripcion, v.monto, v.medio_pago, v.nro_boleta, v.cantidad, v.cita_id, v.producto_id, v.porcentaje_aplicado,
       p.nombre AS paciente, pr.nombre AS vendedor, v.vendedor_id
FROM ventas v LEFT JOIN pacientes p ON p.id=v.paciente_id LEFT JOIN profesionales pr ON pr.id=v.vendedor_id`;
export function ventaRoutes(db) {
    const r = Router();
    r.post("/ventas", async (req, res) => {
        const d = parse(z.object({
            cita_id: z.number().int().nullish(), producto_id: z.number().int().nullish(), cantidad: z.number().int().min(1).default(1),
            paciente_id: z.number().int().nullish(), descripcion: z.string().min(2).nullish(), monto: z.number().int().min(0).nullish(),
            medio_pago: z.enum(MEDIOS), nro_boleta: z.string().max(30).nullish(), vendedor_id: z.number().int().nullish(), fecha: fechaSchema.optional(),
        }), req.body);
        try {
            const venta = await db.tx(async (t) => {
                // Un profesional solo puede registrar ventas a su propio nombre (no atribuirlas a otro).
                if (req.user.rol === "PROFESIONAL" && d.vendedor_id != null && d.vendedor_id !== req.user.profesionalId)
                    throw new HttpError(403, "Solo puede registrar ventas a su nombre");
                let paciente = d.paciente_id ?? null, monto = d.monto ?? null, desc = d.descripcion ?? null, vendedor = d.vendedor_id ?? req.user.profesionalId ?? null, pct = null;
                if (d.cita_id) {
                    // Si la cita pertenece a un plan con precio pactado (presupuesto aceptado), ese es el valor por defecto.
                    const [c] = await t.query("SELECT c.*, s.nombre AS servicio, COALESCE(pl.precio_sesion, s.precio) AS precio, pr.contrato, pr.porcentaje FROM citas c JOIN servicios s ON s.id=c.servicio_id JOIN profesionales pr ON pr.id=c.profesional_id LEFT JOIN planes pl ON pl.id=c.plan_id WHERE c.id=$1", [d.cita_id]);
                    if (!c)
                        throw new HttpError(404, "Cita no encontrada");
                    if (req.user.rol === "PROFESIONAL" && c.profesional_id !== req.user.profesionalId)
                        throw new HttpError(403, "Solo puede cobrar sus propias atenciones");
                    if (c.estado === "CANCELADA")
                        throw new HttpError(400, "No se puede cobrar una cita cancelada");
                    paciente = c.paciente_id;
                    monto = monto ?? c.precio;
                    vendedor = c.profesional_id;
                    desc = `${c.servicio}${c.nro_sesion ? ` (sesión ${c.nro_sesion})` : ""}`;
                    pct = c.contrato === "PORCENTAJE" ? c.porcentaje : null;
                }
                else if (d.producto_id) {
                    const [p] = await t.query("SELECT * FROM productos WHERE id=$1 AND activo", [d.producto_id]);
                    if (!p)
                        throw new HttpError(404, "Producto no encontrado");
                    const [ok] = await t.query("UPDATE productos SET stock = stock - $2 WHERE id=$1 AND stock >= $2 RETURNING id", [p.id, d.cantidad]);
                    if (!ok)
                        throw new HttpError(409, `Stock insuficiente de ${p.nombre} (disponible: ${p.stock})`);
                    monto = monto ?? p.precio * d.cantidad;
                    desc = `${p.nombre} x${d.cantidad}`;
                }
                else if (monto === null || !desc)
                    throw new HttpError(400, "Indique una cita, un producto o la descripción y el monto");
                const [v] = await t.query(`INSERT INTO ventas(fecha,paciente_id,cita_id,producto_id,cantidad,descripcion,monto,medio_pago,nro_boleta,vendedor_id,porcentaje_aplicado,registrada_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [d.fecha ?? hoy(), paciente, d.cita_id ?? null, d.producto_id ?? null, d.cantidad, desc, monto, d.medio_pago, d.nro_boleta || null, vendedor, pct, req.user.id]);
                await audit(t, req, "REGISTRAR_VENTA", "venta", v.id, paciente, `${desc} $${monto}`);
                return v;
            });
            const [out] = await db.query(`${LISTA} WHERE v.id=$1`, [venta.id]);
            res.status(201).json(out);
        }
        catch (e) {
            if (esViolacionUnica(e))
                throw new HttpError(409, "Esa cita ya tiene un cobro registrado");
            throw e;
        }
    });
    r.get("/ventas", async (req, res) => {
        const f = parse(z.object({ mes: mesSchema.optional(), fecha: fechaSchema.optional() }), req.query);
        const prefijo = f.fecha ?? f.mes ?? hoy().slice(0, 7);
        const own = req.user.rol === "PROFESIONAL" ? req.user.profesionalId : null;
        const rows = await db.query(`${LISTA} WHERE v.fecha LIKE $1 AND ($2::int IS NULL OR v.vendedor_id=$2) ORDER BY v.fecha DESC, v.id DESC`, [prefijo + "%", own]);
        const porMedio = {};
        rows.forEach((v) => { porMedio[v.medio_pago] = (porMedio[v.medio_pago] ?? 0) + v.monto; });
        res.json({ ventas: rows, total: rows.reduce((a, v) => a + v.monto, 0), por_medio: porMedio });
    });
    r.patch("/ventas/:id", soloAdmin, async (req, res) => {
        const id = idParam(req.params.id);
        const d = parse(z.object({ medio_pago: z.enum(MEDIOS).optional(), nro_boleta: z.string().max(30).nullish(), monto: z.number().int().min(0).optional(), fecha: fechaSchema.optional() }), req.body);
        const [v] = await db.query("SELECT * FROM ventas WHERE id=$1", [id]);
        if (!v)
            throw new HttpError(404, "Venta no encontrada");
        const [o] = await db.query("UPDATE ventas SET medio_pago=$2, nro_boleta=$3, monto=$4, fecha=$5 WHERE id=$1 RETURNING id", [id, d.medio_pago ?? v.medio_pago, d.nro_boleta === undefined ? v.nro_boleta : d.nro_boleta || null, d.monto ?? v.monto, d.fecha ?? v.fecha]);
        await audit(db, req, "EDITAR_VENTA", "venta", id, v.paciente_id, `monto ${v.monto}→${d.monto ?? v.monto}; medio ${v.medio_pago}→${d.medio_pago ?? v.medio_pago}`);
        const [out] = await db.query(`${LISTA} WHERE v.id=$1`, [o.id]);
        res.json(out);
    });
    r.delete("/ventas/:id", soloAdmin, async (req, res) => {
        const id = idParam(req.params.id);
        await db.tx(async (t) => {
            const [v] = await t.query("DELETE FROM ventas WHERE id=$1 RETURNING *", [id]);
            if (!v)
                throw new HttpError(404, "Venta no encontrada");
            if (v.producto_id)
                await t.query("UPDATE productos SET stock = stock + $2 WHERE id=$1", [v.producto_id, v.cantidad]);
            await audit(t, req, "ANULAR_VENTA", "venta", id, v.paciente_id, `${v.descripcion} $${v.monto}`);
        });
        res.json({ ok: true });
    });
    r.get("/ventas/export", soloAdmin, async (req, res) => {
        const { mes } = parse(z.object({ mes: mesSchema }), req.query);
        const rows = await db.query(`${LISTA} WHERE v.fecha LIKE $1 ORDER BY v.fecha, v.id`, [mes + "%"]);
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("Ventas");
        ws.columns = [
            { header: "Fecha", key: "fecha", width: 12 }, { header: "N° boleta", key: "nro_boleta", width: 14 }, { header: "Paciente", key: "paciente", width: 28 },
            { header: "Descripción", key: "descripcion", width: 36 }, { header: "Profesional", key: "vendedor", width: 24 }, { header: "Medio de pago", key: "medio_pago", width: 16 }, { header: "Monto", key: "monto", width: 14 },
        ];
        rows.forEach((v) => ws.addRow(v));
        ws.getRow(1).font = { bold: true };
        ws.getColumn("monto").numFmt = '"$"#,##0';
        const tot = ws.addRow({ descripcion: "TOTAL", monto: rows.reduce((a, v) => a + v.monto, 0) });
        tot.font = { bold: true };
        await audit(db, req, "EXPORTAR_VENTAS", "venta", null, null, mes);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="ventas_${mes}.xlsx"`);
        res.send(Buffer.from(await wb.xlsx.writeBuffer()));
    });
    return r;
}
