import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ANTECEDENTES, addDays, api, clp, fechaCorta, hoyStr, MEDIOS, qs } from "./api";
import { Alerta, Campo, Cargando, Insignia, Modal, Pestanas, useData, useToast } from "./ui";

/** Registrar un cobro: de una atención o libre. */
export function CobroModal({ cita, onClose, onDone }: { cita?: any; onClose(): void; onDone(): void }) {
  const toast = useToast();
  const [modo, setModo] = useState(cita ? "cita" : "cita");
  const [citaId, setCitaId] = useState<string>(cita ? String(cita.id) : "");
  const [desc, setDesc] = useState(""), [monto, setMonto] = useState<string>(cita ? String(cita.precio) : "");
  const [medio, setMedio] = useState("EFECTIVO"), [boleta, setBoleta] = useState("");
  const [error, setError] = useState(""), [enviando, setEnviando] = useState(false);
  const pendientes = useData(() => (cita ? Promise.resolve([cita]) : api.get<any[]>("/citas" + qs({ desde: addDays(hoyStr(), -10), hasta: hoyStr() }))), []);
  const lista = (pendientes.data ?? []).filter((c) => !c.pagada && c.estado !== "CANCELADA" && c.estado !== "INASISTENCIA");
  const elegida = lista.find((c) => String(c.id) === citaId);

  async function enviar(e: FormEvent) {
    e.preventDefault(); setError(""); setEnviando(true);
    try {
      const base: any = { medio_pago: medio, nro_boleta: boleta || null };
      if (modo === "cita") { base.cita_id = Number(citaId); if (monto) base.monto = Number(monto); }
      else { base.descripcion = desc; base.monto = Number(monto); }
      await api.post("/ventas", base);
      toast("Cobro registrado"); onDone(); onClose();
    } catch (err: any) { setError(err.message); } finally { setEnviando(false); }
  }
  return (
    <Modal titulo="Registrar cobro" onClose={onClose}>
      {!cita && <Pestanas items={[["cita", "Atención"], ["libre", "Otro"]]} activa={modo} onChange={(k) => { setModo(k); setMonto(""); }} />}
      <form onSubmit={enviar} className="form-rejilla">
        <div className="ancho campo"><Alerta>{error}</Alerta></div>
        {modo === "cita" && (cita ? (
          <Campo label="Atención" ancho><input type="text" readOnly value={`${cita.paciente} · ${cita.servicio} · ${cita.fecha} ${cita.hora}`} /></Campo>
        ) : (
          <Campo label="Atención sin cobrar (últimos 10 días)" ancho>
            <select value={citaId} onChange={(e) => { setCitaId(e.target.value); const c = lista.find((x) => String(x.id) === e.target.value); setMonto(c ? String(c.precio) : ""); }} required>
              <option value="">Seleccione…</option>{lista.map((c) => <option key={c.id} value={c.id}>{c.fecha} {c.hora} · {c.paciente} · {c.servicio}</option>)}
            </select>
          </Campo>
        ))}
        {modo === "libre" && <Campo label="Descripción" ancho><input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} required minLength={2} /></Campo>}
        {<Campo label={modo === "cita" && elegida ? `Monto (valor del servicio ${clp(elegida.precio)})` : "Monto"}><input type="number" min={0} value={monto} onChange={(e) => setMonto(e.target.value)} required={modo === "libre"} /></Campo>}
        <Campo label="Medio de pago"><select value={medio} onChange={(e) => setMedio(e.target.value)}>{Object.entries(MEDIOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
        <Campo label="N° de boleta (opcional)"><input type="text" value={boleta} onChange={(e) => setBoleta(e.target.value)} placeholder="Emitida en su sistema de pago" /></Campo>
        <div className="ancho acciones" style={{ gridColumn: "1 / -1" }}><button className="btn" disabled={enviando}>Registrar cobro</button><button type="button" className="btn-sec" onClick={onClose}>Cancelar</button></div>
      </form>
    </Modal>
  );
}

/** Evolución clínica de una sesión. */
export function EvolucionModal({ cita, onClose, onDone }: { cita: any; onClose(): void; onDone(): void }) {
  const toast = useToast();
  const actual = useData(() => api.get<any>(`/citas/${cita.id}/evolucion`), []);
  const [f, setF] = useState<any>(null), [error, setError] = useState("");
  const v = f ?? { observaciones: actual.data?.observaciones ?? "", procedimiento: actual.data?.procedimiento ?? "", recomendaciones: actual.data?.recomendaciones ?? "" };
  const set = (k: string, val: string) => setF({ ...v, [k]: val });
  async function enviar(e: FormEvent) {
    e.preventDefault(); setError("");
    try { await api.post(`/citas/${cita.id}/evolucion`, { observaciones: v.observaciones, procedimiento: v.procedimiento || null, recomendaciones: v.recomendaciones || null }); toast("Evolución guardada"); onDone(); onClose(); }
    catch (err: any) { setError(err.message); }
  }
  return (
    <Modal titulo={`Evolución · ${cita.paciente}`} onClose={onClose}>
      <p style={{ marginTop: 0, color: "var(--gris)" }}>{cita.servicio} · {cita.fecha} {cita.hora}{cita.nro_sesion ? ` · sesión ${cita.nro_sesion}` : ""}</p>
      <form onSubmit={enviar} className="form-rejilla">
        <div className="campo ancho"><Alerta>{error}</Alerta></div>
        <Campo label="Observaciones" ancho><textarea rows={4} value={v.observaciones} onChange={(e) => set("observaciones", e.target.value)} required /></Campo>
        <Campo label="Procedimiento aplicado" ancho><textarea rows={2} value={v.procedimiento} onChange={(e) => set("procedimiento", e.target.value)} /></Campo>
        <Campo label="Recomendaciones" ancho><textarea rows={2} value={v.recomendaciones} onChange={(e) => set("recomendaciones", e.target.value)} /></Campo>
        <div className="campo ancho acciones"><button className="btn">Guardar evolución</button><button type="button" className="btn-sec" onClick={onClose}>Cancelar</button></div>
      </form>
    </Modal>
  );
}

/** Resumen clínico previo: lo que se hizo antes, para consultarlo al atender. */
export function HistorialModal({ pacienteId, citaId, onClose }: { pacienteId: number; citaId?: number; onClose(): void }) {
  const { data: p, error } = useData(() => api.get<any>(`/pacientes/${pacienteId}`), [pacienteId]);
  return (
    <Modal titulo="Historial del paciente" onClose={onClose} ancho={760}>
      {error && <Alerta>{error}</Alerta>}
      {!p ? !error && <Cargando /> : (() => {
        const previas = p.citas.filter((c: any) => c.id !== citaId && c.estado === "REALIZADA");
        const ultima = previas[0];
        const pendientes = p.seguimientos.filter((s: any) => s.proximo_control && !s.control_resuelto);
        return (<>
          <h3 style={{ marginBottom: 2 }}>{p.nombre}</h3>
          <p style={{ margin: "0 0 12px", color: "var(--gris)" }}>{p.rut}{p.edad ? ` · ${p.edad} años` : ""} · <Link to={`/pacientes/${p.id}`}>Abrir ficha completa</Link></p>
          {(p.antecedentes.length > 0 || p.medicamentos || p.otras) && (
            <Alerta tipo="info"><b>Tenga en cuenta:</b> {p.antecedentes.map((a: string) => ANTECEDENTES[a] ?? a).join(", ") || "sin antecedentes"}{p.medicamentos ? ` · Medicamentos: ${p.medicamentos}` : ""}{p.otras ? ` · ${p.otras}` : ""}</Alerta>)}
          {!p.consentimientos.length && <Alerta>El paciente aún no tiene consentimiento informado firmado.</Alerta>}
          {pendientes.map((s: any) => <Alerta key={s.id} tipo="info"><b>Control pendiente ({fechaCorta(s.proximo_control)}):</b> {s.texto}</Alerta>)}
          <h4>Última atención</h4>
          {!ultima ? <p style={{ color: "var(--gris)" }}>Es la primera atención registrada.</p> : (
            <div className="evolucion" style={{ marginTop: 0 }}><b>{fechaCorta(ultima.fecha)} · {ultima.servicio}{ultima.nro_sesion ? ` (sesión ${ultima.nro_sesion})` : ""} · {ultima.profesional}</b><br />
              {ultima.observaciones ? <>{ultima.observaciones}{ultima.procedimiento && <><br /><b>Procedimiento:</b> {ultima.procedimiento}</>}{ultima.recomendaciones && <><br /><b>Recomendaciones:</b> {ultima.recomendaciones}</>}</> : <i>Sin evolución registrada.</i>}</div>)}
          {p.planes.filter((x: any) => x.estado === "ACTIVO").map((pl: any) => (
            <div key={pl.id} style={{ margin: "12px 0" }}><b>{pl.servicio}</b>: {pl.sesiones_realizadas} de {pl.sesiones_total} sesiones<div className="progreso"><div style={{ width: `${Math.min(100, (pl.sesiones_realizadas / pl.sesiones_total) * 100)}%` }} /></div></div>))}
          {previas.length > 1 && <><h4 style={{ marginTop: 14 }}>Atenciones anteriores</h4>
            <div className="linea-tiempo">{previas.slice(1, 6).map((c: any) => <div key={c.id} className="item"><b>{fechaCorta(c.fecha)}</b> · {c.servicio}{c.nro_sesion ? ` (sesión ${c.nro_sesion})` : ""} · {c.profesional}{c.observaciones && <div className="evolucion">{c.observaciones}</div>}</div>)}</div></>}
          {p.seguimientos.length > 0 && <><h4 style={{ marginTop: 14 }}>Seguimiento reciente</h4>
            {p.seguimientos.slice(0, 4).map((s: any) => <p key={s.id} style={{ margin: "0 0 6px", fontSize: ".88rem" }}><span className="etiqueta">{s.tipo}</span> {s.texto} <small style={{ color: "var(--gris)" }}>— {s.usuario_nombre}, {fechaCorta(String(s.created_at).slice(0, 10))}</small></p>)}</>}
          <div className="acciones" style={{ marginTop: 16 }}><a className="btn-sec chico" href={`/api/v1/pacientes/${p.id}/historial.pdf`} target="_blank" rel="noopener">Descargar historial PDF</a><button className="btn chico" onClick={onClose}>Cerrar</button></div>
        </>);
      })()}
    </Modal>
  );
}

/** Buscador de pacientes por RUT (con o sin puntos y guion) o nombre. */
function useBusqueda(q: string) {
  const [res, setRes] = useState<any[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    let vivo = true; const t = setTimeout(() => api.get<any[]>("/pacientes?q=" + encodeURIComponent(q.trim())).then((r) => vivo && setRes(r.slice(0, 8))).catch(() => vivo && setRes([])), 200);
    return () => { vivo = false; clearTimeout(t); };
  }, [q]);
  return res;
}
const Resultados = ({ res, onElegir }: { res: any[] | null; onElegir(p: any): void }) => res === null ? null : (
  <div className="resultados">{res.length === 0 ? <div className="sin">Sin resultados. ¿Es un paciente nuevo?</div> : res.map((p) => <button type="button" key={p.id} onClick={() => onElegir(p)}><b>{p.nombre}</b><small>{p.rut}{p.celular ? ` · ${p.celular}` : ""}</small></button>)}</div>);

export function BuscadorGlobal() {
  const nav = useNavigate(); const [q, setQ] = useState(""); const res = useBusqueda(q);
  return (
    <div className="buscador sin-imprimir">
      <input type="search" placeholder="Buscar por RUT o nombre…" value={q} aria-label="Buscar paciente por RUT" onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && res?.[0]) { nav(`/pacientes/${res[0].id}`); setQ(""); } if (e.key === "Escape") setQ(""); }} />
      <Resultados res={res} onElegir={(p) => { nav(`/pacientes/${p.id}`); setQ(""); }} />
    </div>
  );
}

export function SelectorPaciente({ value, onChange }: { value: any | null; onChange(p: any | null): void }) {
  const [q, setQ] = useState(""); const res = useBusqueda(q);
  if (value) return <div className="paciente-sel"><span><b>{value.nombre}</b> · {value.rut}</span><button type="button" className="btn-sec chico" onClick={() => onChange(null)}>Cambiar</button></div>;
  return <div className="buscador" style={{ minWidth: 0 }}><input type="search" placeholder="Escriba el RUT o el nombre del paciente…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /><Resultados res={res} onElegir={(p) => { onChange(p); setQ(""); }} /></div>;
}

/** Bloques de 30 minutos libres del profesional en la fecha elegida. */
export function SelectorBloques({ fecha, profesionalId, duracion, pacienteId, excluir, hora, onChange }: { fecha: string; profesionalId: number | string; duracion: number; pacienteId?: number | string; excluir?: number; hora: string; onChange(hora: string, boxesLibres: number[]): void }) {
  const d = useData(() => (profesionalId && fecha ? api.get<any>("/citas/disponibilidad" + qs({ fecha, profesional_id: profesionalId, duracion_min: duracion, paciente_id: pacienteId, excluir })) : Promise.resolve(null)), [fecha, profesionalId, duracion, pacienteId, excluir]);
  // Si el horario ya elegido deja de estar libre (cambió el profesional, la fecha o la duración), se descarta.
  useEffect(() => {
    if (!d.data || !hora) return;
    const s = d.data.slots.find((x: any) => x.hora === hora);
    if (!s || !s.libre) onChange("", []); else onChange(hora, s.boxes_libres);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.data]);
  if (!profesionalId) return <p style={{ color: "var(--gris)", margin: 0, fontSize: ".85rem" }}>Elija primero el profesional para ver sus horarios libres.</p>;
  if (!d.data) return <p style={{ color: "var(--gris)", margin: 0 }}>Buscando horarios…</p>;
  const libres = d.data.slots.filter((s: any) => s.libre).length;
  return (
    <div>
      <div className="bloques" role="group" aria-label="Horarios disponibles">
        {d.data.slots.map((s: any) => <button type="button" key={s.hora} disabled={!s.libre} title={s.libre ? `Libre · ${duracion} min` : s.motivo} className={`bloque${hora === s.hora ? " sel" : ""}`} onClick={() => onChange(s.hora, s.boxes_libres)}>{s.hora}</button>)}
      </div>
      <small style={{ color: "var(--gris)" }}>{libres === 0 ? "No quedan horarios libres este día para este profesional." : `${libres} horario(s) libre(s) · cada cita ocupa ${duracion} minutos (bloques de 30).`}</small>
    </div>
  );
}
