import { useState } from "react";
import { addDays, api, fechaCorta, fechaLarga, hoyStr } from "../api";
import { Alerta, Cargando, Pestanas, Vacio, useData, useToast } from "../ui";

export default function Seguimiento() {
  const toast = useToast();
  const [tab, setTab] = useState("recordatorios");
  const [fecha, setFecha] = useState(addDays(hoyStr(), 1));
  const rec = useData(() => api.get<any>("/seguimiento/recordatorios?fecha=" + fecha), [fecha]);
  const man = useData(() => api.get<any[]>("/seguimiento/mantencion"), []);
  const ctl = useData(() => api.get<any[]>("/seguimiento/controles"), []);

  async function generar() {
    try { const r = await api.post("/seguimiento/recordatorios/generar", { fecha }); toast(r.smtp ? `${r.correos_enviados} correo(s) enviado(s)` : "Recordatorios preparados (correo no configurado: use WhatsApp)"); rec.reload(); }
    catch (e: any) { toast(e.message, "error"); }
  }
  async function whatsapp(it: any) {
    window.open(it.wa_link, "_blank", "noopener");
    try { await api.post(`/seguimiento/recordatorios/${it.id}/whatsapp-enviado`); rec.reload(); } catch { /* el registro es secundario */ }
  }
  return (
    <>
      <div className="pagina-cab"><h2>Seguimiento de pacientes</h2></div>
      <Pestanas items={[["recordatorios", "Recordatorios de citas"], ["controles", `Controles pendientes (${ctl.data?.length ?? 0})`], ["mantencion", `Mantención (${man.data?.length ?? 0})`]]} activa={tab} onChange={setTab} />
      {tab === "recordatorios" && <>
        <div className="barra-fecha">
          <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} style={{ width: "auto" }} aria-label="Fecha de las citas" />
          <span className="fecha-titulo">{fechaLarga(fecha)}</span>
          <button className="btn" onClick={generar}>Preparar y enviar correos</button>
        </div>
        {rec.data && !rec.data.smtp_configurado && <Alerta tipo="info">El envío automático por correo no está configurado en este equipo. Use el botón de WhatsApp para enviar cada recordatorio con el mensaje ya redactado.</Alerta>}
        <Alerta>{rec.error}</Alerta>
        {!rec.data ? <Cargando /> : rec.data.items.length === 0 ? <div className="tarjeta"><Vacio>No hay citas por recordar para esta fecha.</Vacio></div> : (
          <div className="tabla-wrap"><table><thead><tr><th>Hora</th><th>Paciente</th><th>Servicio</th><th>WhatsApp</th><th>Correo</th></tr></thead>
            <tbody>{rec.data.items.map((it: any) => (
              <tr key={it.id}><td><b>{it.hora}</b></td><td>{it.paciente}<br /><small style={{ color: "var(--gris)" }}>{it.celular ?? "Sin celular"}</small></td><td>{it.servicio}<br /><small style={{ color: "var(--gris)" }}>{it.profesional}</small></td>
                <td>{it.wa_link ? <><button className="btn chico" onClick={() => whatsapp(it)}>{it.estado_whatsapp === "ENVIADA" ? "Reenviar" : "Enviar WhatsApp"}</button> {it.estado_whatsapp === "ENVIADA" && <span className="etiqueta ok">Enviado</span>}</> : <span className="etiqueta aviso">Sin celular</span>}</td>
                <td>{it.email ? (it.estado_email ? <span className={`etiqueta ${it.estado_email === "ENVIADA" ? "ok" : "aviso"}`}>{it.estado_email === "ENVIADA" ? "Enviado" : it.estado_email === "ERROR" ? "Error" : "Pendiente"}</span> : <span className="etiqueta">Sin preparar</span>) : <span className="etiqueta aviso">Sin correo</span>}</td></tr>))}</tbody></table></div>
        )}
      </>}
      {tab === "controles" && (!ctl.data ? <Cargando /> : ctl.data.length === 0 ? <div className="tarjeta"><Vacio>No hay controles pendientes. Se agendan desde la ficha del paciente (Seguimiento → «Agendar control»).</Vacio></div> : (
        <div className="tabla-wrap"><table><thead><tr><th>Paciente</th><th>Detalle del control</th><th>Fecha</th><th>Indicado por</th><th /></tr></thead>
          <tbody>{ctl.data.map((x) => <tr key={x.id}><td><b>{x.nombre}</b><br /><small style={{ color: "var(--gris)" }}>{x.celular ?? "Sin celular"}</small></td><td>{x.texto}</td><td>{fechaCorta(x.proximo_control)} {x.vencido && <span className="etiqueta aviso">Vencido</span>}</td><td>{x.usuario_nombre ?? "—"}</td>
            <td className="acciones">{x.wa_link && <a className="btn chico" href={x.wa_link} target="_blank" rel="noopener">WhatsApp</a>}<a className="btn-sec chico" href={`/pacientes/${x.paciente_id}`}>Ver ficha</a></td></tr>)}</tbody></table></div>
      ))}
      {tab === "mantencion" && (!man.data ? <Cargando /> : man.data.length === 0 ? <div className="tarjeta"><Vacio>No hay pacientes por contactar por mantención.</Vacio></div> : (
        <div className="tabla-wrap"><table><thead><tr><th>Paciente</th><th>Tratamiento</th><th>Última atención</th><th>Fecha de mantención</th><th /></tr></thead>
          <tbody>{man.data.map((x) => <tr key={`${x.paciente_id}-${x.servicio_id}`}><td><b>{x.nombre}</b><br /><small style={{ color: "var(--gris)" }}>{x.celular ?? "Sin celular"}</small></td><td>{x.servicio}</td><td>{fechaCorta(x.ultima_atencion)}</td>
            <td>{fechaCorta(x.fecha_limite)} {x.fecha_limite <= hoyStr() && <span className="etiqueta aviso">Vencida</span>}</td>
            <td>{x.wa_link ? <a className="btn chico" href={x.wa_link} target="_blank" rel="noopener">Contactar por WhatsApp</a> : <span className="etiqueta aviso">Sin celular</span>}</td></tr>)}</tbody></table></div>
      ))}
    </>
  );
}
