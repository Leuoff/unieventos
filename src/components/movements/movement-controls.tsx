"use client";

import Link from "next/link";
import { ArrowUpRight, Clock3, PackageOpen, ShieldAlert, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SummaryCard, ModuleTable } from "@/components/modules/module-controls";
import { formatDateTime, formatNumber } from "@/lib/format";
import { movementStatusLabels, type MovementChecklist, type MovementSummary, type PhysicalMovement } from "@/types/movements";

export function MovementBadge({ movement }: { movement: PhysicalMovement }) {
  return <div className="flex flex-wrap gap-1.5"><Badge variant="outline" className={movement.status === "OVERDUE" ? "border-rose-200 bg-rose-50 text-rose-700" : movement.status === "COMPLETED" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-blue-100 bg-blue-50 text-blue-700"}>{movementStatusLabels[movement.status]}</Badge>{movement.damagedQuantity > 0 && movement.status !== "DAMAGED" && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">{movement.damagedQuantity} com avaria</Badge>}{movement.lostQuantity > 0 && movement.status !== "LOST" && <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">{movement.lostQuantity} extraviados</Badge>}</div>;
}

export function MovementSummaryCards({ summary, loading = false }: { summary?: MovementSummary; loading?: boolean }) {
  const value = (key: keyof MovementSummary) => summary ? formatNumber(summary[key]) : loading ? "…" : "—";
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy={loading}><SummaryCard title="Unidades em uso" value={value("inUse")} description="Retiradas ainda não regularizadas" icon={<PackageOpen className="size-4" />} /><SummaryCard title="Retiradas em atraso" value={value("overdue")} description="Conferir o retorno dos equipamentos" icon={<Clock3 className="size-4" />} tone="amber" /><SummaryCard title="Devoluções com avaria" value={value("damaged")} description="Direcionadas à manutenção" icon={<Wrench className="size-4" />} tone="amber" /><SummaryCard title="Extravios registrados" value={value("lost")} description="Unidades indisponíveis no estoque" icon={<ShieldAlert className="size-4" />} tone="slate" /></div>;
}

export function MovementsTable({ items }: { items: PhysicalMovement[] }) {
  return <ModuleTable columns={[{ key: "equipment", label: "Equipamento / evento" }, { key: "responsible", label: "Responsável / destino" }, { key: "quantity", label: "Quantidades" }, { key: "date", label: "Retirada / previsão" }, { key: "status", label: "Situação" }, { key: "detail", label: "Detalhes", className: "text-right" }]}>{items.map((item) => <tr key={item.id} className="hover:bg-slate-50/70"><td className="max-w-64 px-5 py-4"><Link className="font-medium text-slate-800 hover:text-blue-600" href={`/movimentacoes/${item.id}`}>{item.equipmentName}</Link><p className="mt-1 text-xs text-slate-500">{item.eventTitle ?? "Registro histórico sem evento vinculado"}</p></td><td className="max-w-52 px-5 py-4"><p className="break-words text-slate-700">{item.responsibleName || "Não informado no histórico"}</p><p className="mt-1 break-words text-xs text-slate-500">{item.destination || "Destino não informado"}</p></td><td className="whitespace-nowrap px-5 py-4"><p className="text-xs font-medium text-slate-700">{item.quantity} retiradas · {item.pendingQuantity} pendentes</p><p className="mt-1 text-xs text-slate-500">{item.returnedQuantity} devolvidas · {item.lostQuantity} extraviadas</p></td><td className="whitespace-nowrap px-5 py-4 text-xs text-slate-500"><p>{formatDateTime(item.createdAt)}</p><p className="mt-1">Até {item.expectedReturnAt ? formatDateTime(item.expectedReturnAt) : "prazo não registrado"}</p></td><td className="px-5 py-4"><MovementBadge movement={item} /></td><td className="px-5 py-4 text-right"><Link href={`/movimentacoes/${item.id}`} aria-label={`Ver movimentação de ${item.equipmentName}`} className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600"><ArrowUpRight className="size-4" /></Link></td></tr>)}</ModuleTable>;
}

export const emptyChecklist: MovementChecklist = { quantityChecked: false, conditionChecked: false, accessoriesChecked: false };
export function MovementChecklistSnapshot({ value }: { value: MovementChecklist | null }) {
  if (!value) return <p className="mt-3 text-xs text-slate-500">Checklist não registrado neste histórico anterior.</p>;
  return <ul aria-label="Checklist registrado" className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">{[{ label: "Quantidade e patrimônios", checked: value.quantityChecked }, { label: "Condição física", checked: value.conditionChecked }, { label: "Acessórios", checked: value.accessoriesChecked }].map((item) => <li key={item.label}><span className={item.checked ? "font-medium text-emerald-700" : "text-amber-700"}>{item.checked ? "✓" : "Pendente"}</span> {item.label}</li>)}</ul>;
}
export function MovementChecklistFields({ value, onChange, disabled = false }: { value: MovementChecklist; onChange: (value: MovementChecklist) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-slate-200 p-4"><legend className="px-1 text-xs font-semibold text-slate-700">Checklist de conferência</legend>{([{ key: "quantityChecked", label: "Conferi as quantidades e os patrimônios selecionados" }, { key: "conditionChecked", label: "Conferi as condições físicas dos equipamentos" }, { key: "accessoriesChecked", label: "Conferi cabos, acessórios e demais componentes" }] as const).map(({ key, label }) => <label key={key} className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-slate-600"><input type="checkbox" checked={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} className="mt-0.5 size-5 shrink-0 accent-blue-600" /><span>{label}</span></label>)}</fieldset>;
}
