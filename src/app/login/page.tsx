"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { CalendarDays, GraduationCap, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeReturnPath } from "@/lib/auth-client";

export default function LoginPage() {
  return <Suspense fallback={<div role="status" className="p-8 text-sm text-slate-500">Carregando acesso…</div>}><LoginForm /></Suspense>;
}

function LoginForm() {
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!email.trim() || !password) { setError("Informe seu e-mail institucional e sua senha."); return; }
    setSaving(true);
    try {
      const result = await signIn("credentials", { email: email.trim(), password, redirect: false });
      if (!result || result.error) { setError("Não foi possível entrar. Verifique suas credenciais e se sua conta está ativa."); setSaving(false); return; }
      window.location.assign(safeReturnPath(search.get("next")));
    } catch { setError("Não foi possível conectar ao serviço de acesso. Tente novamente."); setSaving(false); }
  }
  return <main className="grid min-h-screen bg-slate-50 lg:grid-cols-2"><section className="relative hidden overflow-hidden bg-[#102a50] px-14 py-12 text-white lg:flex lg:flex-col"><div className="absolute -right-40 top-1/4 size-[600px] rounded-full border border-white/5" /><div className="absolute -right-24 top-1/3 size-[400px] rounded-full border border-white/5" /><div className="relative flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-xl bg-blue-500"><CalendarDays className="size-6" /></span><span className="text-2xl font-bold tracking-tight">Uni<span className="font-normal text-blue-200">Eventos</span></span></div><div className="relative my-auto max-w-lg py-16"><div className="mb-7 inline-flex items-center gap-2 rounded-full border border-blue-200/15 bg-white/5 px-4 py-2 text-xs text-blue-100"><GraduationCap className="size-4" />Gestão institucional · UniSALESIANO</div><h1 className="text-4xl leading-tight font-semibold tracking-tight xl:text-5xl">Pessoas, eventos e recursos conectados.</h1><p className="mt-6 max-w-md text-base leading-relaxed text-blue-100/65">Uma agenda compartilhada para Multimeios, Marketing e Projeto de Extensão. Planeje seus eventos e acompanhe os equipamentos em um só lugar.</p></div><p className="relative text-xs text-blue-100/45">UniSALESIANO · Presença que transforma</p></section><section className="flex items-center justify-center px-5 py-12 sm:px-10"><div className="w-full max-w-[400px]"><div className="mb-10 flex items-center gap-3 lg:hidden"><span className="flex size-10 items-center justify-center rounded-xl bg-[#2861cf] text-white"><CalendarDays className="size-5" /></span><span className="text-xl font-bold text-[#102a50]">Uni<span className="font-normal">Eventos</span></span></div><span className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-700"><LockKeyhole className="size-5" /></span><h2 className="text-2xl font-semibold tracking-tight text-slate-900">Acesse sua conta</h2><p className="mt-3 text-sm leading-relaxed text-slate-500">Entre com suas credenciais institucionais para continuar.</p>{search.get("expired") === "1" && <p role="status" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">Sua sessão expirou ou o acesso foi revogado. Entre novamente para continuar.</p>}<form onSubmit={submit} className="mt-8 space-y-5" noValidate><div><label htmlFor="login-email" className="mb-2 block text-xs font-medium text-slate-700">E-mail institucional</label><div className="relative"><Mail className="absolute top-3 left-3 size-4 text-slate-400" /><Input id="login-email" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="seu.nome@unisalesiano.com.br" maxLength={254} className="h-11 pl-10" disabled={saving} required /></div></div><div><label htmlFor="login-password" className="mb-2 block text-xs font-medium text-slate-700">Senha</label><Input id="login-password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={128} className="h-11" disabled={saving} required /></div>{error && <p role="alert" className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<Button type="submit" className="h-11 w-full" disabled={saving}>{saving && <LoaderCircle className="animate-spin" />}{saving ? "Entrando…" : "Entrar no UniEventos"}</Button></form><p className="mt-6 text-xs leading-relaxed text-slate-500">Não tem acesso ou esqueceu sua senha? Entre em contato com o administrador do UniEventos. O cadastro é realizado pela instituição.</p><div className="mt-10 flex items-start gap-2 border-t border-slate-200 pt-5 text-[11px] leading-relaxed text-slate-400"><ShieldCheck className="mt-0.5 size-4 shrink-0" /><span>Use uma conta individual. As operações são registradas com a identidade autenticada e seguem suas permissões.</span></div></div></section></main>;
}
