"use client";

import Link from "next/link";
import { ArrowDownUp, ArrowUpRight, LoaderCircle } from "lucide-react";
import { useMovements } from "@/components/providers/movements-provider";
import { InventoryError } from "@/components/inventory/inventory-controls";
import { MovementSummaryCards } from "@/components/movements/movement-controls";
import { Card } from "@/components/ui/card";

export function MovementsSummaryPanel() {
  const { summary, items, loading, error, refresh, limitReached } = useMovements();
  return <Card role="region" aria-label="Indicadores de movimentações" aria-busy={loading} className="overflow-hidden shadow-none"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><ArrowDownUp className="size-4" /></span><div><h2 className="panel-heading">Controle físico dos equipamentos</h2><p className="mt-1 text-[11px] text-slate-500">Todos os setores · retiradas e conferências persistidas</p></div></div><Link href="/movimentacoes" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">Ver movimentações<ArrowUpRight className="size-3.5" /></Link></div><div className="p-5">{loading ? <p role="status" className="flex items-center gap-2 py-4 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Carregando movimentações…</p> : error ? <InventoryError message={error} onRetry={() => void refresh()} /> : <><MovementSummaryCards summary={summary} />{summary.overdue > 0 && <Link href="/movimentacoes?status=OVERDUE" className="mt-4 block rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs leading-relaxed text-rose-800">{summary.overdue} {summary.overdue === 1 ? "retirada em atraso exige" : "retiradas em atraso exigem"} conferência. Equipamentos pendentes continuam indisponíveis.</Link>}{items.length === 0 && <p className="mt-4 text-xs text-slate-500">Nenhuma retirada registrada. Reservas aprovadas não geram movimentações automaticamente.</p>}{limitReached && <p className="mt-4 text-xs text-slate-500">A busca rápida apresenta os registros mais recentes. Use o módulo para consultar o histórico completo.</p>}</>}</div></Card>;
}
