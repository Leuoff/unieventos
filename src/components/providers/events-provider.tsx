"use client";

import { handleAuthenticationResponse } from "@/lib/auth-client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, X } from "lucide-react";
import { todayInstitutional } from "@/lib/event-time";
import type { CalendarEvent, EventSummary } from "@/types/events";

interface EventsContextValue {
  items: CalendarEvent[];
  summary: EventSummary | null;
  today: string;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}

const EventsContext = createContext<EventsContextValue | null>(null);

export function EventsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CalendarEvent[]>([]);
  const [summary, setSummary] = useState<EventSummary | null>(null);
  const [today, setToday] = useState(todayInstitutional);
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
      const response = await fetch("/api/events/overview", { cache: "no-store", signal: controller.signal });
      handleAuthenticationResponse(response);
      if (!response.ok) throw new Error("Não foi possível carregar os eventos. Tente novamente.");
      const data = await response.json() as { items: CalendarEvent[]; summary: EventSummary; today: string };
      if (controller.signal.aborted || requestGeneration !== generation.current) return;
      setItems(data.items);
      setSummary(data.summary);
      setToday(data.today);
    } catch {
      if (controller.signal.aborted || requestGeneration !== generation.current) return;
      setItems([]);
      setSummary(null);
      setError("Não foi possível carregar os eventos. Tente novamente.");
    } finally {
      if (!controller.signal.aborted && requestGeneration === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return refresh();
    });
    return () => {
      cancelled = true;
      generation.current += 1;
      activeRequest.current?.abort();
    };
  }, [refresh]);

  const notify = useCallback((message: string) => setNotice(message), []);

  return <EventsContext.Provider value={{ items, summary, today, loading, error, refresh, notify }}>
    {children}
    {notice && <div role="status" className="fixed right-4 bottom-5 z-[60] flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-emerald-200 bg-white p-4 text-sm shadow-lg sm:right-7"><CheckCircle2 className="size-5 shrink-0 text-emerald-600" /><span>{notice}</span><button type="button" aria-label="Fechar confirmação do evento" onClick={() => setNotice("")} className="ml-2 rounded p-1 text-slate-400 hover:bg-slate-100"><X className="size-4" /></button></div>}
  </EventsContext.Provider>;
}

export function useEvents() {
  const context = useContext(EventsContext);
  if (!context) throw new Error("useEvents deve ser usado dentro de EventsProvider.");
  return context;
}
