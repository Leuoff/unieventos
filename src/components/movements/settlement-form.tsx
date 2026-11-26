"use client";

import { useId, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { authRequest } from "@/lib/auth-client";
import { instantToInstitutionalInput, institutionalToInstant } from "@/lib/event-time";
import { useMovements } from "@/components/providers/movements-provider";
import { useInventory } from "@/components/providers/inventory-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { emptyChecklist, MovementChecklistFields } from "./movement-controls";
import type { PhysicalMovement, SettlementCondition, SettlementInput } from "@/types/movements";

export function SettlementForm({ movement, onClose, onSaved }: { movement: PhysicalMovement; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const { refresh, notify } = useMovements();
  const { refresh: refreshStock } = useInventory();
  const [counts, setCounts] = useState({ goodQuantity: 0, damagedQuantity: 0, lostQuantity: 0 });
  const [units, setUnits] = useState<Record<string, SettlementCondition | "">>({});
  const [notes, setNotes] = useState("");
  const [checklist, setChecklist] = useState(emptyChecklist);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pendingUnits = movement.units.filter((unit) => unit.condition === "IN_USE");
  const selected = Object.entries(units).filter((entry): entry is [string, SettlementCondition] => !!entry[1]);
  const effectiveCounts = movement.trackingMode === "INDIVIDUAL" ? { goodQuantity: selected.filter(([, condition]) => condition === "GOOD").length, damagedQuantity: selected.filter(([, condition]) => condition === "DAMAGED").length, lostQuantity: selected.filter(([, condition]) => condition === "LOST").length } : counts;
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    const quantity = Object.values(effectiveCounts).reduce((sum, value) => sum + value, 0);
    if (Object.values(effectiveCounts).some((value) => !Number.isInteger(value) || value < 0) || quantity < 1 || quantity > movement.pendingQuantity) { setError("Confira as quantidades. A regularização deve respeitar o saldo ainda pendente."); return; }
    if ((effectiveCounts.damagedQuantity > 0 || effectiveCounts.lostQuantity > 0) && notes.trim().length < 3) { setError("Descreva a avaria ou o extravio nas observações."); return; }
    if (!Object.values(checklist).every(Boolean)) { setError("Conclua todos os itens do checklist de conferência."); return; }
    setSaving(true);
    try {
      const input: SettlementInput = { version: movement.version, ...effectiveCounts, units: selected.map(([unitId, condition]) => ({ unitId, condition })), notes: notes.trim(), checklist };
      await authRequest(`/api/movements/${movement.id}/settlements`, { method: "POST", body: JSON.stringify(input) });
      notify("Conferência registrada. Avarias seguem para manutenção e extravios permanecem indisponíveis."); void refresh(); void refreshStock(); onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível registrar a conferência."); }
    finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent className="sm:max-w-2xl" onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}><DialogHeader><DialogTitle>Registrar devolução ou ocorrência</DialogTitle><DialogDescription>{movement.equipmentName}: {movement.pendingQuantity} unidades pendentes. Uma devolução com avaria vai para manutenção. Extravio registra ocorrência e não representa devolução física.</DialogDescription></DialogHeader><form noValidate onSubmit={submit} className="space-y-5"><fieldset disabled={saving} className="space-y-4">{movement.trackingMode === "INDIVIDUAL" ? <div className="space-y-3">{pendingUnits.map((unit) => <div key={unit.id} className="rounded-lg border border-slate-200 p-3"><label htmlFor={`${id}-${unit.id}`} className="mb-2 block text-sm font-medium">Patrimônio {unit.assetNumber}</label><select id={`${id}-${unit.id}`} value={units[unit.id] ?? ""} onChange={(event) => setUnits((current) => ({ ...current, [unit.id]: event.target.value as SettlementCondition | "" }))} className="h-11 w-full rounded-lg border border-input bg-white px-3 text-sm"><option value="">Manter pendente</option><option value="GOOD">Devolvido em boas condições</option><option value="DAMAGED">Devolvido com avaria — manutenção</option><option value="LOST">Extravio — sem devolução física</option></select></div>)}</div> : <div className="grid gap-4 sm:grid-cols-3">{([{ key: "goodQuantity", label: "Em boas condições" }, { key: "damagedQuantity", label: "Com avaria" }, { key: "lostQuantity", label: "Extraviadas" }] as const).map(({ key, label }) => <div key={key}><label htmlFor={`${id}-${key}`} className="mb-1.5 block text-xs font-medium text-slate-700">{label}</label><Input id={`${id}-${key}`} type="number" min={0} max={movement.pendingQuantity} value={counts[key]} onChange={(event) => setCounts((current) => ({ ...current, [key]: Number(event.target.value) }))} /></div>)}</div>}<p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">Conferir apenas os itens recebidos ou cuja ocorrência foi apurada. Os demais permanecem em uso. O usuário autenticado e o horário efetivo serão registrados automaticamente.</p><div><label htmlFor={`${id}-notes`} className="mb-1.5 block text-xs font-medium text-slate-700">Observações da conferência e ocorrências</label><textarea id={`${id}-notes`} value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} className="min-h-24 w-full rounded-lg border border-input px-3 py-2 text-sm" /></div><MovementChecklistFields value={checklist} onChange={setChecklist} /></fieldset>{error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Voltar</Button><Button type="submit" disabled={saving}>{saving && <LoaderCircle className="animate-spin" />}{saving ? "Registrando…" : "Confirmar conferência"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

export function ExtensionForm({ movement, onClose, onSaved }: { movement: PhysicalMovement; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const { refresh, notify } = useMovements();
  const [date, setDate] = useState(movement.expectedReturnAt ? instantToInstitutionalInput(movement.expectedReturnAt) : "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    let expectedReturnAt: string;
    try { expectedReturnAt = institutionalToInstant(date); } catch { setError("Informe um horário de Brasília válido."); return; }
    if (new Date(expectedReturnAt).getTime() <= Math.max(Date.now(), new Date(movement.expectedReturnAt ?? movement.createdAt).getTime())) { setError("O novo prazo deve ser posterior ao prazo atual e ao momento presente."); return; }
    if (reason.trim().length < 3) { setError("Informe a justificativa para a extensão de utilização."); return; }
    setSaving(true);
    try { await authRequest(`/api/movements/${movement.id}/extend`, { method: "POST", body: JSON.stringify({ version: movement.version, expectedReturnAt, reason: reason.trim() }) }); notify("Prazo de utilização estendido após verificação de conflitos."); void refresh(); onSaved(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível estender o prazo."); }
    finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Estender utilização</DialogTitle><DialogDescription>Exige permissão de movimentação e análise de reservas. O servidor confere reservas futuras. O período original da reserva permanece no histórico.</DialogDescription></DialogHeader><form onSubmit={submit} noValidate className="space-y-5"><div><label htmlFor={`${id}-date`} className="mb-1.5 block text-xs font-medium text-slate-700">Novo prazo de devolução (Brasília)</label><Input id={`${id}-date`} type="datetime-local" value={date} disabled={saving} onChange={(event) => setDate(event.target.value)} /></div><div><label htmlFor={`${id}-reason`} className="mb-1.5 block text-xs font-medium text-slate-700">Justificativa da extensão</label><textarea id={`${id}-reason`} value={reason} disabled={saving} maxLength={1000} onChange={(event) => setReason(event.target.value)} className="min-h-24 w-full rounded-lg border border-input px-3 py-2 text-sm" /></div>{error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Voltar</Button><Button type="submit" disabled={saving}>{saving && <LoaderCircle className="animate-spin" />}Confirmar extensão</Button></DialogFooter></form></DialogContent></Dialog>;
}
