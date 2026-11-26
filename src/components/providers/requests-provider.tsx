"use client";

import { handleAuthenticationResponse } from "@/lib/auth-client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, X } from "lucide-react";
import type { RequestOverview, RequestSummary } from "@/types/requests";

interface RequestsContextValue {
  summary: RequestSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}

const RequestsContext = createContext<RequestsContextValue | null>(null);

export function RequestsProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/requests/overview", { cache: "no-store", signal: controller.signal });
      handleAuthenticationResponse(response);
      if (!response.ok) throw new Error("Solicitações indisponíveis.");
      const data = await response.json() as RequestOverview;
      if (controller.signal.aborted || requestGeneration !== generation.current) return;
      setSummary(data.summary);
    } catch {
      if (controller.signal.aborted || requestGeneration !== generation.current) return;
      setSummary(null);
      setError("Não foi possível carregar as solicitações. Tente novamente.");
    } finally {
      if (!controller.signal.aborted && requestGeneration === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) return refresh(); });
    function refreshOnFocus() { if (document.visibilityState === "visible") void refresh(); }
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      cancelled = true;
      generation.current += 1;
      activeRequest.current?.abort();
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [refresh]);

  const notify = useCallback((message: string) => setNotice(message), []);

  return <RequestsContext.Provider value={{ summary, loading, error, refresh, notify }}>
    {children}
    {notice && <div role="status" className="fixed right-4 bottom-5 z-[60] flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-emerald-200 bg-white p-4 text-sm shadow-lg sm:right-7"><CheckCircle2 className="size-5 shrink-0 text-emerald-600" /><span>{notice}</span><button type="button" aria-label="Fechar confirmação da solicitação" onClick={() => setNotice("")} className="ml-2 rounded p-1 text-slate-400 hover:bg-slate-100"><X className="size-4" /></button></div>}
  </RequestsContext.Provider>;
}

export function useRequests() {
  const context = useContext(RequestsContext);
  if (!context) throw new Error("useRequests deve ser usado dentro de RequestsProvider.");
  return context;
}
