"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import type { AuthUser, Permission } from "@/types/auth";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/app-shell";
import { MovementsProvider } from "@/components/providers/movements-provider";
import { InventoryProvider } from "@/components/providers/inventory-provider";
import { EventsProvider } from "@/components/providers/events-provider";
import { RequestsProvider } from "@/components/providers/requests-provider";

interface AuthContextValue {
  user: AuthUser | null; loading: boolean; error: string | null;
  refresh: () => Promise<void>; hasPermission: (permission: Permission) => boolean;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok && response.status !== 401) throw new Error("Não foi possível verificar sua sessão. Tente novamente.");
      const data = response.ok ? await response.json() as { user: AuthUser | null } : { user: null };
      if (current !== generation.current) return;
      setUser(data.user); setError(null);
    } catch (failure) {
      if (current !== generation.current) return;
      setUser(null); setError(failure instanceof Error ? failure.message : "Sessão indisponível.");
    } finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) return refresh(); });
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    const onExpired = () => { generation.current += 1; setUser(null); setError(null); setLoading(false); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("unieventos:session-expired", onExpired);
    return () => { cancelled = true; generation.current += 1; window.removeEventListener("focus", onFocus); window.removeEventListener("unieventos:session-expired", onExpired); };
  }, [refresh]);
  return <AuthContext.Provider value={{ user, loading, error, refresh, hasPermission: (permission) => user?.permissions.includes(permission) ?? false }}>{children}</AuthContext.Provider>;
}

export function AuthenticatedApp({ children }: { children: ReactNode }) {
  const { user, loading, error, refresh } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  useEffect(() => {
    if (!isLogin && !loading && !user && !error) router.replace(`/login?expired=1&next=${encodeURIComponent(pathname)}`);
  }, [isLogin, loading, user, error, router, pathname]);
  if (isLogin) return children;
  if (error) return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><div className="max-w-md rounded-2xl border bg-white p-7 text-center shadow-sm"><ShieldCheck className="mx-auto mb-4 size-8 text-blue-600" /><h1 className="text-lg font-semibold">Verificação de acesso indisponível</h1><p role="alert" className="mt-3 text-sm text-slate-600">{error}</p><Button className="mt-5" onClick={() => void refresh()}>Tentar novamente</Button></div></div>;
  if (loading || !user) return <div role="status" className="flex min-h-screen items-center justify-center gap-2 bg-slate-50 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Verificando acesso ao UniEventos…</div>;
  return <InventoryProvider><EventsProvider><RequestsProvider><MovementsProvider><AppShell>{children}</AppShell></MovementsProvider></RequestsProvider></EventsProvider></InventoryProvider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return value;
}
