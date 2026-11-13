import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { api, clp, fechaCorta, mesActual, MEDIOS } from "../api";
import { Alerta, Campo, Cargando, Metrica, Modal, Vacio, useData, useToast } from "../ui";
import { CobroModal } from "../forms";

function EditarVenta({ venta, onClose, onDone }: { venta: any; onClose(): void; onDone(): void }) {
  const toast = useToast(); const [f, setF] = useState({ medio_pago: venta.medio_pago, nro_boleta: venta.nro_boleta ?? "", monto: String(venta.monto), fecha: venta.fecha }), [error, setError] = useState("");
  async function guardar(e: React.FormEvent) { e.preventDefault(); try { await api.patch(`/ventas/${venta.id}`, { medio_pago: f.medio_pago, nro_boleta: f.nro_boleta || null, monto: Number(f.monto), fecha: f.fecha }); toast("Venta actualizada"); onDone(); onClose(); } catch (err: any) { setError(err.message); } }
  return <Modal titulo={`Editar venta · ${venta.descripcion}`} onClose={onClose}>
    <form onSubmit={guardar} className="form-rejilla"><div className="campo ancho"><Alerta>{error}</Alerta></div>
      <Campo label="Monto"><input type="number" min={0} value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} required /></Campo>
      <Campo label="Fecha"><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} required /></Campo>
      <Campo label="Medio de pago"><select value={f.medio_pago} onChange={(e) => setF({ ...f, medio_pago: e.target.value })}>{Object.entries(MEDIOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
      <Campo label="N° de boleta"><input type="text" value={f.nro_boleta} onChange={(e) => setF({ ...f, nro_boleta: e.target.value })} /></Campo>
      <div className="campo ancho acciones"><button className="btn">Guardar</button><button type="button" className="btn-sec" onClick={onClose}>Cancelar</button></div></form></Modal>;
}

export default function Ventas() {
  const { user } = useAuth(); const toast = useToast();
  const admin = user!.rol === "ADMIN";
  const [params, setParams] = useSearchParams();
  const [mes, setMes] = useState(mesActual());
  const [cobrar, setCobrar] = useState(params.has("cobrar")), [editar, setEditar] = useState<any>(null);
  const v = useData(() => api.get<any>("/ventas?mes=" + mes), [mes]);
  if (params.has("cobrar")) setParams({}, { replace: true });

  async function anular(x: any) {
    if (!confirm(`¿Anular la venta "${x.descripcion}" por ${clp(x.monto)}? Esta acción queda en la auditoría.`)) return;
    try { await api.del(`/ventas/${x.id}`); toast("Venta anulada"); v.reload(); } catch (e: any) { toast(e.message, "error"); }
  }
  const d = v.data;
  return (
    <>
      <div className="pagina-cab"><h2>Ventas y cobros</h2>
        <div className="acciones">
          {admin && <a className="btn-sec" href={`/api/v1/ventas/export?mes=${mes}`}>Exportar Excel</a>}
          <button className="btn" onClick={() => setCobrar(true)}>+ Registrar cobro</button>
        </div></div>
      <div className="barra-fecha"><label>Mes: <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} style={{ width: "auto" }} /></label></div>
      <Alerta>{v.error}</Alerta>
      {!d ? <Cargando /> : <>
        <div className="rejilla" style={{ marginBottom: 18 }}>
          <Metrica titulo="Total del mes" valor={clp(d.total)} nota={`${d.ventas.length} venta(s)`} />
          {Object.entries(d.por_medio).map(([k, val]) => <Metrica key={k} titulo={MEDIOS[k] ?? k} valor={clp(val as number)} />)}
        </div>
        <div className="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Paciente</th><th>Descripción</th><th>Profesional</th><th>Medio</th><th>Boleta</th><th className="num">Monto</th>{admin && <th />}</tr></thead>
          <tbody>
            {d.ventas.map((x: any) => <tr key={x.id}><td>{fechaCorta(x.fecha)}</td><td>{x.paciente ?? "—"}</td><td>{x.descripcion}</td><td>{x.vendedor ?? "—"}</td><td>{MEDIOS[x.medio_pago]}</td><td>{x.nro_boleta ?? "—"}</td><td className="num">{clp(x.monto)}</td>{admin && <td className="acciones"><button className="btn-sec chico" onClick={() => setEditar(x)}>Editar</button><button className="btn-sec chico btn-peligro" onClick={() => anular(x)}>Anular</button></td>}</tr>)}
            {d.ventas.length === 0 && <tr><td colSpan={8}><Vacio>No hay ventas registradas en este mes.</Vacio></td></tr>}
          </tbody></table></div>
      </>}
      {editar && <EditarVenta venta={editar} onClose={() => setEditar(null)} onDone={v.reload} />}
      {cobrar && <CobroModal onClose={() => setCobrar(false)} onDone={() => { v.reload(); }} />}
    </>
  );
}
