"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, X } from "lucide-react";
import type { InventoryEquipment, InventorySummary } from "@/types/inventory";
import { handleAuthenticationResponse } from "@/lib/auth-client";

interface InventoryContextValue {
  summary: InventorySummary | null;
  items: InventoryEquipment[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [items, setItems] = useState<InventoryEquipment[]>([]);
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
      const response = await fetch("/api/equipment/overview", { cache: "no-store", signal: controller.signal });
      handleAuthenticationResponse(response);
      if (!response.ok) throw new Error("Não foi possível carregar o estoque. Tente novamente.");
      const data = await response.json() as { summary: InventorySummary; items: InventoryEquipment[] };
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      setSummary(data.summary);
      setItems(data.items);
    } catch {
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      setSummary(null);
      setItems([]);
      setError("Não foi possível carregar o estoque. Tente novamente.");
    } finally {
      if (!controller.signal.aborted && generation.current === requestGeneration) setLoading(false);
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

  return (
    <InventoryContext.Provider value={{ summary, items, loading, error, refresh, notify }}>
      {children}
      {notice && (
        <div role="status" className="fixed right-4 bottom-5 z-[60] flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-emerald-200 bg-white p-4 text-sm shadow-lg sm:right-7">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          <span>{notice}</span>
          <button type="button" aria-label="Fechar confirmação do estoque" onClick={() => setNotice("")} className="ml-2 rounded p-1 text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>
      )}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  const context = useContext(InventoryContext);
  if (!context) throw new Error("useInventory deve ser usado dentro de InventoryProvider.");
  return context;
}
