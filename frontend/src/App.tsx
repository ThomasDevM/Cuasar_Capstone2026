import { NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Cargando } from "./ui";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Agenda from "./pages/Agenda";
import { PacientesLista, PacienteForm, PacienteDetalle } from "./pages/Pacientes";
import Ventas from "./pages/Ventas";
import Informes from "./pages/Informes";
import { CambiarClave } from "./pages/Cuenta";
import { BuscadorGlobal } from "./forms";
import Seguimiento from "./pages/Seguimiento";
import Admin from "./pages/Admin";

function Layout() {
  const { user, logout } = useAuth();
  const admin = user!.rol === "ADMIN";
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "activo" : "");
  return (
    <>
      <div className="topbar"><span>Kinesiología Dermatofuncional &amp; Medicina Estética</span><span>{user!.nombre} · {admin ? "Dirección" : "Profesional"}</span></div>
      <header className="nav">
        <div className="logo"><h2>Deva</h2><span>Aesthetic House</span></div>
        <nav className="nav-links" aria-label="Principal">
          <NavLink to="/" end className={link}>Inicio</NavLink>
          <NavLink to="/agenda" className={link}>Agenda</NavLink>
          <NavLink to="/pacientes" className={link}>Pacientes</NavLink>
          <NavLink to="/ventas" className={link}>Ventas</NavLink>
          <NavLink to="/informes" className={link}>{admin ? "Informes" : "Mi ganancia"}</NavLink>
          {admin && <NavLink to="/seguimiento" className={link}>Seguimiento</NavLink>}
          {admin && <NavLink to="/admin" className={link}>Administración</NavLink>}
        </nav>
        <BuscadorGlobal />
        <NavLink to="/cuenta" className="btn-sec chico" style={{ textDecoration: "none" }}>Mi cuenta</NavLink>
        <button className="btn-sec chico" onClick={logout}>Cerrar sesión</button>
      </header>
      <main className="contenedor"><Outlet /></main>
    </>
  );
}

function Protegida({ soloAdmin }: { soloAdmin?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <Cargando />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.debe_cambiar_clave) return <CambiarClave forzado />;
  if (soloAdmin && user.rol !== "ADMIN") return <Navigate to="/" replace />;
  return <Layout />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Cargando />;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<Protegida />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/pacientes" element={<PacientesLista />} />
        <Route path="/pacientes/nuevo" element={<PacienteForm />} />
        <Route path="/pacientes/:id" element={<PacienteDetalle />} />
        <Route path="/pacientes/:id/editar" element={<PacienteForm />} />
        <Route path="/ventas" element={<Ventas />} />
        <Route path="/informes" element={<Informes />} />
        <Route path="/comisiones" element={<Navigate to="/informes" replace />} />
        <Route path="/cuenta" element={<CambiarClave />} />
      </Route>
      <Route element={<Protegida soloAdmin />}>
        <Route path="/seguimiento" element={<Seguimiento />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
