"use client";

import Link from "next/link";
import { ArrowUpRight, ClipboardList, LoaderCircle } from "lucide-react";
import { useRequests } from "@/components/providers/requests-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";

export function RequestsSummaryPanel() {
  const { summary, loading, error, refresh } = useRequests();

  return <Card role="region" className="overflow-hidden shadow-none" aria-label="Indicadores de solicitações" aria-busy={loading}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><ClipboardList className="size-4" /></span><div><h2 className="panel-heading">Solicitações de equipamentos</h2><p className="mt-1 text-[11px] text-slate-500">Todos os setores · todo o período · dados persistidos</p></div></div><Link href="/solicitacoes" className="flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline">Ver solicitações<ArrowUpRight className="size-3.5" /></Link></div>
    {loading ? <p role="status" className="flex items-center gap-2 px-5 py-7 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Carregando indicadores de solicitações…</p> : error || !summary ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-5 py-6"><p className="text-sm text-slate-500">{error ?? "Indicadores de solicitações indisponíveis."}</p><Button variant="outline" size="sm" onClick={() => void refresh()}>Tentar novamente</Button></div> : <>
      <dl className="grid gap-5 px-5 py-5 sm:grid-cols-3"><div className="rounded-lg border border-amber-100 bg-amber-50/60 p-4"><dt className="text-xs font-medium text-amber-800">Solicitações pendentes</dt><dd className="mt-2 text-3xl font-semibold tracking-tight text-amber-900">{formatNumber(summary.pending)}</dd><p className="mt-1 text-[11px] text-amber-700">Aguardando análise · não bloqueiam estoque</p>{summary.pending > 0 && <Link href="/solicitacoes?status=PENDING" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-amber-900 hover:underline">Consultar pendências<ArrowUpRight className="size-3" /></Link>}</div><div className="rounded-lg border border-slate-100 p-4"><dt className="text-xs font-medium text-slate-500">Rascunhos</dt><dd className="mt-2 text-3xl font-semibold tracking-tight text-slate-800">{formatNumber(summary.draft)}</dd><p className="mt-1 text-[11px] text-slate-500">Pedidos ainda em preparação</p></div><div className="rounded-lg border border-slate-100 p-4"><dt className="text-xs font-medium text-slate-500">Solicitações aprovadas</dt><dd className="mt-2 text-3xl font-semibold tracking-tight text-slate-800">{formatNumber(summary.approved)}</dd><p className="mt-1 text-[11px] text-slate-500">Compromissos nos respectivos períodos</p></div></dl>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-[11px] text-slate-500"><p>{formatNumber(summary.total)} {summary.total === 1 ? "solicitação cadastrada" : "solicitações cadastradas"} · {formatNumber(summary.refused)} recusadas · {formatNumber(summary.cancelled)} canceladas</p>{summary.total === 0 && <Link href="/solicitacoes" className="font-medium text-blue-600 hover:underline">Crie a primeira solicitação</Link>}</div>
    </>}
  </Card>;
}
