import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { api, clp, fechaLarga } from "../api";
import { Cargando, Alerta, Insignia, Metrica, Vacio, useData } from "../ui";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: d, error, loading } = useData(() => api.get("/reportes/dashboard"));
  if (loading) return <Cargando />;
  if (error || !d) return <Alerta>{error}</Alerta>;
  const admin = d.rol === "ADMIN";
  return (
    <>
      <div className="pagina-cab">
        <div><h2>Bienvenida, {user!.nombre.split(" ")[0]}</h2><span className="fecha-titulo">{fechaLarga(d.fecha)}</span></div>
        <div className="acciones">
          <Link to="/agenda?nueva=1" className="btn">+ Nueva cita</Link>
          <Link to="/pacientes/nuevo" className="btn-sec">Nuevo paciente</Link>
          <Link to="/ventas?cobrar=1" className="btn-sec">Registrar cobro</Link>
          {admin && <Link to="/informes" className="btn-sec">Informes</Link>}
        </div>
      </div>
      {admin ? (
        <div className="rejilla" style={{ marginBottom: 18 }}>
          <Metrica titulo="Citas hoy" valor={d.citas_hoy} />
          <Metrica titulo="Citas mañana" valor={d.citas_manana} nota="para recordar" />
          <Metrica titulo="Ventas hoy" valor={clp(d.ventas_hoy)} />
          <Metrica titulo="Ventas del mes" valor={clp(d.ventas_mes)} />
          <Metrica titulo="Comisiones del mes" valor={clp(d.comision_mes)} nota="para profesionales" />
          <Metrica titulo="Ganancia del centro (mes)" valor={clp(d.ganancia_centro_mes)} nota="ventas − comisiones" />
          <Metrica titulo="Pacientes" valor={d.pacientes} />
          <Metrica titulo="Por contactar" valor={d.pacientes_por_contactar} nota="mantención" tono={d.pacientes_por_contactar ? "alerta" : undefined} />
          <Metrica titulo="Controles próximos" valor={d.controles_pendientes} nota="próx. 7 días" tono={d.controles_pendientes ? "alerta" : undefined} />
          <Metrica titulo="Sin consentimiento" valor={d.pacientes_sin_consentimiento} tono={d.pacientes_sin_consentimiento ? "alerta" : undefined} />
        </div>
      ) : (
        <div className="rejilla" style={{ marginBottom: 18 }}>
          <Metrica titulo="Mis citas hoy" valor={d.citas_hoy} />
          <Metrica titulo="Pacientes atendidos (mes)" valor={d.pacientes_atendidos_mes} />
          <Metrica titulo="Mi comisión del mes" valor={d.comision_mes == null ? "No aplica" : clp(d.comision_mes)} />
        </div>
      )}
      <div className="tarjeta">
        <h3>{admin ? "Agenda de hoy" : "Mis próximas atenciones de hoy"}</h3>
        {d.proximas.length === 0 ? <Vacio>No hay citas pendientes para hoy.</Vacio> : (
          <div className="tabla-wrap"><table><thead><tr><th>Hora</th><th>Paciente</th><th>Servicio</th>{admin && <><th>Profesional</th><th>Box</th></>}<th>Estado</th></tr></thead>
            <tbody>{d.proximas.map((c: any, i: number) => <tr key={i}><td><b>{c.hora}</b></td><td>{c.paciente}</td><td>{c.servicio}</td>{admin && <><td>{c.profesional}</td><td>{c.box}</td></>}<td><Insignia estado={c.estado} /></td></tr>)}</tbody></table></div>
        )}
      </div>
    </>
  );
}
