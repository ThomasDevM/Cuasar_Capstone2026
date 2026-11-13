import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { Alerta } from "../ui";

export default function Login() {
  const { login } = useAuth();
  const [username, setU] = useState(""), [password, setP] = useState(""), [error, setError] = useState(""), [cargando, setC] = useState(false);
  async function enviar(e: FormEvent) {
    e.preventDefault(); setError(""); setC(true);
    try { await login(username.trim(), password); } catch (err: any) { setError(err.message); } finally { setC(false); }
  }
  return (
    <div className="login-fondo">
      <div className="login">
        <h1>Deva</h1><div className="sub">Aesthetic House</div>
        <form onSubmit={enviar}>
          <Alerta>{error}</Alerta>
          <label className="campo"><span>Usuario</span><input type="text" value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus required /></label>
          <label className="campo"><span>Clave</span><input type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></label>
          <button className="btn" disabled={cargando}>{cargando ? "Ingresando…" : "Ingresar"}</button>
        </form>
        <small>Sistema interno de gestión · v1.0</small>
      </div>
    </div>
  );
}
