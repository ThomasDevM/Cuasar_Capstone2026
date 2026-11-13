import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ESTADOS } from "./api";

/* ---------- Avisos ---------- */
const ToastCtx = createContext<(m: string, tipo?: "ok" | "error") => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; m: string; tipo: string }[]>([]);
  const push = useCallback((m: string, tipo: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random(); setItems((x) => [...x, { id, m, tipo }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200);
  }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" role="status">{items.map((i) => <div key={i.id} className={`toast toast-${i.tipo}`}>{i.m}</div>)}</div></ToastCtx.Provider>;
}

/* ---------- Carga de datos ---------- */
export function useData<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let vivo = true; setLoading(true);
    fn().then((d) => { if (vivo) { setData(d); setError(""); } }).catch((e) => vivo && setError(e.message)).finally(() => vivo && setLoading(false));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

/* ---------- Componentes base ---------- */
export function Modal({ titulo, onClose, children, ancho = 560 }: { titulo: string; onClose(): void; children: ReactNode; ancho?: number }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: ancho }} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-cab"><h3>{titulo}</h3><button className="btn-icono" onClick={onClose} aria-label="Cerrar">×</button></div>
        <div className="modal-cuerpo">{children}</div>
      </div>
    </div>
  );
}
export const Campo = ({ label, children, ancho }: { label: string; children: ReactNode; ancho?: boolean }) => <label className={`campo${ancho ? " ancho" : ""}`}><span>{label}</span>{children}</label>;
export const Alerta = ({ children, tipo = "error" }: { children?: ReactNode; tipo?: "error" | "ok" | "info" }) => (children ? <div className={`alerta alerta-${tipo}`} role="alert">{children}</div> : null);
export const Insignia = ({ estado }: { estado: string }) => <span className={`insignia est-${estado}`}>{ESTADOS[estado] ?? estado}</span>;
export const Cargando = () => <div className="cargando">Cargando…</div>;
export const Vacio = ({ children }: { children: ReactNode }) => <p className="vacio">{children}</p>;
export function Pestanas({ items, activa, onChange }: { items: [string, string][]; activa: string; onChange(k: string): void }) {
  return <div className="pestanas" role="tablist">{items.map(([k, t]) => <button key={k} role="tab" aria-selected={activa === k} className={activa === k ? "activa" : ""} onClick={() => onChange(k)}>{t}</button>)}</div>;
}
export function Metrica({ titulo, valor, nota, tono }: { titulo: string; valor: ReactNode; nota?: string; tono?: "alerta" }) {
  return <div className={`metrica${tono ? " " + tono : ""}`}><h4>{titulo}</h4><p>{valor}</p>{nota && <small>{nota}</small>}</div>;
}

/* ---------- Firma digital (canvas táctil) ---------- */
export function Firma({ onChange }: { onChange(dataUrl: string | null): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const estado = useRef({ dibujando: false, trazos: 0 });
  const pos = (e: React.PointerEvent) => { const c = ref.current!, r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
  const ctx = () => { const c = ref.current!.getContext("2d")!; c.lineWidth = 2.4; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = "#2B2233"; return c; };
  const limpiar = () => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); estado.current.trazos = 0; onChange(null); };
  return (
    <div>
      <canvas ref={ref} width={640} height={200} className="firma" aria-label="Recuadro de firma"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); estado.current.dibujando = true; const p = pos(e), c = ctx(); c.beginPath(); c.moveTo(p.x, p.y); }}
        onPointerMove={(e) => { if (!estado.current.dibujando) return; const p = pos(e), c = ctx(); c.lineTo(p.x, p.y); c.stroke(); estado.current.trazos++; }}
        onPointerUp={() => { estado.current.dibujando = false; onChange(estado.current.trazos > 5 ? ref.current!.toDataURL("image/png") : null); }} />
      <button type="button" className="btn-sec chico" onClick={limpiar}>Limpiar firma</button>
    </div>
  );
}
