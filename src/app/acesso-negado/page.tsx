import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AccessDeniedPage() {
  return <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-xs"><span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><ShieldAlert className="size-7" /></span><h1 className="text-2xl font-semibold text-slate-900">Acesso negado</h1><p className="mt-4 text-sm leading-relaxed text-slate-500">Sua conta não tem permissão para acessar esta área ou executar esta operação. Se precisar de acesso, entre em contato com um administrador.</p><Button asChild className="mt-7"><Link href="/">Voltar ao Dashboard</Link></Button></div>;
}
