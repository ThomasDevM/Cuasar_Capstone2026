import type { Db } from "./db.js";
import { config } from "./config.js";
import { enviarCorreo, leerAjustes } from "./correo.js";
import { construirSemanal, lunesDe } from "./routes/informes.js";
import { generarRecordatorios } from "./routes/seguimiento.js";
import { sumarDias } from "./util.js";

export interface Ahora { fecha: string; hora: number; dow: number }   // dow: 1 = lunes … 7 = domingo
export function ahoraCentro(d = new Date()): Ahora {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(d).map((x) => [x.type, x.value]));
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1;
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24, dow };
}

const marcar = (db: Db, clave: string, valor: string) => db.query("INSERT INTO config(clave,valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor=EXCLUDED.valor", [clave, valor]);

/** Se ejecuta cada hora. Cada tarea corre una sola vez por día/semana. */
export async function ejecutarTareas(db: Db, ahora: Ahora = ahoraCentro()) {
  const aj = await leerAjustes(db), hecho: string[] = [];
  const horaRec = Number(aj.hora_recordatorio ?? 18);
  if (aj.email_avisos !== "false" && ahora.hora >= horaRec && aj.ultimo_recordatorio !== ahora.fecha) {
    await marcar(db, "ultimo_recordatorio", ahora.fecha);
    await generarRecordatorios(db, sumarDias(ahora.fecha, 1)); hecho.push("recordatorios");
  }
  if (aj.email_informe_semanal && ahora.dow === 1 && ahora.hora >= 8 && aj.ultimo_informe !== ahora.fecha) {
    await marcar(db, "ultimo_informe", ahora.fecha);
    const { resumen, wb } = await construirSemanal(db, sumarDias(lunesDe(ahora.fecha), -7));
    const r = await enviarCorreo(db, { to: aj.email_informe_semanal, subject: `Reporte semanal ${resumen.desde} al ${resumen.hasta}`, titulo: "Reporte semanal",
      text: `Adjuntamos el reporte de la semana del ${resumen.desde} al ${resumen.hasta}.\n\nVentas: $${resumen.ventas_total.toLocaleString("es-CL")}\nGanancia de los profesionales: $${resumen.comisiones.toLocaleString("es-CL")}\nGanancia del centro: $${resumen.ganancia_centro.toLocaleString("es-CL")}\nAtenciones realizadas: ${resumen.citas_realizadas}\nCancelaciones: ${resumen.citas_canceladas} · Inasistencias: ${resumen.inasistencias}`,
      attachments: [{ filename: `reporte_semanal_${resumen.desde}.xlsx`, content: Buffer.from(await wb.xlsx.writeBuffer()) }] });
    hecho.push(r.ok ? "informe_semanal" : `informe_semanal_error:${r.error}`);
  }
  return hecho;
}
