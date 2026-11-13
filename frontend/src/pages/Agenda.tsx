import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { addDays, api, ApiError, clp, ESTADOS, fechaCorta, fechaLarga, hoyStr, qs } from "../api";
import { Alerta, Campo, Modal, Vacio, useData, useToast } from "../ui";
import { CobroModal, EvolucionModal, HistorialModal, SelectorBloques, SelectorPaciente } from "../forms";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fin = (hora: string, min: number) => hhmm(Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3)) + min);
const lunesDe = (f: string) => { const d = new Date(f + "T12:00:00Z"); return addDays(f, -((d.getUTCDay() + 6) % 7)); };
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const ROT = { fontSize: ".72rem", textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--gris)", fontWeight: 600 };

function NuevaCita({ fecha, preset, onClose, onDone }: { fecha: string; preset?: { paciente_id?: string; profesional_id?: number; hora?: string }; onClose(): void; onDone(): void }) {
  const { user } = useAuth(); const toast = useToast();
  const profs = useData(() => api.get<any[]>("/profesionales"), []);
  const servs = useData(() => api.get<any[]>("/servicios"), []);
  const boxes = useData(() => api.get<any[]>("/boxes"), []);
  const pre = useData(() => (preset?.paciente_id ? api.get<any>(`/pacientes/${preset.paciente_id}`) : Promise.resolve(null)), []);
  const [paciente, setPaciente] = useState<any>(null);
  const [f, setF] = useState<any>({ servicio_id: "", profesional_id: preset?.profesional_id ?? user!.profesionalId ?? "", box_id: "", fecha, hora: preset?.hora ?? "", notas: "" });
  const [libres, setLibres] = useState<number[]>([]), [error, setError] = useState("");
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const pac = paciente ?? (pre.data ? { id: pre.data.id, nombre: pre.data.nombre, rut: pre.data.rut } : null);
  const srv = (servs.data ?? []).find((s) => String(s.id) === String(f.servicio_id));
  const dur = srv?.duracion_min ?? 30;
  async function enviar(e: FormEvent) {
    e.preventDefault(); setError("");
    if (!pac) return setError("Busque y seleccione al paciente (por RUT o nombre).");
    if (!f.hora) return setError("Elija uno de los horarios libres del profesional.");
    const body = { paciente_id: pac.id, servicio_id: Number(f.servicio_id), profesional_id: Number(f.profesional_id), box_id: Number(f.box_id), fecha: f.fecha, hora: f.hora, notas: f.notas || null };
    try {
      try { await api.post("/citas", body); }
      catch (err) { if (err instanceof ApiError && err.code === "PLAN_EXCEDIDO" && confirm(err.message)) await api.post("/citas", { ...body, forzar: true }); else throw err; }
      toast("Cita agendada"); onDone(); onClose();
    } catch (err: any) { setError(err.message); }
  }
  const boxesVisibles = (boxes.data ?? []).filter((b) => b.activo && (libres.length === 0 || libres.includes(b.id)));
  return (
    <Modal titulo="Nueva cita" onClose={onClose} ancho={680}>
      <form onSubmit={enviar} className="form-rejilla">
        <div className="campo ancho"><Alerta>{error}</Alerta></div>
        <div className="campo ancho"><span style={ROT}>Paciente (buscar por RUT o nombre)</span><SelectorPaciente value={pac} onChange={setPaciente} /></div>
        <p className="campo ancho" style={{ margin: 0, fontSize: ".8rem" }}>¿Paciente nuevo? <Link to="/pacientes/nuevo">Crear ficha de ingreso</Link></p>
        <Campo label="Tratamiento" ancho>
          <select value={f.servicio_id} onChange={(e) => set("servicio_id", e.target.value)} required><option value="">Seleccione…</option>{(servs.data ?? []).filter((s) => s.activo).map((s) => <option key={s.id} value={s.id}>{s.nombre} · {clp(s.precio)} · {s.duracion_min} min{s.sesiones > 1 ? ` · ${s.sesiones} sesiones` : ""}</option>)}</select>
        </Campo>
        {srv && srv.sesiones > 1 && <div className="campo ancho"><Alerta tipo="info">Este tratamiento es por plan de {srv.sesiones} sesiones. Se usará el plan activo del paciente o se creará uno nuevo (se puede ajustar en su ficha).</Alerta></div>}
        <Campo label="¿Con qué profesional será la atención?"><select value={f.profesional_id} onChange={(e) => set("profesional_id", e.target.value)} required disabled={user!.rol === "PROFESIONAL"}><option value="">Seleccione…</option>{(profs.data ?? []).filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.especialidad ? ` · ${p.especialidad}` : ""}</option>)}</select></Campo>
        <Campo label="Fecha"><input type="date" value={f.fecha} onChange={(e) => set("fecha", e.target.value)} required /></Campo>
        <div className="campo ancho"><span style={ROT}>Horario (bloques de 30 minutos)</span>
          <SelectorBloques fecha={f.fecha} profesionalId={f.profesional_id} duracion={dur} pacienteId={pac?.id} hora={f.hora} onChange={(h, b) => { set("hora", h); setLibres(b); if (b.length && !b.includes(Number(f.box_id))) set("box_id", String(b[0])); }} /></div>
        <Campo label="Box"><select value={f.box_id} onChange={(e) => set("box_id", e.target.value)} required><option value="">Seleccione…</option>{boxesVisibles.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</select></Campo>
        <Campo label="Notas (opcional)"><input type="text" value={f.notas} onChange={(e) => set("notas", e.target.value)} /></Campo>
        <div className="campo ancho acciones"><button className="btn">Agendar</button><button type="button" className="btn-sec" onClick={onClose}>Cancelar</button></div>
      </form>
    </Modal>
  );
}

function EditarCita({ cita, onClose, onDone }: { cita: any; onClose(): void; onDone(): void }) {
  const { user } = useAuth(); const toast = useToast();
  const admin = user!.rol === "ADMIN";
  const boxes = useData(() => api.get<any[]>("/boxes"), []), profs = useData(() => api.get<any[]>("/profesionales"), []), servs = useData(() => api.get<any[]>("/servicios"), []);
  const editable = cita.estado === "AGENDADA" || cita.estado === "CONFIRMADA";
  const [f, setF] = useState<any>({ fecha: cita.fecha, hora: cita.hora, box_id: cita.box_id, profesional_id: cita.profesional_id, servicio_id: cita.servicio_id, duracion_min: cita.fin_min - cita.inicio_min, notas: cita.notas ?? "" });
  const [libres, setLibres] = useState<number[]>([]), [error, setError] = useState("");
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const puedeProf = editable ? admin : admin && cita.estado === "REALIZADA";
  const cambiaHorario = f.fecha !== cita.fecha || f.hora !== cita.hora;
  async function guardar(e: FormEvent) {
    e.preventDefault(); setError("");
    const body: any = { notas: f.notas || null };
    if (editable) Object.assign(body, { fecha: f.fecha, hora: f.hora, box_id: Number(f.box_id), servicio_id: Number(f.servicio_id), duracion_min: Number(f.duracion_min) });
    if (puedeProf && Number(f.profesional_id) !== cita.profesional_id) body.profesional_id = Number(f.profesional_id);
    try {
      try { await api.patch(`/citas/${cita.id}`, body); }
      catch (err) { if (err instanceof ApiError && err.code === "PLAN_EXCEDIDO" && confirm(err.message)) await api.patch(`/citas/${cita.id}`, { ...body, forzar: true }); else throw err; }
      toast("Cita actualizada"); onDone(); onClose();
    } catch (err: any) { setError(err.message); }
  }
  async function eliminar() {
    if (!confirm(`¿Eliminar la cita de ${cita.paciente} (${fechaCorta(cita.fecha)} ${cita.hora})? Esta acción no se puede deshacer.`)) return;
    try { await api.del(`/citas/${cita.id}`); toast("Cita eliminada"); onDone(); onClose(); } catch (err: any) { setError(err.message); }
  }
  return (
    <Modal titulo={`Editar cita · ${cita.paciente}`} onClose={onClose} ancho={680}>
      <form onSubmit={guardar} className="form-rejilla">
        <div className="campo ancho"><Alerta>{error}</Alerta>{!editable && <Alerta tipo="info">Esta atención está «{ESTADOS[cita.estado]}»: solo se pueden editar las notas{admin && cita.estado === "REALIZADA" ? " y corregir el profesional que atendió" : ""}.</Alerta>}</div>
        <Campo label="Tratamiento" ancho><select value={f.servicio_id} onChange={(e) => { set("servicio_id", e.target.value); const s = (servs.data ?? []).find((x) => String(x.id) === e.target.value); if (s) set("duracion_min", s.duracion_min); }} disabled={!editable}>{(servs.data ?? []).filter((s) => s.activo || s.id === cita.servicio_id).map((s) => <option key={s.id} value={s.id}>{s.nombre} · {clp(s.precio)}</option>)}</select></Campo>
        <Campo label="Profesional que atiende"><select value={f.profesional_id} onChange={(e) => set("profesional_id", e.target.value)} disabled={!puedeProf}>{(profs.data ?? []).filter((p) => p.activo || p.id === cita.profesional_id).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
        <Campo label="Fecha"><input type="date" value={f.fecha} onChange={(e) => set("fecha", e.target.value)} disabled={!editable} required /></Campo>
        {editable && <div className="campo ancho"><span style={ROT}>Horario (bloques de 30 minutos) · actual: {cita.hora}</span>
          <SelectorBloques fecha={f.fecha} profesionalId={f.profesional_id} duracion={Number(f.duracion_min)} pacienteId={cita.paciente_id} excluir={cita.id} hora={f.hora} onChange={(h, b) => { set("hora", h); setLibres(b); if (b.length && !b.includes(Number(f.box_id))) set("box_id", String(b[0])); }} /></div>}
        <Campo label="Box"><select value={f.box_id} onChange={(e) => set("box_id", e.target.value)} disabled={!editable}>{(boxes.data ?? []).filter((b) => (b.activo && (libres.length === 0 || libres.includes(b.id))) || b.id === Number(f.box_id)).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</select></Campo>
        <Campo label="Duración"><select value={f.duracion_min} onChange={(e) => set("duracion_min", e.target.value)} disabled={!editable}>{[30, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutos</option>)}</select></Campo>
        <Campo label="Notas de la cita" ancho><textarea rows={2} value={f.notas} onChange={(e) => set("notas", e.target.value)} placeholder="Ej. llega con indicación médica, preferencia de horario…" /></Campo>
        {cambiaHorario && editable && <div className="campo ancho"><Alerta tipo="info">Si el paciente tiene correo registrado, recibirá un aviso automático del cambio.</Alerta></div>}
        {puedeProf && Number(f.profesional_id) !== cita.profesional_id && cita.pagada && <div className="campo ancho"><Alerta tipo="info">La atención ya está cobrada: la ganancia pasará al nuevo profesional según su porcentaje.</Alerta></div>}
        <div className="campo ancho acciones"><button className="btn">Guardar cambios</button><button type="button" className="btn-sec" onClick={onClose}>Cancelar</button><button type="button" className="btn-sec btn-peligro" onClick={eliminar} style={{ marginLeft: "auto" }}>Eliminar cita</button></div>
      </form>
    </Modal>
  );
}

/** Vista del día con una columna por profesional y filas de 30 minutos. */
function GrillaProfesionales({ citas, profs, onNueva, onEditar }: { citas: any[]; profs: any[]; onNueva(profId: number, hora: string): void; onEditar(c: any): void }) {
  const cfg = useData(() => api.get<Record<string, string>>("/config"), []);
  const [h0, h1] = [cfg.data?.horario_inicio ?? "09:00", cfg.data?.horario_fin ?? "19:00"].map((h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3)));
  const filas: number[] = []; for (let m = h0; m < h1; m += 30) filas.push(m);
  const vivas = citas.filter((c) => c.estado !== "CANCELADA" && c.estado !== "INASISTENCIA");
  if (!profs.length) return <Vacio>No hay profesionales activos.</Vacio>;
  const cubiertas = new Set<string>();
  vivas.forEach((c) => { for (let m = c.inicio_min + 30; m < c.fin_min; m += 30) cubiertas.add(`${c.profesional_id}-${m}`); });
  return (
    <div className="grilla-wrap"><table className="grilla"><thead><tr><th style={{ width: 62 }} />{profs.map((p) => <th key={p.id}>{p.nombre}</th>)}</tr></thead>
      <tbody>{filas.map((m) => (
        <tr key={m}><td className="h">{hhmm(m)}</td>
          {profs.map((p) => {
            if (cubiertas.has(`${p.id}-${m}`)) return null;
            const c = vivas.find((x) => x.profesional_id === p.id && x.inicio_min === m);
            if (c) return <td key={p.id} rowSpan={Math.max(1, Math.ceil((c.fin_min - c.inicio_min) / 30))}><button className={`ocupada est-${c.estado}`} onClick={() => onEditar(c)} title={`${c.paciente} · ${c.servicio}`}><b>{c.paciente}</b><small>{c.servicio} · {c.box}</small></button></td>;
            return <td key={p.id} className="libre" onClick={() => onNueva(p.id, hhmm(m))} title={`Agendar con ${p.nombre} a las ${hhmm(m)}`} />;
          })}</tr>))}</tbody></table></div>
  );
}

export default function Agenda() {
  const { user } = useAuth(); const toast = useToast();
  const admin = user!.rol === "ADMIN";
  const [params, setParams] = useSearchParams();
  const [fecha, setFecha] = useState(hoyStr()), [prof, setProf] = useState(""), [vista, setVista] = useState<"dia" | "profesionales" | "semana">("dia");
  const [nueva, setNueva] = useState<null | { profesional_id?: number; hora?: string }>(params.has("nueva") || params.has("paciente") ? {} : null);
  const [editar, setEditar] = useState<any>(null), [cobrar, setCobrar] = useState<any>(null), [evol, setEvol] = useState<any>(null), [hist, setHist] = useState<any>(null);
  const profs = useData(() => api.get<any[]>("/profesionales"), []);
  const desde = vista === "semana" ? lunesDe(fecha) : fecha, hasta = vista === "semana" ? addDays(lunesDe(fecha), 6) : fecha;
  const citas = useData(() => api.get<any[]>("/citas" + qs({ desde, hasta, profesional_id: admin ? prof : undefined })), [desde, hasta, prof]);
  useEffect(() => { if (params.has("nueva") || params.has("paciente")) setParams({}, { replace: true }); }, []); // eslint-disable-line
  const [pacPreset] = useState(params.get("paciente") ?? undefined);
  const paso = vista === "semana" ? 7 : 1;
  const activos = (profs.data ?? []).filter((p) => p.activo && (admin || p.id === user!.profesionalId));

  async function cambiarEstado(c: any, estado: string) {
    try { await api.post(`/citas/${c.id}/estado`, { estado }); citas.reload(); } catch (e: any) { toast(e.message, "error"); citas.reload(); }
  }
  async function encuesta(c: any) {
    try { const r = await api.post(`/seguimiento/encuesta/${c.id}`); if (r.wa_link) window.open(r.wa_link, "_blank", "noopener"); else toast("El paciente no tiene celular registrado", "error"); } catch (e: any) { toast(e.message, "error"); }
  }
  const lista = citas.data ?? [];
  const titulo = vista === "semana" ? `Semana del ${fechaLarga(desde).replace(/^[^,]*, /, "")} al ${fechaLarga(hasta).replace(/^[^,]*, /, "")}` : fechaLarga(fecha);
  return (
    <>
      <div className="pagina-cab"><h2>Agenda</h2><button className="btn" onClick={() => setNueva({})}>+ Nueva cita</button></div>
      <div className="barra-fecha">
        <button className="btn-sec chico" onClick={() => setFecha(addDays(fecha, -paso))} aria-label="Anterior">‹</button>
        <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Fecha" />
        <button className="btn-sec chico" onClick={() => setFecha(addDays(fecha, paso))} aria-label="Siguiente">›</button>
        <button className="btn-sec chico" onClick={() => setFecha(hoyStr())}>Hoy</button>
        <div className="pestanas" style={{ margin: 0, border: 0 }}>
          <button className={vista === "dia" ? "activa" : ""} onClick={() => setVista("dia")}>Día</button>
          <button className={vista === "profesionales" ? "activa" : ""} onClick={() => setVista("profesionales")}>Por profesional</button>
          <button className={vista === "semana" ? "activa" : ""} onClick={() => setVista("semana")}>Semana</button></div>
        {admin && vista !== "profesionales" && <select value={prof} onChange={(e) => setProf(e.target.value)} aria-label="Profesional"><option value="">Todos los profesionales</option>{(profs.data ?? []).filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>}
        <span className="fecha-titulo">{titulo} · {lista.length === 1 ? "1 cita" : `${lista.length} citas`}</span>
      </div>
      <Alerta>{citas.error}</Alerta>

      {vista === "profesionales" && <>
        <p style={{ color: "var(--gris)", marginTop: 0, fontSize: ".85rem" }}>Cada columna es un profesional y cada fila un bloque de 30 minutos. Haga clic en un bloque libre para agendar o en una cita para editarla.</p>
        <GrillaProfesionales citas={lista} profs={activos} onNueva={(profesional_id, hora) => setNueva({ profesional_id, hora })} onEditar={setEditar} /></>}

      {vista === "semana" && (
        <div className="semana">{Array.from({ length: 7 }, (_, i) => addDays(desde, i)).map((d, i) => {
          const del = lista.filter((c) => c.fecha === d);
          return <div key={d} className={`dia${d === hoyStr() ? " hoy" : ""}`}><div className="dia-cab" onClick={() => { setFecha(d); setVista("dia"); }}><b>{DIAS[i]}</b> {d.slice(8)}<small>{del.length ? ` · ${del.length}` : ""}</small></div>
            {del.map((c) => <button key={c.id} className={`mini est-${c.estado}`} onClick={() => setEditar(c)} title={`${c.paciente} · ${c.servicio} · ${c.profesional}`}><b>{c.hora}</b> {c.paciente.split(" ")[0]}<small>{c.profesional.split(" ")[0]} · {c.servicio}</small></button>)}
            {!del.length && <span className="libre">—</span>}</div>;
        })}</div>
      )}

      {vista === "dia" && <>
        {!citas.loading && lista.length === 0 && <div className="tarjeta"><Vacio>No hay pacientes agendados para este día.</Vacio></div>}
        {lista.map((c) => (
          <div key={c.id} className={`cita est-${c.estado}`}>
            <div className="hora">{c.hora}<small>a {fin(c.hora, c.fin_min - c.inicio_min)}</small></div>
            <div>
              <h4><Link to={`/pacientes/${c.paciente_id}`}>{c.paciente}</Link> <span className="etiqueta">{c.box}</span></h4>
              <p>{c.servicio} · <b>con {c.profesional}</b>{c.nro_sesion && c.sesiones_total ? ` · sesión ${c.nro_sesion} de ${c.sesiones_total}` : ""}</p>
              <p>{c.pagada ? <span className="etiqueta ok">Pagada</span> : <span className="etiqueta aviso">Sin cobrar · {clp(c.precio)}</span>} {c.tiene_evolucion && <span className="etiqueta">Con evolución</span>} {c.ultima_atencion ? <span className="etiqueta">Última visita: {fechaCorta(c.ultima_atencion)}</span> : <span className="etiqueta">Primera visita</span>}</p>
              {c.notas && <p style={{ fontStyle: "italic" }}>📝 {c.notas}</p>}
            </div>
            <div className="lado">
              <select value={c.estado} onChange={(e) => cambiarEstado(c, e.target.value)} aria-label="Estado de la cita">{Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button className="btn chico" onClick={() => setHist(c)}>Ver historial</button>
              {!c.pagada && c.estado !== "CANCELADA" && c.estado !== "INASISTENCIA" && <button className="btn-sec chico" onClick={() => setCobrar(c)}>Cobrar</button>}
              {c.estado !== "CANCELADA" && <button className="btn-sec chico" onClick={() => setEvol(c)}>Evolución</button>}
              <button className="btn-sec chico" onClick={() => setEditar(c)}>Editar</button>
              {admin && c.estado === "REALIZADA" && <button className="btn-sec chico" onClick={() => encuesta(c)}>Encuesta</button>}
            </div>
          </div>
        ))}</>}

      {nueva && <NuevaCita fecha={fecha} preset={{ paciente_id: pacPreset, ...nueva }} onClose={() => setNueva(null)} onDone={citas.reload} />}
      {editar && <EditarCita cita={editar} onClose={() => setEditar(null)} onDone={citas.reload} />}
      {cobrar && <CobroModal cita={cobrar} onClose={() => setCobrar(null)} onDone={citas.reload} />}
      {evol && <EvolucionModal cita={evol} onClose={() => setEvol(null)} onDone={citas.reload} />}
      {hist && <HistorialModal pacienteId={hist.paciente_id} citaId={hist.id} onClose={() => setHist(null)} />}
    </>
  );
}
