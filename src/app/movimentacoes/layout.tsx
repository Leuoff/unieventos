import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Movimentações" };

export default function MovementsLayout({ children }: { children: ReactNode }) {
  return children;
}
