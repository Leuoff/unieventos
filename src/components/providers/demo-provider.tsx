"use client";

import { createContext, useContext, type ReactNode } from "react";
import { events as demoEvents, equipment, movements } from "@/lib/mock-data";
import type { Event, Equipment, Movement } from "@/types/domain";

interface DemoContextValue {
  demoEvents: Event[];
  equipment: Equipment[];
  movements: Movement[];
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  return (
    <DemoContext.Provider value={{ demoEvents, equipment, movements }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("useDemo deve ser usado dentro de DemoProvider.");
  return context;
}
