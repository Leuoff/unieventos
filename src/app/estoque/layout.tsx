import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

export const metadata: Metadata = { title: "Estoque" };

export default function InventoryLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p role="status" className="py-8 text-sm text-slate-500">Carregando estoque...</p>}>{children}</Suspense>;
}
