import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export interface User { id: number; nombre: string; rol: "ADMIN" | "PROFESIONAL"; profesionalId: number | null; debe_cambiar_clave?: boolean }
interface Ctx { user: User | null; loading: boolean; refresh(): Promise<void>; login(u: string, p: string): Promise<void>; logout(): Promise<void> }
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get<User>("/auth/me").then(setUser).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  useEffect(() => { const h = () => setUser(null); window.addEventListener("deva:unauth", h); return () => window.removeEventListener("deva:unauth", h); }, []);
  const login = useCallback(async (username: string, password: string) => setUser(await api.post<User>("/auth/login", { username, password })), []);
  const refresh = useCallback(async () => { try { setUser(await api.get<User>("/auth/me")); } catch { setUser(null); } }, []);
  const logout = useCallback(async () => { await api.post("/auth/logout").catch(() => {}); setUser(null); }, []);
  return <AuthCtx.Provider value={{ user, loading, refresh, login, logout }}>{children}</AuthCtx.Provider>;
}
