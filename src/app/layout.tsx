import type { Metadata } from "next";
import { AuthProvider, AuthenticatedApp } from "@/components/providers/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Dashboard | UniEventos", template: "%s | UniEventos" },
  description: "Gestão integrada de eventos e equipamentos do UniSALESIANO.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body><AuthProvider><AuthenticatedApp>{children}</AuthenticatedApp></AuthProvider></body></html>;
}
