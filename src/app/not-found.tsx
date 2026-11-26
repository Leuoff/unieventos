import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center"><span className="text-sm font-semibold text-blue-600">ERRO 404</span><h1 className="text-2xl font-semibold">Página não encontrada</h1><p className="text-sm text-slate-500">A página que você procura não está disponível.</p><Button asChild><Link href="/">Voltar ao Dashboard</Link></Button></div>;
}
