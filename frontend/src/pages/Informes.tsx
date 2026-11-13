import { useState } from "react";
import { useAuth } from "../auth";
import { addDays, api, clp, fechaCorta, fechaLarga, hoyStr, MEDIOS, qs } from "../api";
import { Alerta, Cargando, Metrica, Pestanas, Vacio, useData } from "../ui";

const lunesDe = (f: string) => { const d = new Date(f + "T12:00:00Z"); return addDays(f, -((d.getUTCDay() + 6) % 7)); };
const primeroMes = (f: string) => f.slice(0, 8) + "01";
const finMes = (f: string) => { const d = new Date(f.slice(0, 8) + "01T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); };
const mesAnterior = (f: string) => { const d = new Date(primeroMes(f) + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };

function Ganancias() {
  const { user } = useAuth(); const admin = user!.rol === "ADMIN";
  const [r, setR] = useState({ desde: primeroMes(hoyStr()), hasta: hoyStr() }), [prof, setProf] = useState(""), [sel, setSel] = useState<number | null>(admin ? null : user!.profesionalId);
  const profs = useData(() => (admin ? api.get<any[]>("/profesionales") : Promise.resolve([])), []);
  const datos = useData(() => api.get<any>("/informes/ganancias" + qs({ ...r, profesional_id: admin ? prof : undefined })), [r.desde, r.hasta, prof]);
  const preset = (desde: string, hasta: string) => setR({ desde, hasta });
  const hoy = hoyStr(), d = datos.data;
  const detalle = (d?.detalle ?? []).filter((x: any) => !sel || x.profesional_id === sel);
  return <>
    <div className="barra-fecha sin-imprimir">
      <button className="btn-sec chico" onClick={() => preset(lunesDe(hoy), addDays(lunesDe(hoy), 6))}>Esta semana</button>
      <button className="btn-sec chico" onClick={() => preset(addDays(lunesDe(hoy), -7), addDays(lunesDe(hoy), -1))}>Semana pasada</button>
      <button className="btn-sec chico" onClick={() => preset(primeroMes(hoy), finMes(hoy))}>Este mes</button>
      <button className="btn-sec chico" onClick={() => preset(primeroMes(mesAnterior(hoy)), finMes(mesAnterior(hoy)))}>Mes pasado</button>
      <label>Desde <input type="date" value={r.desde} onChange={(e) => e.target.value && setR({ ...r, desde: e.target.value })} style={{ width: "auto" }} /></label>
      <label>Hasta <input type="date" value={r.hasta} onChange={(e) => e.target.value && setR({ ...r, hasta: e.target.value })} style={{ width: "auto" }} /></label>
      {admin && <select value={prof} onChange={(e) => { setProf(e.target.value); setSel(null); }} aria-label="Persona"><option value="">Todos los profesionales</option>{(profs.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>}
      <a className="btn-sec chico" href={`/api/v1/informes/ganancias/export${qs({ ...r, profesional_id: admin ? prof : undefined })}`}>Exportar Excel</a>
      <button className="btn-sec chico" onClick={() => window.print()}>Imprimir</button>
    </div>
    <p className="imprimir-solo"><b>Informe de ganancias</b> · {fechaCorta(r.desde)} al {fechaCorta(r.hasta)}</p>
    <Alerta tipo="info">Cada atención cobrada se divide entre el profesional que atendió (su porcentaje) y el centro (el resto). Solo cuentan atenciones realizadas y cobradas; quien no trabaja por porcentaje no genera comisión y todo el ingreso queda para el centro.</Alerta>
    <Alerta>{datos.error}</Alerta>
    {!d ? <Cargando /> : <>
      <div className="rejilla" style={{ marginBottom: 18 }}>
        <Metrica titulo="Ventas por atenciones" valor={clp(d.totales.ventas)} nota={`${d.totales.atenciones} atención(es) cobrada(s)`} />
        <Metrica titulo={admin && !prof ? "Para los profesionales" : "Ganancia del profesional"} valor={clp(d.totales.comision)} />
        {admin && <Metrica titulo="Ganancia del centro" valor={clp(d.totales.centro)} nota="después de comisiones" />}
      </div>
      <div className="tabla-wrap"><table><thead><tr><th>Persona</th><th>Contrato</th><th className="num">% base</th><th className="num">Atenciones</th><th className="num">Ventas</th><th className="num">Se lleva</th>{admin && <th className="num">Centro</th>}</tr></thead>
        <tbody>{d.resumen.map((x: any) => (
          <tr key={x.profesional_id} className={`fila-click${sel === x.profesional_id ? " total" : ""}`} onClick={() => setSel(sel === x.profesional_id && admin ? null : x.profesional_id)}>
            <td><b>{x.nombre}</b></td><td>{x.contrato === "PORCENTAJE" ? "Porcentaje" : "Otro"}</td><td className="num">{x.contrato === "PORCENTAJE" ? `${x.porcentaje}%` : "—"}</td><td className="num">{x.atenciones}</td><td className="num">{clp(x.ventas)}</td>
            <td className="num"><b>{x.contrato === "PORCENTAJE" ? clp(x.comision) : "No aplica"}</b></td>{admin && <td className="num">{clp(x.centro)}</td>}</tr>))}
          {admin && <tr className="total"><td colSpan={4}>Total</td><td className="num">{clp(d.totales.ventas)}</td><td className="num">{clp(d.totales.comision)}</td><td className="num">{clp(d.totales.centro)}</td></tr>}</tbody></table></div>
      <div className="tarjeta" style={{ marginTop: 18 }}><h3>Detalle de atenciones{sel ? ` · ${d.resumen.find((x: any) => x.profesional_id === sel)?.nombre ?? ""}` : ""}</h3>
        {detalle.length === 0 ? <Vacio>No hay atenciones cobradas en este periodo.{admin ? " Haga clic en una persona para filtrar." : ""}</Vacio> : <div className="tabla-wrap"><table><thead><tr><th>Fecha</th>{!sel && <th>Profesional</th>}<th>Paciente</th><th>Tratamiento</th><th>Boleta</th><th className="num">Monto</th><th className="num">%</th><th className="num">Se lleva</th><th className="num">Centro</th></tr></thead>
          <tbody>{detalle.map((x: any, i: number) => <tr key={i}><td>{fechaCorta(x.fecha)}</td>{!sel && <td>{x.profesional}</td>}<td>{x.paciente}</td><td>{x.descripcion}</td><td>{x.nro_boleta ?? "—"}</td><td className="num">{clp(x.monto)}</td><td className="num">{x.porcentaje ?? "—"}</td><td className="num">{clp(x.comision)}</td><td className="num">{clp(x.centro)}</td></tr>)}</tbody></table></div>}</div>
    </>}
  </>;
}

function Semanal() {
  const [fecha, setFecha] = useState(hoyStr());
  const d = useData(() => api.get<any>("/informes/semanal" + qs({ fecha })), [fecha]);
  const r = d.data, max = Math.max(1, ...(r?.por_dia ?? []).map((x: any) => x.ventas));
  const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  return <>
    <div className="barra-fecha sin-imprimir">
      <button className="btn-sec chico" onClick={() => setFecha(addDays(fecha, -7))} aria-label="Semana anterior">‹</button>
      <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} style={{ width: "auto" }} aria-label="Semana que contiene" />
      <button className="btn-sec chico" onClick={() => setFecha(addDays(fecha, 7))} aria-label="Semana siguiente">›</button>
      <button className="btn-sec chico" onClick={() => setFecha(hoyStr())}>Esta semana</button>
      <a className="btn" href={`/api/v1/informes/semanal/export${qs({ fecha })}`}>Exportar reporte semanal (Excel)</a>
      <button className="btn-sec chico" onClick={() => window.print()}>Imprimir</button>
    </div>
    <Alerta>{d.error}</Alerta>
    {!r ? <Cargando /> : <>
      <h3 style={{ textTransform: "capitalize" }}>Semana del {fechaLarga(r.desde).replace(/^[^,]*, /, "")} al {fechaLarga(r.hasta).replace(/^[^,]*, /, "")}</h3>
      <div className="rejilla" style={{ marginBottom: 18 }}>
        <Metrica titulo="Ventas de la semana" valor={clp(r.ventas_total)} />
        <Metrica titulo="Para los profesionales" valor={clp(r.comisiones)} />
        <Metrica titulo="Ganancia del centro" valor={clp(r.ganancia_centro)} />
        <Metrica titulo="Atenciones realizadas" valor={r.citas_realizadas} nota={`${r.citas_pendientes} pendiente(s)`} />
        <Metrica titulo="Cancelaciones" valor={r.citas_canceladas} tono={r.citas_canceladas ? "alerta" : undefined} />
        <Metrica titulo="Inasistencias" valor={r.inasistencias} tono={r.inasistencias ? "alerta" : undefined} />
        <Metrica titulo="Pacientes nuevos" valor={r.pacientes_nuevos} />
      </div>
      <div className="dos">
        <div className="tarjeta"><h3>Ventas por día</h3>{r.por_dia.map((x: any, i: number) => (
          <div key={x.fecha} style={{ display: "grid", gridTemplateColumns: "44px 1fr 90px", gap: 8, alignItems: "center", marginBottom: 6 }}><span>{DIAS[i]} {x.fecha.slice(8)}</span>
            <div className="progreso" style={{ margin: 0 }}><div style={{ width: `${(x.ventas / max) * 100}%` }} /></div><span style={{ textAlign: "right" }}>{clp(x.ventas)}</span></div>))}</div>
        <div className="tarjeta"><h3>Medios de pago</h3>{r.por_medio.length === 0 ? <Vacio>Sin cobros esta semana.</Vacio> : r.por_medio.map((m: any) => <p key={m.medio_pago} style={{ margin: "0 0 6px", display: "flex", justifyContent: "space-between" }}><span>{MEDIOS[m.medio_pago] ?? m.medio_pago} <small style={{ color: "var(--gris)" }}>({m.cobros})</small></span><b>{clp(m.monto)}</b></p>)}
          <h3 style={{ marginTop: 16 }}>Tratamientos más vendidos</h3>{r.top_servicios.length === 0 ? <Vacio>Sin datos.</Vacio> : r.top_servicios.map((m: any) => <p key={m.servicio} style={{ margin: "0 0 6px", display: "flex", justifyContent: "space-between" }}><span>{m.servicio} <small style={{ color: "var(--gris)" }}>({m.cobros})</small></span><b>{clp(m.monto)}</b></p>)}</div>
      </div>
      <div className="tarjeta"><h3>Lo que se lleva cada persona</h3><div className="tabla-wrap"><table><thead><tr><th>Persona</th><th className="num">Atenciones</th><th className="num">Ventas</th><th className="num">Se lleva</th><th className="num">Centro</th></tr></thead>
        <tbody>{r.por_profesional.map((x: any) => <tr key={x.profesional_id}><td><b>{x.nombre}</b> <small style={{ color: "var(--gris)" }}>{x.contrato === "PORCENTAJE" ? `${x.porcentaje}%` : "sin comisión"}</small></td><td className="num">{x.atenciones}</td><td className="num">{clp(x.ventas)}</td><td className="num"><b>{clp(x.comision)}</b></td><td className="num">{clp(x.centro)}</td></tr>)}</tbody></table></div></div>
    </>}
  </>;
}

export default function Informes() {
  const { user } = useAuth(); const admin = user!.rol === "ADMIN";
  const [tab, setTab] = useState("ganancias");
  return <>
    <div className="pagina-cab sin-imprimir"><h2>{admin ? "Informes" : "Mi informe de ganancias"}</h2></div>
    {admin && <div className="sin-imprimir"><Pestanas activa={tab} onChange={setTab} items={[["ganancias", "Ganancias por persona"], ["semanal", "Reporte semanal"]]} /></div>}
    {tab === "ganancias" || !admin ? <Ganancias /> : <Semanal />}
  </>;
}
