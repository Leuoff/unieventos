import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { AvailabilityItem } from "@/types/requests";

export function AvailabilityNotice({ items }: { items: AvailabilityItem[] }) {
  if (!items.length) return null;
  return <section aria-label="Disponibilidade no período" className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-semibold text-slate-900">Disponibilidade no período</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">Consulta informativa. Rascunhos e solicitações pendentes não bloqueiam o estoque. A disponibilidade será conferida novamente durante uma aprovação autorizada.</p><ul className="mt-3 space-y-3">{items.map((item) => <li key={item.equipmentId} className="rounded-lg bg-white p-3 text-xs"><p className="flex items-start gap-2 font-medium text-slate-800">{item.sufficient ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />}{item.equipmentName}</p><p className="mt-1 text-slate-600">{item.requested} solicitadas · {item.available} disponíveis no intervalo</p><p className={`mt-1 leading-relaxed ${item.sufficient ? "text-emerald-700" : "text-amber-800"}`}>{item.message}</p></li>)}</ul></section>;
}
