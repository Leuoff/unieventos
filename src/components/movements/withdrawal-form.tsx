"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { authRequest } from "@/lib/auth-client";
import { instantToInstitutionalInput, institutionalToInstant } from "@/lib/event-time";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMovements } from "@/components/providers/movements-provider";
import { useInventory } from "@/components/providers/inventory-provider";
import { emptyChecklist, MovementChecklistFields } from "./movement-controls";
import type { PhysicalMovement, WithdrawalInput, WithdrawalOption } from "@/types/movements";

export function WithdrawalForm({ onClose, onSaved }: { onClose: () => void; onSaved: (movement: PhysicalMovement) => void }) {
  const id = useId();
  const { refresh, notify } = useMovements();
  const { refresh: refreshStock } = useInventory();
  const [options, setOptions] = useState<WithdrawalOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [optionId, setOptionId] = useState("");
  const [values, setValues] = useState({ quantity: 1, unitIds: [] as string[], responsibleName: "", destination: "", notes: "", expectedReturnAt: "", checklist: emptyChecklist });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const option = options.find((entry) => entry.reservationId === optionId);
  const [now] = useState(() => Date.now());
  const inPeriod = !!option && now >= new Date(option.startsAt).getTime() && now < new Date(option.endsAt).getTime();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      authRequest<{ items: WithdrawalOption[]; limitReached: boolean }>(`/api/movements/options?q=${encodeURIComponent(query)}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) { setOptions(result.items); setLimitReached(result.limitReached); setLoading(false); setError(""); } }).catch((failure) => { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : "Não foi possível carregar as reservas aprovadas."); setLoading(false); } });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, retry]);
  function choose(value: string) {
    setOptionId(value);
    const selected = options.find((entry) => entry.reservationId === value);
    setValues((current) => ({ ...current, quantity: 1, unitIds: [], expectedReturnAt: selected ? instantToInstitutionalInput(selected.endsAt) : "", checklist: emptyChecklist }));
    setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!option) { setError("Selecione uma reserva aprovada."); return; }
    if (!inPeriod) { setError("A retirada deve ocorrer dentro do intervalo aprovado. Solicite previamente a alteração e aprovação do período necessário."); return; }
    const quantity = option.trackingMode === "INDIVIDUAL" ? values.unitIds.length : values.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > option.remainingQuantity) { setError("Informe uma quantidade válida dentro do saldo aprovado."); return; }
    if (values.responsibleName.trim().length < 2 || values.destination.trim().length < 2) { setError("Informe o responsável pela retirada e o local de destino."); return; }
    if (!Object.values(values.checklist).every(Boolean)) { setError("Conclua todos os itens do checklist de conferência."); return; }
    let expectedReturnAt: string;
    try { expectedReturnAt = institutionalToInstant(values.expectedReturnAt); } catch { setError("Informe uma previsão de devolução válida no horário de Brasília."); return; }
    if (new Date(expectedReturnAt).getTime() <= now || new Date(expectedReturnAt).getTime() > new Date(option.endsAt).getTime()) { setError("A previsão deve ser futura e respeitar o término da reserva aprovada."); return; }
    setSaving(true);
    try {
      const input: WithdrawalInput = { ...values, reservationId: option.reservationId, quantity, responsibleName: values.responsibleName.trim(), destination: values.destination.trim(), notes: values.notes.trim(), expectedReturnAt };
      const movement = await authRequest<PhysicalMovement>("/api/movements", { method: "POST", body: JSON.stringify(input) });
      notify("Retirada registrada com sucesso. A disponibilidade física foi atualizada."); void refresh(); void refreshStock(); onSaved(movement);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível registrar a retirada."); }
    finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent className="sm:max-w-2xl" onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}><DialogHeader><DialogTitle>Registrar retirada</DialogTitle><DialogDescription>Selecione uma reserva aprovada em vigência e confira os equipamentos. Data e usuário do registro são definidos pelo servidor. Horários de Brasília.</DialogDescription></DialogHeader><form onSubmit={submit} noValidate className="space-y-5"><fieldset disabled={saving} className="space-y-4"><div><label htmlFor={`${id}-search`} className="mb-1.5 block text-xs font-medium text-slate-700">Buscar reserva por evento ou equipamento</label><Input id={`${id}-search`} value={query} onChange={(event) => { setQuery(event.target.value); setOptionId(""); setLoading(true); }} placeholder="Nome do evento ou equipamento..." /></div><div><label htmlFor={`${id}-reservation`} className="mb-1.5 block text-xs font-medium text-slate-700">Reserva aprovada</label><select id={`${id}-reservation`} value={optionId} onChange={(event) => choose(event.target.value)} disabled={loading} className="h-11 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm"><option value="">{loading ? "Carregando reservas…" : "Selecione uma reserva"}</option>{options.map((entry) => <option key={entry.reservationId} value={entry.reservationId}>{entry.equipmentName} · {entry.eventTitle} · {entry.remainingQuantity} restantes</option>)}</select>{!loading && !options.length && <p className="mt-2 text-xs leading-relaxed text-slate-500">Nenhuma reserva aprovada em vigência com saldo de retirada. Pedidos pendentes e reservas futuras não autorizam retiradas agora.</p>}{limitReached && <p className="mt-2 text-xs text-amber-700">Há mais reservas. Refine a busca para localizar a desejada.</p>}</div>{option && <><div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800"><p className="font-medium">{option.eventTitle}</p><p className="mt-1">Período aprovado: {formatDateTime(option.startsAt)} a {formatDateTime(option.endsAt)}.</p><p className="mt-1">{option.remainingQuantity} de {option.quantity} unidades ainda podem ser retiradas. Devolver não renova esse saldo.</p></div>{!inPeriod && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">Retirada indisponível fora do período aprovado. Para retirada antecipada, regularize e aprove o novo intervalo antes da operação.</p>}{option.trackingMode === "INDIVIDUAL" ? <fieldset className="space-y-2 rounded-lg border p-3"><legend className="px-1 text-xs font-medium">Patrimônios para retirada</legend>{option.units.map((unit) => <label key={unit.id} className="flex items-center gap-3 rounded p-2 text-sm"><input type="checkbox" disabled={!unit.available} checked={values.unitIds.includes(unit.id)} onChange={(event) => setValues((current) => ({ ...current, unitIds: event.target.checked ? [...current.unitIds, unit.id] : current.unitIds.filter((value) => value !== unit.id) }))} className="size-5 accent-blue-600" /><span>{unit.assetNumber}{!unit.available && <span className="ml-2 text-xs text-slate-500">Indisponível</span>}</span></label>)}</fieldset> : <div><label htmlFor={`${id}-quantity`} className="mb-1.5 block text-xs font-medium text-slate-700">Quantidade a retirar</label><Input id={`${id}-quantity`} type="number" min={1} max={option.remainingQuantity} value={values.quantity} onChange={(event) => setValues((current) => ({ ...current, quantity: Number(event.target.value) }))} /></div>}</>}
      <div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor={`${id}-responsible`} className="mb-1.5 block text-xs font-medium text-slate-700">Responsável pela retirada</label><Input id={`${id}-responsible`} value={values.responsibleName} maxLength={120} onChange={(event) => setValues((current) => ({ ...current, responsibleName: event.target.value }))} required /></div><div><label htmlFor={`${id}-destination`} className="mb-1.5 block text-xs font-medium text-slate-700">Local de destino</label><Input id={`${id}-destination`} value={values.destination} maxLength={160} onChange={(event) => setValues((current) => ({ ...current, destination: event.target.value }))} required /></div></div><div><label htmlFor={`${id}-due`} className="mb-1.5 block text-xs font-medium text-slate-700">Previsão de devolução (Brasília)</label><Input id={`${id}-due`} type="datetime-local" value={values.expectedReturnAt} onChange={(event) => setValues((current) => ({ ...current, expectedReturnAt: event.target.value }))} required /></div><div><label htmlFor={`${id}-notes`} className="mb-1.5 block text-xs font-medium text-slate-700">Observações da retirada</label><textarea id={`${id}-notes`} value={values.notes} maxLength={2000} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} className="min-h-20 w-full rounded-lg border border-input px-3 py-2 text-sm" /></div><MovementChecklistFields value={values.checklist} onChange={(checklist) => setValues((current) => ({ ...current, checklist }))} /></fieldset>{error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}{!options.length && !loading && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { setLoading(true); setRetry((current) => current + 1); }}>Tentar novamente</Button>}</p>}<DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Voltar</Button><Button type="submit" disabled={saving || loading || !option || !inPeriod}>{saving && <LoaderCircle className="animate-spin" />}{saving ? "Registrando…" : "Confirmar retirada"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
