"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, X } from "lucide-react";
import { authRequest } from "@/lib/auth-client";
import type { MovementOverview } from "@/types/movements";

interface MovementsContextValue extends MovementOverview { loading: boolean; error: string | null; refresh: () => Promise<void>; notify: (message: string) => void }
const MovementsContext = createContext<MovementsContextValue | null>(null);
const emptySummary = { total: 0, inUse: 0, pending: 0, overdue: 0, damaged: 0, lost: 0 };

export function MovementsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<MovementOverview>({ items: [], summary: emptySummary, limitReached: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    activeRequest.current?.abort();
    const controller = new AbortController(); activeRequest.current = controller;
    setLoading(true); setError(null);
    try {
      const result = await authRequest<MovementOverview>("/api/movements/overview", { signal: controller.signal });
      if (!controller.signal.aborted && current === generation.current) setData(result);
    } catch (failure) {
      if (!controller.signal.aborted && current === generation.current) { setData({ items: [], summary: emptySummary, limitReached: false }); setError(failure instanceof Error ? failure.message : "Movimentações indisponíveis."); }
    } finally { if (!controller.signal.aborted && current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) return refresh(); });
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus);
    return () => { cancelled = true; generation.current += 1; activeRequest.current?.abort(); window.removeEventListener("focus", focus); };
  }, [refresh]);
  const notify = useCallback((message: string) => setNotice(message), []);
  return <MovementsContext.Provider value={{ ...data, loading, error, refresh, notify }}>{children}{notice && <div role="status" className="fixed right-4 bottom-5 z-[60] flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-emerald-200 bg-white p-4 text-sm shadow-lg"><CheckCircle2 className="size-5 shrink-0 text-emerald-600" /><span>{notice}</span><button type="button" aria-label="Fechar confirmação da movimentação" onClick={() => setNotice("")} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="size-4" /></button></div>}</MovementsContext.Provider>;
}

export function useMovements() {
  const context = useContext(MovementsContext);
  if (!context) throw new Error("useMovements deve ser usado dentro de MovementsProvider.");
  return context;
}
