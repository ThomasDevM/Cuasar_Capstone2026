import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { ANTECEDENTES, api, clp, fechaCorta, fechaHora, formatearRut, validarRut } from "../api";
import { Alerta, Campo, Cargando, Firma, Insignia, Modal, Pestanas, Vacio, useData, useToast } from "../ui";
import { EvolucionModal } from "../forms";

export function PacientesLista() {
  const nav = useNavigate();
  const [q, setQ] = useState(""), [busca, setBusca] = useState("");
  useEffect(() => { const t = setTimeout(() => setBusca(q), 250); return () => clearTimeout(t); }, [q]);
  const { data, error, loading } = useData(() => api.get<any[]>("/pacientes?q=" + encodeURIComponent(busca)), [busca]);
  return (
    <>
      <div className="pagina-cab"><h2>Pacientes</h2><Link to="/pacientes/nuevo" className="btn">+ Nuevo paciente</Link></div>
      <div className="barra-fecha"><input type="search" placeholder="Buscar por nombre o RUT…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} aria-label="Buscar paciente" /></div>
      <Alerta>{error}</Alerta>
      {loading && !data ? <Cargando /> : (
        <div className="tabla-wrap"><table><thead><tr><th>Paciente</th><th>RUT</th><th>Celular</th><th>Consentimiento</th><th>Última atención</th></tr></thead>
          <tbody>
            {(data ?? []).map((p) => (
              <tr key={p.id} className="fila-click" onClick={() => nav(`/pacientes/${p.id}`)}>
                <td><b>{p.nombre}</b></td><td>{p.rut}</td><td>{p.celular || "—"}</td>
                <td>{p.tiene_consentimiento ? <span className="etiqueta ok">Firmado</span> : <span className="etiqueta aviso">Pendiente</span>}</td>
                <td>{p.ultima_atencion ? fechaCorta(p.ultima_atencion) : "—"}</td>
              </tr>
            ))}
            {data && data.length === 0 && <tr><td colSpan={5}><Vacio>No se encontraron pacientes.</Vacio></td></tr>}
          </tbody></table></div>
      )}
    </>
  );
}

export function PacienteForm() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast();
  const editando = Boolean(id);
  const actual = useData(() => (id ? api.get<any>(`/pacientes/${id}`) : Promise.resolve(null)), [id]);
  const enf = useData(() => api.get<any[]>("/enfermedades"), []);
  const [f, setF] = useState<any>(null), [error, setError] = useState(""), [enviando, setEnviando] = useState(false);
  const base = { nombre: "", rut: "", edad: "", celular: "", email: "", motivo: "", antecedentes: [] as string[], medicamentos: "", otras: "" };
  const v = f ?? (actual.data ? { ...base, ...actual.data, edad: actual.data.edad ?? "", celular: actual.data.celular ?? "", email: actual.data.email ?? "", motivo: actual.data.motivo ?? "", medicamentos: actual.data.medicamentos ?? "", otras: actual.data.otras ?? "" } : base);
  const set = (k: string, val: any) => setF({ ...v, [k]: val });
  const toggle = (k: string) => set("antecedentes", v.antecedentes.includes(k) ? v.antecedentes.filter((x: string) => x !== k) : [...v.antecedentes, k]);
  if (editando && actual.loading) return <Cargando />;

  async function enviar(e: FormEvent) {
    e.preventDefault(); setError("");
    if (!validarRut(v.rut)) return setError("El RUT no es válido (revise el dígito verificador).");
    setEnviando(true);
    const body = { nombre: v.nombre, rut: v.rut, edad: v.edad === "" ? null : Number(v.edad), celular: v.celular || null, email: v.email || null, motivo: v.motivo || null, antecedentes: v.antecedentes, medicamentos: v.medicamentos || null, otras: v.otras || null };
    try {
      if (editando) { await api.put(`/pacientes/${id}`, body); toast("Ficha actualizada"); nav(`/pacientes/${id}`); }
      else { const r = await api.post("/pacientes", body); toast("Ficha creada. Ahora puede firmar el consentimiento."); nav(`/pacientes/${r.id}?firmar=1`); }
    } catch (err: any) { setError(err.message); } finally { setEnviando(false); }
  }
  return (
    <>
      <div className="pagina-cab"><h2>{editando ? "Editar ficha" : "Ficha de ingreso digital"}</h2></div>
      <form onSubmit={enviar}>
        <Alerta>{error}</Alerta>
        <div className="tarjeta"><h3>Datos personales</h3>
          <div className="form-rejilla">
            <Campo label="Nombre completo"><input type="text" value={v.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Ej. María Pérez" required /></Campo>
            <Campo label="RUT"><input type="text" value={v.rut} onChange={(e) => set("rut", e.target.value)} onBlur={(e) => set("rut", formatearRut(e.target.value))} placeholder="12.345.678-5" required /></Campo>
            <Campo label="Edad"><input type="number" min={0} max={120} value={v.edad} onChange={(e) => set("edad", e.target.value)} /></Campo>
            <Campo label="Celular"><input type="tel" value={v.celular} onChange={(e) => set("celular", e.target.value)} placeholder="+56 9 1234 5678" /></Campo>
            <Campo label="Correo electrónico" ancho><input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} /></Campo>
            <Campo label="Motivo de consulta" ancho><textarea rows={3} value={v.motivo} onChange={(e) => set("motivo", e.target.value)} /></Campo>
          </div></div>
        <div className="tarjeta"><h3>Historial clínico</h3>
          <p style={{ color: "var(--gris)", marginTop: 0 }}>Seleccione si presenta alguna de las siguientes condiciones (el listado lo administra Dirección en Administración → Enfermedades):</p>
          <div className="checks">{[...(enf.data ?? []).filter((e) => e.activo).map((e) => e.nombre), ...v.antecedentes.filter((a: string) => !(enf.data ?? []).some((e) => e.activo && e.nombre === a))].map((n: string) => <label key={n} className="check"><input type="checkbox" checked={v.antecedentes.includes(n)} onChange={() => toggle(n)} />{n}</label>)}</div>
          {!enf.data?.length && enf.loading && <p style={{ color: "var(--gris)" }}>Cargando enfermedades…</p>}
          <div className="form-rejilla" style={{ marginTop: 16 }}>
            <Campo label="Medicamentos que consume"><textarea rows={2} value={v.medicamentos} onChange={(e) => set("medicamentos", e.target.value)} /></Campo>
            <Campo label="Otras enfermedades u observaciones"><textarea rows={2} value={v.otras} onChange={(e) => set("otras", e.target.value)} /></Campo>
          </div></div>
        <div className="acciones"><button className="btn" disabled={enviando}>{editando ? "Guardar cambios" : "Guardar ficha"}</button><Link to={editando ? `/pacientes/${id}` : "/pacientes"} className="btn-sec">Cancelar</Link></div>
      </form>
    </>
  );
}

function ConsentimientoModal({ paciente, onClose, onDone }: { paciente: any; onClose(): void; onDone(): void }) {
  const toast = useToast();
  const cfg = useData(() => api.get<Record<string, string>>("/config"), []);
  const [trat, setTrat] = useState(paciente.planes?.[0]?.servicio ?? ""), [firma, setFirma] = useState<string | null>(null), [acepta, setAcepta] = useState(false), [error, setError] = useState("");
  async function enviar(e: FormEvent) {
    e.preventDefault(); setError("");
    if (!firma) return setError("Falta la firma del paciente en el recuadro.");
    try { await api.post(`/pacientes/${paciente.id}/consentimientos`, { tratamiento: trat, firma }); toast("Consentimiento firmado"); onDone(); onClose(); } catch (err: any) { setError(err.message); }
  }
  return (
    <Modal titulo="Consentimiento informado" onClose={onClose} ancho={700}>
      <form onSubmit={enviar}>
        <Alerta>{error}</Alerta>
        <Campo label="Tratamiento"><input type="text" value={trat} onChange={(e) => setTrat(e.target.value)} placeholder="Ej. Depilación láser" required minLength={2} /></Campo>
        <p style={{ margin: "14px 0 6px", fontWeight: 600 }}>Paciente: {paciente.nombre} · {paciente.rut}</p>
        <div className="texto-legal">{cfg.data?.texto_consentimiento ?? "Cargando…"}</div>
        <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />El paciente declara haber leído y acepta el consentimiento informado</label>
        <p style={{ margin: "0 0 6px", fontSize: ".85rem", color: "var(--gris)" }}>Firma del paciente (con el dedo o el mouse):</p>
        <Firma onChange={setFirma} />
        <div className="acciones" style={{ marginTop: 10 }}><button className="btn" disabled={!acepta}>Firmar y guardar</button><button type="button" className="btn-sec" onClick={onClose}>Cancelar</button></div>
      </form>
    </Modal>
  );
}

function PlanModal({ paciente, onClose, onDone }: { paciente: any; onClose(): void; onDone(): void }) {
  const toast = useToast();
  const servs = useData(() => api.get<any[]>("/servicios"), []);
  const [servicio, setServicio] = useState(""), [total, setTotal] = useState(6), [origen, setOrigen] = useState("EVALUACION"), [error, setError] = useState("");
  async function enviar(e: FormEvent) {
    e.preventDefault();
    try { await api.post(`/pacientes/${paciente.id}/planes`, { servicio_id: Number(servicio), sesiones_total: Number(total), origen }); toast("Plan creado"); onDone(); onClose(); } catch (err: any) { setError(err.message); }
  }
  return (
    <Modal titulo="Nuevo plan de tratamiento" onClose={onClose}>
      <form onSubmit={enviar} className="form-rejilla">
        <div className="campo ancho"><Alerta>{error}</Alerta></div>
        <Campo label="Servicio" ancho><select value={servicio} onChange={(e) => { setServicio(e.target.value); const s = (servs.data ?? []).find((x) => String(x.id) === e.target.value); if (s) setTotal(s.sesiones); }} required><option value="">Seleccione…</option>{(servs.data ?? []).filter((s) => s.activo && s.sesiones > 1).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></Campo>
        <Campo label="N° de sesiones (definido en la evaluación)"><input type="number" min={1} max={60} value={total} onChange={(e) => setTotal(Number(e.target.value))} /></Campo>
        <Campo label="Origen"><select value={origen} onChange={(e) => setOrigen(e.target.value)}><option value="EVALUACION">Evaluación del centro</option><option value="DERIVACION">Derivación médica</option></select></Campo>
        <div className="campo ancho acciones"><button className="btn">Crear plan</button><button type="button" className="btn-sec" onClick={onClose}>Cancelar</button></div>
      </form>
    </Modal>
  );
}


function SeguimientoNuevo({ paciente, onDone }: { paciente: any; onDone(): void }) {
  const toast = useToast();
  const [tipo, setTipo] = useState("NOTA"), [texto, setTexto] = useState(""), [control, setControl] = useState(""), [error, setError] = useState("");
  async function enviar(e: FormEvent) {
    e.preventDefault(); setError("");
    try { await api.post(`/pacientes/${paciente.id}/seguimientos`, { tipo, texto, proximo_control: control || null }); setTexto(""); setControl(""); toast("Seguimiento registrado"); onDone(); }
    catch (err: any) { setError(err.message); }
  }
  return (
    <form onSubmit={enviar} className="form-rejilla" style={{ marginBottom: 16 }}>
      <div className="campo ancho"><Alerta>{error}</Alerta></div>
      <Campo label="Tipo"><select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="NOTA">Nota clínica</option><option value="LLAMADA">Llamada / contacto</option><option value="INDICACION">Indicación al paciente</option><option value="CONTROL">Agendar control</option></select></Campo>
      <Campo label={tipo === "CONTROL" ? "Fecha del próximo control (obligatoria)" : "Próximo control (opcional)"}><input type="date" value={control} onChange={(e) => setControl(e.target.value)} required={tipo === "CONTROL"} /></Campo>
      <Campo label="Detalle" ancho><textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} required minLength={3} placeholder="Ej. Se indica evitar exposición solar 48 horas; control en 2 semanas." /></Campo>
      <div className="campo ancho"><button className="btn chico">Registrar seguimiento</button></div>
    </form>
  );
}

export function PacienteDetalle() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast(); const { user } = useAuth();
  const { data: p, error, loading, reload } = useData(() => api.get<any>(`/pacientes/${id}`), [id]);
  const [firmar, setFirmar] = useState(new URLSearchParams(location.search).has("firmar")), [plan, setPlan] = useState(false), [evol, setEvol] = useState<any>(null), [tab, setTab] = useState("historial");
  if (loading && !p) return <Cargando />;
  if (error || !p) return <Alerta>{error}</Alerta>;
  const admin = user!.rol === "ADMIN";
  const propias = (c: any) => admin || c.profesional === user!.nombre;
  async function archivar() {
    if (!confirm(`¿Archivar a ${p.nombre}? Dejará de aparecer en las listas, pero su historial se conserva.`)) return;
    try { await api.post(`/pacientes/${p.id}/archivar`); toast("Paciente archivado"); nav("/pacientes"); } catch (e: any) { toast(e.message, "error"); }
  }
  async function resolver(s: any) { try { await api.patch(`/seguimientos/${s.id}`, { control_resuelto: !s.control_resuelto }); reload(); } catch (e: any) { toast(e.message, "error"); } }
  async function borrarSeg(s: any) { if (!confirm("¿Eliminar este registro de seguimiento?")) return; try { await api.del(`/seguimientos/${s.id}`); reload(); } catch (e: any) { toast(e.message, "error"); } }
  const eventos = [...p.citas.map((c: any) => ({ k: "cita", f: `${c.fecha}T${c.hora}`, c })), ...p.seguimientos.map((s: any) => ({ k: "seg", f: String(s.created_at).slice(0, 16), s }))].sort((a, b) => (a.f < b.f ? 1 : -1));
  async function estadoPlan(pl: any, estado: string) { try { await api.patch(`/planes/${pl.id}`, { estado }); reload(); } catch (e: any) { toast(e.message, "error"); } }
  return (
    <>
      <div className="pagina-cab">
        <div><h2>{p.nombre}</h2><span style={{ color: "var(--gris)" }}>{p.rut}{p.edad ? ` · ${p.edad} años` : ""}{p.celular ? ` · ${p.celular}` : ""}{p.email ? ` · ${p.email}` : ""}</span></div>
        <div className="acciones">
          {admin && <button className="btn" onClick={() => nav(`/agenda?paciente=${p.id}`)}>+ Agendar cita</button>}
          <a className="btn-sec" href={`/api/v1/pacientes/${p.id}/historial.pdf`} target="_blank" rel="noopener">Historial PDF</a>
          <Link to={`/pacientes/${p.id}/editar`} className="btn-sec">Editar ficha</Link>
          {admin && <button className="btn-sec btn-peligro" onClick={archivar}>Archivar</button>}
        </div>
      </div>
      {(() => {
        const hoy = new Date().toISOString().slice(0, 10);
        const realizadas = p.citas.filter((c: any) => c.estado === "REALIZADA");
        const ultima = realizadas[0];
        const proximas = p.citas.filter((c: any) => c.fecha >= hoy && (c.estado === "AGENDADA" || c.estado === "CONFIRMADA")).sort((a: any, b: any) => (a.fecha + a.hora < b.fecha + b.hora ? -1 : 1));
        const planes = p.planes.filter((x: any) => x.estado === "ACTIVO");
        const controles = p.seguimientos.filter((s: any) => s.proximo_control && !s.control_resuelto);
        return (
          <div className="resumen-hist">
            <div><h4>Última atención</h4>{ultima ? <><div className="grande">{fechaCorta(ultima.fecha)} · {ultima.servicio}</div><div>con {ultima.profesional}{ultima.nro_sesion ? ` · sesión ${ultima.nro_sesion}` : ""}</div>{ultima.observaciones && <div style={{ marginTop: 4, color: "var(--gris)" }}>«{ultima.observaciones.length > 110 ? ultima.observaciones.slice(0, 110) + "…" : ultima.observaciones}»</div>}{ultima.recomendaciones && <div style={{ marginTop: 4 }}><b>Indicado:</b> {ultima.recomendaciones}</div>}</> : <div>Aún sin atenciones realizadas</div>}</div>
            <div><h4>Próxima cita</h4>{proximas[0] ? <><div className="grande">{fechaCorta(proximas[0].fecha)} · {proximas[0].hora}</div><div>{proximas[0].servicio} · con {proximas[0].profesional}</div></> : <div>Sin citas futuras</div>}</div>
            <div><h4>Plan de sesiones</h4>{planes.length ? planes.map((pl: any) => <div key={pl.id}><b>{pl.servicio}</b>: {pl.sesiones_realizadas} de {pl.sesiones_total}<div className="progreso"><div style={{ width: `${Math.min(100, (pl.sesiones_realizadas / pl.sesiones_total) * 100)}%` }} /></div></div>) : <div>Sin plan activo</div>}</div>
            <div style={{ borderLeftColor: controles.length || !p.consentimientos.length || p.antecedentes.length ? "var(--aviso)" : "var(--mauve)" }}><h4>Atención</h4>
              {p.antecedentes.length > 0 && <div>{p.antecedentes.map((a: string) => <span key={a} className="etiqueta rojo" style={{ marginRight: 4 }}>{ANTECEDENTES[a] ?? a}</span>)}</div>}
              {controles.map((s: any) => <div key={s.id}><span className="etiqueta aviso">Control {fechaCorta(s.proximo_control)}</span></div>)}
              {!p.consentimientos.length && <div><span className="etiqueta rojo">Sin consentimiento firmado</span></div>}
              {!p.antecedentes.length && !controles.length && p.consentimientos.length > 0 && <div>Sin alertas</div>}</div>
          </div>);
      })()}
      <Pestanas activa={tab} onChange={setTab} items={[["historial", `Historial y seguimiento (${p.citas.length + p.seguimientos.length})`], ["ficha", "Ficha y consentimientos"], ["planes", "Planes de tratamiento"], ["cambios", `Cambios de la ficha (${p.versiones.length})`]]} />
      {tab === "ficha" && <div className="dos">
        <div className="tarjeta"><h3>Ficha clínica</h3>
          {p.motivo && <p><b>Motivo de consulta:</b> {p.motivo}</p>}
          <p><b>Antecedentes:</b> {p.antecedentes.length ? p.antecedentes.map((a: string) => <span key={a} className="etiqueta" style={{ marginRight: 4 }}>{ANTECEDENTES[a] ?? a}</span>) : "Sin antecedentes registrados"}</p>
          <p><b>Medicamentos:</b> {p.medicamentos || "—"}</p><p><b>Otras enfermedades / observaciones:</b> {p.otras || "—"}</p>
          {admin && p.total_comprado !== undefined && <p><b>Total comprado:</b> {clp(p.total_comprado)}</p>}
        </div>
        <div className="tarjeta"><h3>Consentimiento informado</h3>
          {p.consentimientos.length === 0 ? <Alerta tipo="info">Aún no hay consentimientos firmados.</Alerta> : p.consentimientos.map((c: any) => (
            <p key={c.id} style={{ margin: "0 0 8px" }}><span className="etiqueta ok">Firmado</span> {c.tratamiento} · {fechaHora(c.firmado_en)} · <a href={`/api/v1/consentimientos/${c.id}/pdf`} target="_blank" rel="noopener">Descargar PDF</a></p>
          ))}
          <button className="btn chico" onClick={() => setFirmar(true)}>Firmar nuevo consentimiento</button>
        </div>
      </div>}
      {tab === "planes" && <div className="tarjeta">
        <div className="pagina-cab" style={{ marginBottom: 6 }}><h3 style={{ margin: 0 }}>Planes de tratamiento</h3><button className="btn-sec chico" onClick={() => setPlan(true)}>+ Nuevo plan</button></div>
        {p.planes.length === 0 ? <Vacio>Sin planes. Se crean al evaluar o al agendar un servicio por sesiones.</Vacio> : (
          <div className="rejilla">{p.planes.map((pl: any) => (
            <div key={pl.id} className="metrica">
              <h4>{pl.servicio}</h4>
              <p style={{ fontSize: "1.3rem" }}>{pl.sesiones_realizadas} de {pl.sesiones_total} sesiones</p>
              <div className="progreso"><div style={{ width: `${Math.min(100, (pl.sesiones_realizadas / pl.sesiones_total) * 100)}%` }} /></div>
              <small>{pl.origen === "DERIVACION" ? "Derivación médica" : "Evaluación"} · <span className={`etiqueta ${pl.estado === "ACTIVO" ? "" : pl.estado === "COMPLETADO" ? "ok" : "aviso"}`}>{pl.estado}</span></small>
              {pl.estado === "ACTIVO" && <div style={{ marginTop: 8 }}><button className="btn-sec chico btn-peligro" onClick={() => confirm("¿Cancelar este plan?") && estadoPlan(pl, "CANCELADO")}>Cancelar plan</button></div>}
            </div>))}</div>
        )}
      </div>}
      {tab === "historial" && <div className="tarjeta"><h3>Seguimiento y historial</h3>
        <p style={{ marginTop: 0, color: "var(--gris)" }}>Registre notas, llamadas, indicaciones o controles. Quedan visibles en cada atención futura del paciente.</p>
        <SeguimientoNuevo paciente={p} onDone={reload} />
        {eventos.length === 0 ? <Vacio>Sin atenciones ni seguimiento registrados.</Vacio> : (
          <div className="linea-tiempo">{eventos.map((ev: any) => ev.k === "cita" ? (() => { const c = ev.c; return (
            <div key={"c" + c.id} className="item">
              <b>{fechaCorta(c.fecha)} {c.hora}</b> · {c.servicio}{c.nro_sesion ? ` (sesión ${c.nro_sesion})` : ""} · {c.profesional} · {c.box} <Insignia estado={c.estado} /> {c.pagada && <span className="etiqueta ok">Pagada</span>}
              {c.notas && <div style={{ fontStyle: "italic", color: "var(--gris)" }}>📝 {c.notas}</div>}
              {c.observaciones && <div className="evolucion"><b>Evolución:</b> {c.observaciones}{c.procedimiento && <><br /><b>Procedimiento:</b> {c.procedimiento}</>}{c.recomendaciones && <><br /><b>Recomendaciones:</b> {c.recomendaciones}</>}</div>}
              {propias(c) && c.estado !== "CANCELADA" && <div style={{ marginTop: 6 }}><button className="btn-sec chico" onClick={() => setEvol({ ...c, paciente: p.nombre })}>{c.observaciones ? "Editar evolución" : "Registrar evolución"}</button></div>}
            </div>); })() : (() => { const s = ev.s; const mio = admin || s.usuario_id === user!.id; return (
            <div key={"s" + s.id} className="item" style={{ borderLeftColor: "var(--mauve)" }}>
              <span className="etiqueta">{{ NOTA: "Nota", LLAMADA: "Llamada", INDICACION: "Indicación", CONTROL: "Control" }[s.tipo as string]}</span> <b>{fechaHora(s.created_at)}</b> · {s.usuario_nombre}
              <div>{s.texto}</div>
              {s.proximo_control && <div><span className={`etiqueta ${s.control_resuelto ? "ok" : "aviso"}`}>Control {fechaCorta(s.proximo_control)}{s.control_resuelto ? " · realizado" : " · pendiente"}</span></div>}
              {mio && <div style={{ marginTop: 4 }} className="acciones">{s.proximo_control && <button className="btn-sec chico" onClick={() => resolver(s)}>{s.control_resuelto ? "Reabrir control" : "Marcar control realizado"}</button>}<button className="btn-sec chico btn-peligro" onClick={() => borrarSeg(s)}>Eliminar</button></div>}
            </div>); })())}</div>
        )}
      </div>}
      {tab === "cambios" && (p.versiones.length === 0 ? <div className="tarjeta"><Vacio>La ficha aún no ha sido modificada.</Vacio></div> : <div className="tarjeta"><h3>Historial de cambios de la ficha</h3>
        <p style={{ marginTop: 0, color: "var(--gris)" }}>Cada vez que se edita la ficha se conserva la versión anterior.</p>
        {p.versiones.map((v: any) => <details key={v.id} style={{ marginBottom: 6 }}><summary><b>{fechaHora(v.created_at)}</b> · {v.usuario_nombre}</summary>
          <div className="evolucion">Antecedentes: {v.datos.antecedentes?.map((a: string) => ANTECEDENTES[a] ?? a).join(", ") || "—"}<br />Medicamentos: {v.datos.medicamentos || "—"}<br />Otras: {v.datos.otras || "—"}<br />Motivo: {v.datos.motivo || "—"}<br />Contacto: {v.datos.celular || "—"} {v.datos.email || ""}</div></details>)}</div>)}
      {firmar && <ConsentimientoModal paciente={p} onClose={() => setFirmar(false)} onDone={reload} />}
      {plan && <PlanModal paciente={p} onClose={() => setPlan(false)} onDone={reload} />}
      {evol && <EvolucionModal cita={evol} onClose={() => setEvol(null)} onDone={reload} />}
    </>
  );
}
