"use client";

import { Boxes, CalendarClock, ChevronLeft, ChevronRight, PackageCheck, PackageOpen, Wrench } from "lucide-react";
import { SummaryCard } from "@/components/modules/module-controls";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import type { InventoryEquipment, InventorySummary, UnitStatus } from "@/types/inventory";

export const unitStatusLabels: Record<UnitStatus, string> = { AVAILABLE: "Disponível", RESERVED: "Reservada", IN_USE: "Em uso", MAINTENANCE: "Em manutenção", LOST: "Extraviada" };

export function InventorySummaryCards({ summary, loading = false }: { summary: InventorySummary | null; loading?: boolean }) {
  const value = (key: "total" | "available" | "reserved" | "inUse" | "maintenance" | "lost") => summary ? formatNumber(summary[key]) : loading ? "…" : "—";
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6" aria-busy={loading}>
    <SummaryCard title="Total de equipamentos" value={value("total")} description={summary ? `${formatNumber(summary.totalTypes)} tipos de recursos cadastrados` : "Recursos ativos do campus"} icon={<Boxes className="size-4" />} />
    <SummaryCard title="Disponíveis" value={value("available")} description="Prontos para novas solicitações" icon={<PackageCheck className="size-4" />} tone="green" />
    <SummaryCard title="Reservados" value={value("reserved")} description="Aguardando a retirada" icon={<CalendarClock className="size-4" />} />
    <SummaryCard title="Em uso" value={value("inUse")} description="Retirados para atividades" icon={<PackageOpen className="size-4" />} tone="slate" />
    <SummaryCard title="Em manutenção" value={value("maintenance")} description="Indisponíveis temporariamente" icon={<Wrench className="size-4" />} tone="amber" />
    <SummaryCard title="Extraviados" value={value("lost")} description="Indisponíveis até regularização" icon={<PackageOpen className="size-4" />} tone="slate" />
  </div>;
}

export function StockLevels({ equipment }: { equipment: InventoryEquipment }) {
  const levels = [{ label: "disponíveis", value: equipment.available, color: "bg-emerald-500" }, { label: "reservados", value: equipment.reserved, color: "bg-blue-400" }, { label: "em uso", value: equipment.inUse, color: "bg-slate-400" }, { label: "em manutenção", value: equipment.maintenance, color: "bg-amber-400" }, { label: "extraviados", value: equipment.lost, color: "bg-rose-400" }];
  return <>
    {equipment.conflictQuantity > 0 && <p role="status" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-800">Conflito físico atual: {equipment.conflictQuantity} unidades comprometidas acima da capacidade disponível. Confira atrasos, avarias e reservas. Novas retiradas dependem de regularização.</p>}
    <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={levels.map((level) => `${level.value} ${level.label}`).join(", ")}>
      {levels.map((level) => <span key={level.label} className={level.color} style={{ width: `${equipment.total ? level.value / equipment.total * 100 : 0}%` }} />)}
    </div>
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">{levels.map((level) => <span key={level.label}>{formatNumber(level.value)} {level.label}</span>)}</div>
  </>;
}

export function InventoryPagination({ pagination, onChange, label = "equipamentos", disabled = false }: { pagination: { page: number; pageSize: number; total: number; totalPages: number }; onChange: (page: number) => void; label?: string; disabled?: boolean }) {
  const { page, pageSize, total, totalPages } = pagination;
  return <nav aria-label={`Paginação de ${label}`} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
    <p className="text-xs text-slate-500">{total ? `${formatNumber((page - 1) * pageSize + 1)}–${formatNumber(Math.min(page * pageSize, total))} de ${formatNumber(total)}` : "0"} {label}</p>
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)} aria-label={`Página anterior de ${label}`}><ChevronLeft /> <span className="hidden sm:inline">Anterior</span></Button>
      <span className="px-1 text-xs text-slate-500">Página {page} de {Math.max(1, totalPages)}</span>
      <Button variant="outline" size="sm" disabled={disabled || page >= totalPages} onClick={() => onChange(page + 1)} aria-label={`Próxima página de ${label}`}><span className="hidden sm:inline">Próxima</span> <ChevronRight /></Button>
    </div>
  </nav>;
}

export function InventoryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="rounded-xl border border-rose-200 bg-rose-50 p-5" role="alert"><p className="text-sm text-rose-700">{message}</p><Button className="mt-3" variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button></div>;
}
