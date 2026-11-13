import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../api";
import { Alerta, Campo, useToast } from "../ui";

/** Cambio de contraseña. Con `forzado` es lo único que la persona puede hacer hasta cambiar su clave temporal. */
export function CambiarClave({ forzado = false }: { forzado?: boolean }) {
  const { user, refresh, logout } = useAuth(); const toast = useToast(); const nav = useNavigate();
  const [f, setF] = useState({ actual: "", nueva: "", repetir: "" }), [error, setError] = useState(""), [enviando, setEnviando] = useState(false);
  async function enviar(e: FormEvent) {
    e.preventDefault(); setError("");
    if (f.nueva !== f.repetir) return setError("Las contraseñas nuevas no coinciden.");
    if (f.nueva.length < 8) return setError("La contraseña nueva debe tener al menos 8 caracteres.");
    setEnviando(true);
    try { await api.post("/auth/password", { actual: f.actual, nueva: f.nueva }); toast("Contraseña actualizada"); await refresh(); if (!forzado) nav("/"); }
    catch (err: any) { setError(err.message); } finally { setEnviando(false); }
  }
  const form = (
    <form onSubmit={enviar} className="form-rejilla" style={{ maxWidth: 420 }}>
      <div className="campo ancho"><Alerta>{error}</Alerta></div>
      {forzado && <div className="campo ancho"><Alerta tipo="info">Hola {user!.nombre.split(" ")[0]}: por seguridad debe reemplazar su contraseña temporal antes de continuar.</Alerta></div>}
      <Campo label={forzado ? "Contraseña temporal" : "Contraseña actual"} ancho><input type="password" value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} autoComplete="current-password" required /></Campo>
      <Campo label="Contraseña nueva (mínimo 8 caracteres)" ancho><input type="password" value={f.nueva} onChange={(e) => setF({ ...f, nueva: e.target.value })} autoComplete="new-password" required minLength={8} /></Campo>
      <Campo label="Repetir contraseña nueva" ancho><input type="password" value={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.value })} autoComplete="new-password" required /></Campo>
      <div className="campo ancho acciones"><button className="btn" disabled={enviando}>Cambiar contraseña</button>{forzado && <button type="button" className="btn-sec" onClick={logout}>Cerrar sesión</button>}</div>
    </form>
  );
  return forzado ? <div className="login-fondo"><div className="login" style={{ maxWidth: 480, textAlign: "left" }}><h1 style={{ fontSize: "2rem" }}>Deva</h1><div className="sub">Aesthetic House</div>{form}</div></div> : <><div className="pagina-cab"><h2>Mi cuenta</h2></div><div className="tarjeta"><h3>Cambiar contraseña</h3>{form}</div></>;
}
