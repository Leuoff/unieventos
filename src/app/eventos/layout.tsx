import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

export const metadata: Metadata = { title: "Eventos" };

export default function EventsLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p role="status" className="py-8 text-sm text-slate-500">Carregando eventos...</p>}>{children}</Suspense>;
}
