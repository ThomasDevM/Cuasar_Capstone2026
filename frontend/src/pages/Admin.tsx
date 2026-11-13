import { useState, type FormEvent, type ReactNode } from "react";
import { api, clp, fechaHora } from "../api";
import { useAuth } from "../auth";
import { Alerta, Campo, Cargando, Modal, Pestanas, Vacio, useData, useToast } from "../ui";

type Campo_ = { k: string; label: string; tipo?: string; opciones?: [string, string][]; ancho?: boolean; req?: boolean; ayuda?: string };

/** Modal genérico de alta/edición con un formulario simple. */
function FormModal({ titulo, campos, inicial, onSave, onClose, boton = "Guardar" }: { titulo: string; campos: Campo_[]; inicial: any; onSave(v: any): Promise<void>; onClose(): void; boton?: string }) {
  const [v, setV] = useState<any>(inicial), [error, setError] = useState(""), [env, setEnv] = useState(false);
  async function enviar(e: FormEvent) { e.preventDefault(); setError(""); setEnv(true); try { await onSave(v); onClose(); } catch (err: any) { setError(err.message); } finally { setEnv(false); } }
  return (
    <Modal titulo={titulo} onClose={onClose}>
      <form onSubmit={enviar} className="form-rejilla">
        <div className="campo ancho"><Alerta>{error}</Alerta></div>
        {campos.map((c) => (
          <Campo key={c.k} label={c.label} ancho={c.ancho}>
            {c.opciones ? <select value={v[c.k] ?? ""} onChange={(e) => setV({ ...v, [c.k]: e.target.value })}>{c.opciones.map(([val, t]) => <option key={val} value={val}>{t}</option>)}</select>
              : c.tipo === "area" ? <textarea rows={4} value={v[c.k] ?? ""} onChange={(e) => setV({ ...v, [c.k]: e.target.value })} />
              : <input type={c.tipo ?? "text"} value={v[c.k] ?? ""} required={c.req !== false} onChange={(e) => setV({ ...v, [c.k]: e.target.value })} />}
            {c.ayuda && <small style={{ color: "var(--gris)" }}>{c.ayuda}</small>}
          </Campo>))}
        <div className="campo ancho acciones"><button className="btn" disabled={env}>{boton}</button><button type="button" className="btn-sec" onClick={onClose}>Cancelar</button></div>
      </form>
    </Modal>
  );
}
const Tabla = ({ cab, children }: { cab: string[]; children: ReactNode }) => <div className="tabla-wrap"><table><thead><tr>{cab.map((c, i) => <th key={i}>{c}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
const Cab = ({ titulo, nota, onNuevo, boton = "+ Agregar" }: { titulo: string; nota?: string; onNuevo?: () => void; boton?: string }) => <><div className="pagina-cab" style={{ marginBottom: 6 }}><h3 style={{ margin: 0 }}>{titulo}</h3>{onNuevo && <button className="btn chico" onClick={onNuevo}>{boton}</button>}</div>{nota && <p style={{ marginTop: 0, color: "var(--gris)", fontSize: ".88rem" }}>{nota}</p>}</>;
const Estado = ({ activo }: { activo: boolean }) => activo ? <span className="etiqueta ok">Activo</span> : <span className="etiqueta aviso">Inactivo</span>;

/** Muestra una clave temporal una sola vez. */
function Credenciales({ datos, onClose }: { datos: { username: string; password_temporal: string }; onClose(): void }) {
  return (
    <Modal titulo="Cuenta creada" onClose={onClose}>
      <Alerta tipo="ok">Entregue estos datos al profesional. <b>La clave temporal solo se muestra ahora</b>; al ingresar deberá cambiarla.</Alerta>
      <div className="texto-legal" style={{ fontSize: "1.05rem" }}>Usuario: <b>{datos.username}</b>{"\n"}Clave temporal: <b>{datos.password_temporal}</b></div>
      <div className="acciones"><button className="btn" onClick={() => navigator.clipboard?.writeText(`Usuario: ${datos.username}\nClave temporal: ${datos.password_temporal}`)}>Copiar</button><button className="btn-sec" onClick={onClose}>Listo</button></div>
    </Modal>
  );
}

function PorTratamiento({ prof, onClose }: { prof: any; onClose(): void }) {
  const toast = useToast(); const d = useData(() => api.get<any[]>(`/profesionales/${prof.id}/comisiones`), [prof.id]); const [v, setV] = useState<Record<number, string>>({});
  async function guardar(s: any) { try { await api.put(`/profesionales/${prof.id}/comisiones/${s.servicio_id}`, { porcentaje: Number(v[s.servicio_id]) }); toast("Porcentaje guardado"); setV((x) => { const n = { ...x }; delete n[s.servicio_id]; return n; }); d.reload(); } catch (e: any) { toast(e.message, "error"); } }
  async function quitar(s: any) { try { await api.del(`/profesionales/${prof.id}/comisiones/${s.servicio_id}`); d.reload(); } catch (e: any) { toast(e.message, "error"); } }
  return (
    <Modal titulo={`% por tratamiento · ${prof.nombre}`} onClose={onClose} ancho={720}>
      <Alerta tipo="info">Porcentaje base de {prof.nombre}: <b>{prof.contrato === "PORCENTAJE" ? `${prof.porcentaje}%` : "sin comisión"}</b>. Si define un porcentaje para un tratamiento, ese reemplaza al base solo en ese tratamiento. Los cobros ya registrados no cambian.</Alerta>
      {!d.data ? <Cargando /> : <Tabla cab={["Tratamiento", "Precio", "% especial", ""]}>{d.data.map((s) => (
        <tr key={s.servicio_id}><td>{s.servicio}</td><td>{clp(s.precio)}</td>
          <td><input type="number" min={0} max={100} style={{ width: 90 }} value={v[s.servicio_id] ?? (s.porcentaje ?? "")} placeholder="base" onChange={(e) => setV({ ...v, [s.servicio_id]: e.target.value })} /> %</td>
          <td className="acciones">{v[s.servicio_id] !== undefined && v[s.servicio_id] !== "" && <button className="btn chico" onClick={() => guardar(s)}>Guardar</button>}{s.porcentaje !== null && <button className="btn-sec chico" onClick={() => quitar(s)}>Usar el base</button>}</td></tr>))}</Tabla>}
    </Modal>
  );
}

function Profesionales() {
  const toast = useToast(); const d = useData(() => api.get<any[]>("/profesionales"), []); const [m, setM] = useState<any>(null), [cred, setCred] = useState<any>(null), [esp, setEsp] = useState<any>(null);
  const campos = (nuevo: boolean): Campo_[] => [
    { k: "nombre", label: "Nombre completo", ancho: true }, { k: "especialidad", label: "Especialidad", req: false }, { k: "turnos", label: "Turnos / horario", req: false },
    { k: "contrato", label: "Tipo de contrato", opciones: [["PORCENTAJE", "Por porcentaje"], ["OTRO", "Otro (sin comisión)"]] },
    { k: "porcentaje", label: "% que se lleva el profesional de cada consulta", tipo: "number", ayuda: "El resto queda para el centro. Solo Dirección puede cambiarlo." },
    ...(nuevo ? [{ k: "acceso", label: "Crear cuenta de acceso al sistema", opciones: [["si", "Sí, crear cuenta predeterminada (clave temporal)"], ["no", "No por ahora"]] as [string, string][], ancho: true }] : []),
  ];
  const guardar = async (v: any) => {
    const b: any = { nombre: v.nombre, especialidad: v.especialidad || null, turnos: v.turnos || null, contrato: v.contrato, porcentaje: v.contrato === "OTRO" ? 0 : Number(v.porcentaje) };
    if (v.id) { await api.patch(`/profesionales/${v.id}`, b); toast("Guardado"); }
    else { if (v.acceso === "si") b.acceso = {}; const r = await api.post("/profesionales", b); toast("Profesional creado"); if (r.acceso) setCred(r.acceso); }
    d.reload();
  };
  return <>
    <Cab titulo="Profesionales" nota="Cada profesional tiene su % de cada consulta. Al crear uno se puede generar su cuenta con una clave temporal que debe cambiar al primer ingreso." onNuevo={() => setM({ contrato: "PORCENTAJE", porcentaje: 30, acceso: "si" })} boton="+ Nuevo profesional" />
    {!d.data ? <Cargando /> : <Tabla cab={["Nombre", "Especialidad", "Turnos", "Contrato", "% base", "Estado", ""]}>{d.data.map((p) => <tr key={p.id}><td><b>{p.nombre}</b></td><td>{p.especialidad ?? "—"}</td><td>{p.turnos ?? "—"}</td><td>{p.contrato === "PORCENTAJE" ? "Porcentaje" : "Otro"}</td><td>{p.contrato === "PORCENTAJE" ? `${p.porcentaje}%` : "—"}</td><td><Estado activo={p.activo} /></td>
      <td className="acciones"><button className="btn-sec chico" onClick={() => setM(p)}>Editar</button>{p.contrato === "PORCENTAJE" && <button className="btn-sec chico" onClick={() => setEsp(p)}>% por tratamiento</button>}<button className="btn-sec chico" onClick={async () => { await api.patch(`/profesionales/${p.id}`, { activo: !p.activo }); d.reload(); }}>{p.activo ? "Desactivar" : "Activar"}</button></td></tr>)}</Tabla>}
    {m && <FormModal titulo={m.id ? "Editar profesional" : "Nuevo profesional"} campos={campos(!m.id)} inicial={m} onSave={guardar} onClose={() => setM(null)} />}
    {esp && <PorTratamiento prof={esp} onClose={() => setEsp(null)} />}
    {cred && <Credenciales datos={cred} onClose={() => setCred(null)} />}
  </>;
}

function Servicios() {
  const toast = useToast(); const d = useData(() => api.get<any[]>("/servicios"), []); const [m, setM] = useState<any>(null), [precios, setPrecios] = useState<Record<number, string>>({});
  const campos: Campo_[] = [{ k: "nombre", label: "Nombre del tratamiento", ancho: true }, { k: "precio", label: "Precio por sesión ($)", tipo: "number" }, { k: "sesiones", label: "N° de sesiones por defecto", tipo: "number" },
    { k: "duracion_min", label: "Duración de cada cita", opciones: [["30", "30 minutos"], ["60", "60 minutos"], ["90", "90 minutos"], ["120", "120 minutos"]] }, { k: "intervalo_mantencion_dias", label: "Mantención cada (días, opcional)", tipo: "number", req: false }];
  const guardar = async (v: any) => { const b = { nombre: v.nombre, precio: Number(v.precio), sesiones: Number(v.sesiones), duracion_min: Number(v.duracion_min), intervalo_mantencion_dias: v.intervalo_mantencion_dias ? Number(v.intervalo_mantencion_dias) : null }; if (v.id) await api.patch(`/servicios/${v.id}`, b); else await api.post("/servicios", b); toast("Guardado"); d.reload(); };
  async function nuevoPrecio(s: any) { try { await api.patch(`/servicios/${s.id}`, { precio: Number(precios[s.id]) }); toast(`Precio de ${s.nombre} actualizado`); setPrecios((x) => { const n = { ...x }; delete n[s.id]; return n; }); d.reload(); } catch (e: any) { toast(e.message, "error"); } }
  return <>
    <Cab titulo="Tratamientos" nota="Cree tratamientos y modifique sus precios. Un cambio de precio aplica a los cobros nuevos; los ya registrados no cambian y queda en la auditoría." onNuevo={() => setM({ precio: 30000, sesiones: 1, duracion_min: "30" })} boton="+ Nuevo tratamiento" />
    {!d.data ? <Cargando /> : <Tabla cab={["Tratamiento", "Precio por sesión", "Duración", "Sesiones", "Mantención", "Estado", ""]}>{d.data.map((s) => <tr key={s.id}><td><b>{s.nombre}</b></td>
      <td className="acciones" style={{ flexWrap: "nowrap" }}><input type="number" min={0} style={{ width: 110 }} aria-label={`Precio de ${s.nombre}`} value={precios[s.id] ?? s.precio} onChange={(e) => setPrecios({ ...precios, [s.id]: e.target.value })} />{precios[s.id] !== undefined && Number(precios[s.id]) !== s.precio && <button className="btn chico" onClick={() => nuevoPrecio(s)}>Guardar</button>}</td>
      <td>{s.duracion_min} min</td><td>{s.sesiones}</td><td>{s.intervalo_mantencion_dias ? `cada ${s.intervalo_mantencion_dias} días` : "—"}</td><td><Estado activo={s.activo} /></td>
      <td className="acciones"><button className="btn-sec chico" onClick={() => setM({ ...s, duracion_min: String(s.duracion_min) })}>Editar</button><button className="btn-sec chico" onClick={async () => { await api.patch(`/servicios/${s.id}`, { activo: !s.activo }); d.reload(); }}>{s.activo ? "Desactivar" : "Activar"}</button></td></tr>)}</Tabla>}
    {m && <FormModal titulo={m.id ? "Editar tratamiento" : "Nuevo tratamiento"} campos={campos} inicial={m} onSave={guardar} onClose={() => setM(null)} />}
  </>;
}

function Enfermedades() {
  const toast = useToast(); const d = useData(() => api.get<any[]>("/enfermedades"), []); const [m, setM] = useState<any>(null);
  return <>
    <Cab titulo="Enfermedades y antecedentes" nota="Este listado aparece como casillas en la ficha de ingreso de cada paciente. Si desactiva una, no se pierde en las fichas que ya la tienen." onNuevo={() => setM({})} boton="+ Nueva enfermedad" />
    {!d.data ? <Cargando /> : <Tabla cab={["Enfermedad / antecedente", "Estado", ""]}>{d.data.map((e) => <tr key={e.id}><td><b>{e.nombre}</b></td><td><Estado activo={e.activo} /></td>
      <td className="acciones"><button className="btn-sec chico" onClick={() => setM(e)}>Renombrar</button><button className="btn-sec chico" onClick={async () => { await api.patch(`/enfermedades/${e.id}`, { activo: !e.activo }); d.reload(); }}>{e.activo ? "Desactivar" : "Activar"}</button></td></tr>)}</Tabla>}
    {m && <FormModal titulo={m.id ? "Renombrar" : "Nueva enfermedad"} campos={[{ k: "nombre", label: "Nombre", ancho: true }]} inicial={m} onClose={() => setM(null)} onSave={async (v) => { if (v.id) await api.patch(`/enfermedades/${v.id}`, { nombre: v.nombre }); else await api.post("/enfermedades", { nombre: v.nombre }); toast("Guardado"); d.reload(); }} />}
  </>;
}

function Boxes() {
  const toast = useToast(); const d = useData(() => api.get<any[]>("/boxes"), []); const [m, setM] = useState<any>(null);
  return <>
    <Cab titulo="Boxes" nota="Salas de atención disponibles para agendar." onNuevo={() => setM({})} boton="+ Nuevo box" />
    {!d.data ? <Cargando /> : <Tabla cab={["Box", "Estado", ""]}>{d.data.map((b) => <tr key={b.id}><td><b>{b.nombre}</b></td><td><Estado activo={b.activo} /></td><td className="acciones"><button className="btn-sec chico" onClick={() => setM(b)}>Renombrar</button><button className="btn-sec chico" onClick={async () => { await api.patch(`/boxes/${b.id}`, { activo: !b.activo }); d.reload(); }}>{b.activo ? "Desactivar" : "Activar"}</button></td></tr>)}</Tabla>}
    {m && <FormModal titulo={m.id ? "Renombrar box" : "Nuevo box"} campos={[{ k: "nombre", label: "Nombre", ancho: true }]} inicial={m} onClose={() => setM(null)} onSave={async (v) => { if (v.id) await api.patch(`/boxes/${v.id}`, { nombre: v.nombre }); else await api.post("/boxes", { nombre: v.nombre }); toast("Guardado"); d.reload(); }} />}
  </>;
}

function Usuarios() {
  const { user } = useAuth(); const toast = useToast();
  const d = useData(() => api.get<any[]>("/usuarios"), []); const profs = useData(() => api.get<any[]>("/profesionales"), []);
  const [m, setM] = useState<any>(null), [ed, setEd] = useState<any>(null), [pw, setPw] = useState<any>(null), [cred, setCred] = useState<any>(null);
  const opcionesProf: [string, string][] = [["", "— Seleccione al profesional —"], ...(profs.data ?? []).map((p): [string, string] => [String(p.id), p.nombre])];
  const perfiles: [string, string][] = [["PROFESIONAL", "Profesional (cuenta limitada)"], ["ADMIN", "Dirección / Administración (acceso completo)"]];
  const aviso = (e: any) => toast(e.message, "error");
  async function reset(u: any) { if (!confirm(`¿Generar una clave temporal nueva para ${u.username}? La actual dejará de funcionar.`)) return; try { setCred(await api.post(`/usuarios/${u.id}/reset-clave`)); d.reload(); } catch (e) { aviso(e); } }
  async function activar(u: any) { try { await api.patch(`/usuarios/${u.id}`, { activo: !u.activo }); toast(u.activo ? "Cuenta desactivada: ya no puede ingresar" : "Cuenta activada"); d.reload(); } catch (e) { aviso(e); } }
  async function eliminar(u: any) { if (!confirm(`¿Eliminar definitivamente a ${u.nombre} (${u.username})? Esta acción no se puede deshacer.`)) return; try { await api.del(`/usuarios/${u.id}`); toast("Usuario eliminado"); d.reload(); } catch (e) { aviso(e); } }
  return <>
    <Cab titulo="Usuarios del sistema" nota="Dirección tiene acceso completo. Los profesionales tienen una cuenta limitada: ven su agenda, sus pacientes y su ganancia, pero no pueden cambiar porcentajes, precios ni usuarios. Aquí puede crear cuentas, modificarlas, cambiar contraseñas, desactivarlas o eliminarlas." onNuevo={() => setM({ rol: "PROFESIONAL", profesional_id: "", forzar: "si" })} boton="+ Nuevo usuario" />
    {!d.data ? <Cargando /> : <Tabla cab={["Nombre", "Usuario", "Perfil", "Profesional vinculado", "Estado", ""]}>{d.data.map((u) => <tr key={u.id}><td><b>{u.nombre}</b>{u.id === user!.id && <small style={{ color: "var(--gris)" }}> (usted)</small>}</td><td>{u.username}</td><td>{u.rol === "ADMIN" ? "Dirección (acceso completo)" : "Profesional"}</td><td>{u.profesional ?? "—"}</td><td><Estado activo={u.activo} /> {u.debe_cambiar_clave && <span className="etiqueta aviso">Clave temporal</span>}</td>
      <td className="acciones"><button className="btn-sec chico" onClick={() => setEd({ ...u, profesional_id: u.profesional_id ? String(u.profesional_id) : "" })}>Editar</button><button className="btn-sec chico" onClick={() => setPw({ ...u, password: "", forzar: u.id === user!.id ? "no" : "si" })}>Cambiar contraseña</button><button className="btn-sec chico" onClick={() => reset(u)}>Clave temporal</button>
        {u.id !== user!.id && <><button className="btn-sec chico" onClick={() => activar(u)}>{u.activo ? "Desactivar" : "Activar"}</button><button className="btn-sec chico btn-peligro" onClick={() => eliminar(u)}>Eliminar</button></>}</td></tr>)}</Tabla>}
    {m && <FormModal titulo="Nuevo usuario" inicial={m} onClose={() => setM(null)} boton="Crear usuario"
      campos={[{ k: "nombre", label: "Nombre completo", ancho: true }, { k: "username", label: "Usuario (para ingresar)" }, { k: "password", label: "Contraseña inicial (mínimo 8 caracteres)", tipo: "password" }, { k: "rol", label: "Perfil", opciones: perfiles }, { k: "profesional_id", label: "Profesional vinculado (solo perfil Profesional)", opciones: opcionesProf, req: false }, { k: "forzar", label: "Al ingresar", opciones: [["si", "Debe cambiar la contraseña"], ["no", "Puede conservarla"]] }]}
      onSave={async (v) => { await api.post("/usuarios", { username: v.username, nombre: v.nombre, password: v.password, rol: v.rol, profesional_id: v.rol === "PROFESIONAL" && v.profesional_id ? Number(v.profesional_id) : null, debe_cambiar_clave: v.forzar === "si" }); toast("Usuario creado"); d.reload(); }} />}
    {ed && <FormModal titulo={`Editar a ${ed.nombre}`} inicial={ed} onClose={() => setEd(null)}
      campos={[{ k: "nombre", label: "Nombre completo", ancho: true }, { k: "username", label: "Usuario (para ingresar)" }, { k: "rol", label: "Perfil", opciones: perfiles }, { k: "profesional_id", label: "Profesional vinculado (solo perfil Profesional)", opciones: opcionesProf, req: false }]}
      onSave={async (v) => { await api.patch(`/usuarios/${ed.id}`, { nombre: v.nombre, username: v.username, rol: v.rol, profesional_id: v.rol === "PROFESIONAL" && v.profesional_id ? Number(v.profesional_id) : null }); toast("Usuario actualizado"); d.reload(); }} />}
    {pw && <FormModal titulo={`Cambiar la contraseña de ${pw.username}`} inicial={pw} onClose={() => setPw(null)} boton="Cambiar contraseña"
      campos={[{ k: "password", label: "Nueva contraseña (mínimo 8 caracteres)", tipo: "password", ancho: true }, { k: "forzar", label: "Al ingresar", opciones: [["si", "Debe cambiarla por una propia"], ["no", "Puede conservarla"]], ancho: true }]}
      onSave={async (v) => { await api.patch(`/usuarios/${pw.id}`, { password: v.password, debe_cambiar_clave: v.forzar === "si" }); toast("Contraseña actualizada"); d.reload(); }} />}
    {cred && <Credenciales datos={cred} onClose={() => setCred(null)} />}
  </>;
}

function Configuracion() {
  const toast = useToast(); const d = useData(() => api.get<Record<string, string>>("/config"), []);
  const [f, setF] = useState<Record<string, string>>({}), [error, setError] = useState(""), [prueba, setPrueba] = useState(""), [res, setRes] = useState<{ ok: boolean; error?: string } | null>(null), [probando, setProbando] = useState(false);
  if (!d.data) return <Cargando />;
  const v = { ...d.data, ...f }; const set = (k: string, val: string) => setF({ ...f, [k]: val });
  const horas = Array.from({ length: 29 }, (_, i) => { const m = 6 * 60 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 ? "30" : "00"}`; });
  async function guardar(e: FormEvent) { e.preventDefault(); setError(""); try { await api.put("/config", f); toast("Configuración guardada"); setF({}); d.reload(); } catch (err: any) { setError(err.message); } }
  async function probar() { setProbando(true); setRes(null); try { if (Object.keys(f).length) { await api.put("/config", f); setF({}); d.reload(); } setRes(await api.post("/correo/prueba", { to: prueba })); } catch (err: any) { setRes({ ok: false, error: err.message }); } finally { setProbando(false); } }
  return <form onSubmit={guardar}><Alerta>{error}</Alerta>
    <div className="tarjeta"><h3>Centro y agenda</h3><div className="form-rejilla">
      <Campo label="Nombre del centro"><input type="text" value={v.nombre_centro ?? ""} onChange={(e) => set("nombre_centro", e.target.value)} /></Campo>
      <Campo label="Enlace de la encuesta de satisfacción"><input type="text" value={v.enlace_encuesta ?? ""} onChange={(e) => set("enlace_encuesta", e.target.value)} placeholder="https://forms.gle/…" /></Campo>
      <Campo label="La agenda comienza a las"><select value={v.horario_inicio ?? "09:00"} onChange={(e) => set("horario_inicio", e.target.value)}>{horas.map((h) => <option key={h}>{h}</option>)}</select></Campo>
      <Campo label="La agenda termina a las"><select value={v.horario_fin ?? "19:00"} onChange={(e) => set("horario_fin", e.target.value)}>{horas.map((h) => <option key={h}>{h}</option>)}</select></Campo></div></div>
    <div className="tarjeta"><h3>Avisos automáticos por correo</h3>
      <p style={{ marginTop: 0, color: "var(--gris)" }}>Cuando el paciente tiene correo registrado, el sistema le envía solo: confirmación al agendar, aviso si se reprograma o cancela, y el recordatorio del día anterior.</p>
      <div className="form-rejilla">
        <Campo label="Avisos a pacientes"><select value={v.email_avisos ?? "true"} onChange={(e) => set("email_avisos", e.target.value)}><option value="true">Activados</option><option value="false">Desactivados</option></select></Campo>
        <Campo label="Enviar recordatorios del día siguiente desde las"><select value={v.hora_recordatorio ?? "18"} onChange={(e) => set("hora_recordatorio", e.target.value)}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></Campo>
        <Campo label="Enviar el reporte semanal los lunes a (correo, opcional)" ancho><input type="email" value={v.email_informe_semanal ?? ""} onChange={(e) => set("email_informe_semanal", e.target.value)} placeholder="sandra@sudominio.cl" /></Campo>
        <Campo label="Mensaje del recordatorio ({nombre} {fecha} {hora} {servicio} {profesional} {centro})" ancho><textarea rows={3} value={v.mensaje_recordatorio ?? ""} onChange={(e) => set("mensaje_recordatorio", e.target.value)} /></Campo></div></div>
    <div className="tarjeta"><h3>Cuenta de correo que envía los avisos</h3>
      <p style={{ marginTop: 0, color: "var(--gris)" }}>Use una cuenta del centro (por ejemplo Gmail con «contraseña de aplicación», o el correo de su dominio). La contraseña se guarda cifrada y no vuelve a mostrarse.</p>
      <div className="form-rejilla">
        <Campo label="Servidor (SMTP)"><input type="text" value={v.smtp_host ?? ""} onChange={(e) => set("smtp_host", e.target.value)} placeholder="smtp.gmail.com" /></Campo>
        <Campo label="Puerto"><input type="number" value={v.smtp_port ?? "587"} onChange={(e) => set("smtp_port", e.target.value)} /></Campo>
        <Campo label="Usuario (correo)"><input type="text" value={v.smtp_user ?? ""} onChange={(e) => set("smtp_user", e.target.value)} autoComplete="off" /></Campo>
        <Campo label={`Contraseña ${d.data.smtp_pass_configurada === "true" ? "(ya guardada; deje vacío para conservarla)" : ""}`}><input type="password" value={f.smtp_pass ?? ""} onChange={(e) => set("smtp_pass", e.target.value)} autoComplete="new-password" placeholder={d.data.smtp_pass_configurada === "true" ? "••••••••" : ""} /></Campo>
        <Campo label="Nombre y correo del remitente" ancho><input type="text" value={v.smtp_from ?? ""} onChange={(e) => set("smtp_from", e.target.value)} placeholder="Deva Aesthetic House <avisos@sudominio.cl>" /></Campo>
        <Campo label="Conexión segura (SSL, puerto 465)"><select value={v.smtp_seguro ?? "false"} onChange={(e) => set("smtp_seguro", e.target.value)}><option value="false">No (puerto 587)</option><option value="true">Sí (puerto 465)</option></select></Campo></div>
      <div className="acciones" style={{ marginTop: 14 }}><input type="email" placeholder="correo para la prueba" value={prueba} onChange={(e) => setPrueba(e.target.value)} style={{ maxWidth: 280 }} /><button type="button" className="btn-sec" disabled={!prueba || probando} onClick={probar}>{probando ? "Enviando…" : "Enviar correo de prueba"}</button></div>
      {res && <div style={{ marginTop: 10 }}><Alerta tipo={res.ok ? "ok" : "error"}>{res.ok ? "Correo enviado. Revise la bandeja (y spam) del destinatario." : `No se pudo enviar: ${res.error}`}</Alerta></div>}</div>
    <div className="tarjeta"><h3>Consentimiento informado</h3><div className="form-rejilla">
      <Campo label="Texto del consentimiento" ancho><textarea rows={8} value={v.texto_consentimiento ?? ""} onChange={(e) => set("texto_consentimiento", e.target.value)} /></Campo>
      <Campo label="Versión del texto (cámbiela al modificarlo)"><input type="text" value={v.version_consentimiento ?? ""} onChange={(e) => set("version_consentimiento", e.target.value)} /></Campo></div></div>
    <button className="btn" disabled={Object.keys(f).length === 0}>Guardar configuración</button>
  </form>;
}

function Auditoria() {
  const d = useData(() => api.get<any[]>("/auditoria?limit=150"), []);
  if (!d.data) return <Cargando />;
  return <><Cab titulo="Registro de auditoría (últimos 150 eventos)" />{d.data.length === 0 ? <Vacio>Sin eventos.</Vacio> : <Tabla cab={["Fecha", "Usuario", "Acción", "Entidad", "Detalle"]}>{d.data.map((a) => <tr key={a.id}><td>{fechaHora(a.created_at)}</td><td>{a.usuario_nombre ?? "—"}</td><td><span className="etiqueta">{a.accion}</span></td><td>{a.entidad}{a.entidad_id ? ` #${a.entidad_id}` : ""}</td><td>{a.detalle ?? ""}</td></tr>)}</Tabla>}</>;
}

export default function Admin() {
  const [tab, setTab] = useState("profesionales");
  return <>
    <div className="pagina-cab"><h2>Administración</h2></div>
    <Pestanas activa={tab} onChange={setTab} items={[["profesionales", "Profesionales"], ["servicios", "Tratamientos"], ["enfermedades", "Enfermedades"], ["boxes", "Boxes"], ["usuarios", "Usuarios"], ["config", "Configuración y correo"], ["auditoria", "Auditoría"]]} />
    {tab === "profesionales" && <Profesionales />}{tab === "servicios" && <Servicios />}{tab === "enfermedades" && <Enfermedades />}{tab === "boxes" && <Boxes />}
    {tab === "usuarios" && <Usuarios />}{tab === "config" && <Configuracion />}{tab === "auditoria" && <Auditoria />}
  </>;
}
