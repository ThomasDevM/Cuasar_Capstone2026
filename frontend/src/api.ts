export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/v1" + path, {
    method, credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("deva:unauth"));
  if (!res.ok) {
    let msg = "Error inesperado", code: string | undefined;
    try { const j = await res.json(); msg = j.error || msg; code = j.code; } catch { /* sin cuerpo */ }
    throw new ApiError(msg, res.status, code);
  }
  return res.json() as Promise<T>;
}
export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>("PUT", p, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => request<T>("PATCH", p, b ?? {}),
  del: <T = any>(p: string) => request<T>("DELETE", p),
};

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); });
  const s = p.toString(); return s ? "?" + s : "";
};

/* ---------- Formatos y fechas (zona del centro) ---------- */
export const clp = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("es-CL"));
export const hoyStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
export function addDays(f: string, n: number) { const d = new Date(f + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const fechaLarga = (f: string) => new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(f + "T12:00:00Z"));
export const fechaCorta = (f: string) => { const [y, m, d] = f.slice(0, 10).split("-"); return `${d}-${m}-${y}`; };
export const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago", dateStyle: "short", timeStyle: "short" });
export const mesActual = () => hoyStr().slice(0, 7);
export const ESTADOS: Record<string, string> = { AGENDADA: "Agendada", CONFIRMADA: "Confirmada", REALIZADA: "Realizada", CANCELADA: "Cancelada", INASISTENCIA: "Inasistencia" };
export const MEDIOS: Record<string, string> = { EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", DEBITO: "Débito", CREDITO: "Crédito", OTRO: "Otro" };
/** Claves antiguas de antecedentes (fichas creadas antes del catálogo editable). */
export const ANTECEDENTES: Record<string, string> = { hipertension: "Hipertensión", diabetes: "Diabetes", resistencia_insulina: "Resistencia a la insulina", alergias: "Alergias / Dermatitis", acne: "Acné", rosacea: "Rosácea" };
export function validarRut(r: string) {
  const c = r.replace(/[^0-9kK]/g, "").toUpperCase(); if (c.length < 8 || c.length > 9) return false;
  let s = 0, m = 2; for (let i = c.length - 2; i >= 0; i--) { s += Number(c[i]) * m; m = m === 7 ? 2 : m + 1; }
  const d = 11 - (s % 11); return (d === 11 ? "0" : d === 10 ? "K" : String(d)) === c[c.length - 1];
}
export function formatearRut(r: string) {
  const c = r.replace(/[^0-9kK]/g, "").toUpperCase(); if (c.length < 2) return c;
  return `${c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${c.slice(-1)}`;
}
