"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEvents } from "@/components/providers/events-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EventsApiError, eventsRequest } from "@/lib/events-client";
import { formatEventRange, institutionalToInstant, instantToInstitutionalInput, todayInstitutional } from "@/lib/event-time";
import { DEPARTMENTS, eventKindLabels, eventStatusLabels, type CalendarEvent, type EventConflict, type EventInput, type EventMutation, type EventEquipmentOption } from "@/types/events";

const controlClass = "w-full rounded-lg border border-input bg-white px-3 py-2 text-sm text-slate-800 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
export const PRELIMINARY_NOTICE = "Necessidades preliminares: não reservam nem retiram equipamentos. Importe-as em uma solicitação e envie para análise.";
type FormValues = Omit<EventInput, "equipmentNeeds" | "version">;
type Need = { key: string; equipmentId: string; quantity: string; notes: string };

export function eventToInput(event: CalendarEvent): EventInput {
  return { title: event.title, description: event.description, department: event.department, responsibleName: event.responsibleName, contact: event.contact, location: event.location, kind: event.kind, status: event.status, startsAt: event.startsAt, endsAt: event.endsAt, version: event.version, equipmentNeeds: event.equipmentNeeds.map((need) => ({ equipmentId: need.equipmentId, quantity: need.quantity, notes: need.notes })) };
}

export function ConflictNotice({ conflicts }: { conflicts: EventConflict[] }) {
  if (!conflicts.length) return null;
  return <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 shrink-0" />Sobreposição de eventos no mesmo local</p><p className="mt-1 text-xs leading-relaxed">Há outros eventos não cancelados nesse local e horário. Confira a programação com os setores envolvidos. Este alerta é informativo e permite salvar.</p><ul className="mt-3 space-y-2">{conflicts.map((conflict) => <li key={conflict.id} className="text-xs"><span className="font-medium">{conflict.title}</span> · {conflict.department}<span className="mt-0.5 block">{formatEventRange(conflict.startsAt, conflict.endsAt)}</span></li>)}</ul></div>;
}

export function EventForm({ event, onSaved, onClose }: { event?: CalendarEvent; onSaved?: (event: CalendarEvent) => void; onClose?: () => void } = {}) {
  const [open, setOpen] = useState(!!event);
  function close() { setOpen(false); onClose?.(); }
  return <>{!event && <Button onClick={() => setOpen(true)}><Plus aria-hidden="true" />Novo evento</Button>}{open && <EventEditor event={event} onClose={close} onSaved={(saved) => { close(); onSaved?.(saved); }} />}</>;
}

function EventEditor({ event, onSaved, onClose }: { event?: CalendarEvent; onSaved: (event: CalendarEvent) => void; onClose: () => void }) {
  const id = useId();
  const { user, hasPermission } = useAuth();
  const { refresh, notify } = useEvents();
  const [values, setValues] = useState<FormValues>(() => event ? { ...eventToInput(event), startsAt: instantToInstitutionalInput(event.startsAt), endsAt: instantToInstitutionalInput(event.endsAt), reason: "" } : { title: "", description: "", department: (user?.department as EventInput["department"] | null) ?? "Multimeios", responsibleName: user?.name ?? "", contact: user?.email ?? "", location: "", kind: "INTERNAL", status: "PLANNED", startsAt: `${todayInstitutional()}T08:00`, endsAt: `${todayInstitutional()}T10:00` });
  const [needs, setNeeds] = useState<Need[]>(() => event?.equipmentNeeds.map((need) => ({ key: need.id, equipmentId: need.equipmentId, quantity: String(need.quantity), notes: need.notes })) ?? []);
  const [options, setOptions] = useState<EventEquipmentOption[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<EventEquipmentOption[]>([]);
  const [optionsLimitReached, setOptionsLimitReached] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<EventConflict[]>([]);
  const [conflictError, setConflictError] = useState("");
  const [optionsRetry, setOptionsRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      eventsRequest<{ items: EventEquipmentOption[]; limitReached: boolean }>(`/api/events/equipment-options?${new URLSearchParams({ q: equipmentSearch })}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) { setOptions(result.items); setOptionsLimitReached(result.limitReached); setOptionsError(""); } }).catch((failure) => { if (!controller.signal.aborted) setOptionsError(failure.message); }).finally(() => { if (!controller.signal.aborted) setOptionsLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [optionsRetry, equipmentSearch]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      let startsAt: string, endsAt: string;
      try { startsAt = institutionalToInstant(values.startsAt); endsAt = institutionalToInstant(values.endsAt); } catch { setConflicts([]); setConflictError(""); return; }
      if (!values.location.trim() || startsAt >= endsAt || values.status === "CANCELLED") { setConflicts([]); setConflictError(""); return; }
      const query = new URLSearchParams({ location: values.location.trim(), startsAt, endsAt, ...(event ? { excludeId: event.id } : {}) });
      eventsRequest<{ items: EventConflict[] }>(`/api/events/conflicts?${query}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) { setConflicts(result.items); setConflictError(""); } }).catch((failure) => { if (!controller.signal.aborted) { setConflicts([]); setConflictError(failure.message); } });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [values.location, values.startsAt, values.endsAt, values.status, event]);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) { setValues((current) => ({ ...current, [key]: value })); }
  function updateNeed(key: string, patch: Partial<Need>) {
    const selected = options.find((option) => option.id === patch.equipmentId);
    if (selected) setSelectedOptions((current) => [...current.filter((option) => option.id !== selected.id), selected]);
    setNeeds((current) => current.map((need) => need.key === key ? { ...need, ...patch } : need));
  }
  function accessibility(key: string) { return { id: `${id}-${key}`, name: key, "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined }; }
  function field(key: string, label: string, content: ReactNode) { return <div><label htmlFor={`${id}-${key}`} className="mb-1.5 block text-xs font-medium text-slate-700">{label}</label>{content}{errors[key] && <p id={`${id}-${key}-error`} className="mt-1 text-xs text-rose-700">{errors[key]}</p>}</div>; }

  async function submit(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault();
    const next: Record<string, string> = {};
    if (values.title.trim().length < 3) next.title = "Informe um título com pelo menos 3 caracteres.";
    if (values.description.trim().length < 3) next.description = "Descreva o evento com pelo menos 3 caracteres.";
    if (values.responsibleName.trim().length < 2) next.responsibleName = "Informe o nome do responsável declarado.";
    const contact = values.contact.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) && (!/^[+()\d\s.-]+$/.test(contact) || contact.replace(/\D/g, "").length < 8 || contact.replace(/\D/g, "").length > 15)) next.contact = "Informe um e-mail ou telefone válido, com 8 a 15 dígitos.";
    if (values.location.trim().length < 2) next.location = "Informe o local do evento.";
    let startsAt = "", endsAt = "";
    try { startsAt = institutionalToInstant(values.startsAt); } catch { next.startsAt = "Informe a data e o horário de início."; }
    try { endsAt = institutionalToInstant(values.endsAt); } catch { next.endsAt = "Informe a data e o horário de término."; }
    if (startsAt && endsAt && endsAt <= startsAt) next.endsAt = "O horário de término deve ser posterior ao início.";
    if (event && (values.reason?.trim().length ?? 0) < 3) next.reason = "Informe o motivo da alteração com pelo menos 3 caracteres.";
    const seen = new Set<string>();
    needs.forEach((need, index) => {
      if (!need.equipmentId) next[`equipmentNeeds.${index}.equipmentId`] = "Selecione um equipamento real do estoque.";
      else if (seen.has(need.equipmentId)) next[`equipmentNeeds.${index}.equipmentId`] = "Este equipamento já está na solicitação.";
      seen.add(need.equipmentId);
      if (!Number.isSafeInteger(Number(need.quantity)) || Number(need.quantity) < 1 || Number(need.quantity) > 1_000_000) next[`equipmentNeeds.${index}.quantity`] = "Informe uma quantidade inteira entre 1 e 1.000.000.";
    });
    setErrors(next); setError("");
    if (Object.keys(next).length) { setError("Revise os campos indicados antes de salvar."); return; }
    const input: EventInput = { ...values, title: values.title.trim(), description: values.description.trim(), responsibleName: values.responsibleName.trim(), contact, location: values.location.trim(), startsAt, endsAt, equipmentNeeds: needs.map((need) => ({ equipmentId: need.equipmentId, quantity: Number(need.quantity), notes: need.notes.trim() })), ...(event ? { version: event.version, reason: values.reason?.trim() } : {}) };
    setSaving(true);
    try {
      const result = await eventsRequest<EventMutation>(event ? `/api/events/${encodeURIComponent(event.id)}` : "/api/events", { method: event ? "PATCH" : "POST", body: JSON.stringify(input) });
      notify(`${event ? "Evento atualizado" : "Evento cadastrado"} com sucesso.${result.conflicts.length ? " Há sobreposição no local; confira os detalhes do evento." : ""}`);
      void refresh(); onSaved(result.event);
    } catch (failure) {
      if (failure instanceof EventsApiError) { setErrors(failure.fieldErrors); setError(failure.message); }
      else setError("Não foi possível salvar o evento. Tente novamente.");
    } finally { setSaving(false); }
  }

  const missingOptions: EventEquipmentOption[] = event?.equipmentNeeds.filter((need) => !options.some((option) => option.id === need.equipmentId)).map((need) => ({ id: need.equipmentId, name: need.equipmentName, category: need.equipmentCategory, archivedAt: need.equipmentArchived ? "archived" : null, total: 0, available: 0 })) ?? [];
  const allOptions = [...new Map([...selectedOptions, ...missingOptions, ...options].map((option) => [option.id, option])).values()];

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent className="sm:max-w-3xl" onEscapeKeyDown={(e) => { if (saving) e.preventDefault(); }} onPointerDownOutside={(e) => { if (saving) e.preventDefault(); }}><DialogHeader><DialogTitle>{event ? "Editar evento" : "Novo evento"}</DialogTitle><DialogDescription>Organize a agenda compartilhada de Multimeios, Marketing e Projeto de Extensão.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-5" noValidate><fieldset disabled={saving} className="space-y-5">
      {field("title", "Título do evento", <Input {...accessibility("title")} value={values.title} onChange={(e) => update("title", e.target.value)} maxLength={160} placeholder="Ex.: Encontro de projetos de extensão" required />)}
      {field("description", "Descrição", <textarea {...accessibility("description")} className={`${controlClass} min-h-20 resize-y`} value={values.description} onChange={(e) => update("description", e.target.value)} maxLength={4000} rows={3} required />)}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("department", "Setor organizador", <select {...accessibility("department")} disabled={user?.role !== "ADMIN" && (!event || !hasPermission("EVENT_MANAGE_ALL"))} className={controlClass} value={values.department} onChange={(e) => update("department", e.target.value as EventInput["department"])}>{DEPARTMENTS.map((value) => <option key={value} value={value}>{value}</option>)}</select>)}
        {field("responsibleName", "Responsável declarado", <Input {...accessibility("responsibleName")} value={values.responsibleName} onChange={(e) => update("responsibleName", e.target.value)} maxLength={120} required />)}
        {field("contact", "Contato (e-mail ou telefone)", <Input {...accessibility("contact")} value={values.contact} onChange={(e) => update("contact", e.target.value)} maxLength={160} placeholder="nome@unisalesiano.com.br" required />)}
        {field("location", "Local", <Input {...accessibility("location")} value={values.location} onChange={(e) => update("location", e.target.value)} maxLength={160} placeholder="Ex.: Auditório Central" required />)}
        {field("kind", "Tipo de evento", <select {...accessibility("kind")} className={controlClass} value={values.kind} onChange={(e) => update("kind", e.target.value as EventInput["kind"])}>{Object.entries(eventKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>)}
        {field("status", "Status", <select {...accessibility("status")} className={controlClass} value={values.status} onChange={(e) => update("status", e.target.value as EventInput["status"])}>{Object.entries(eventStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>)}
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="mb-3 text-xs font-medium text-slate-600">Horários de Brasília · America/Sao_Paulo</p><div className="grid gap-4 sm:grid-cols-2">{field("startsAt", "Início", <Input {...accessibility("startsAt")} type="datetime-local" value={values.startsAt} onChange={(e) => update("startsAt", e.target.value)} required />)}{field("endsAt", "Término", <Input {...accessibility("endsAt")} type="datetime-local" value={values.endsAt} onChange={(e) => update("endsAt", e.target.value)} required />)}</div></div>
      <ConflictNotice conflicts={conflicts} />{conflictError && <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Não foi possível verificar sobreposições agora. A conferência será repetida ao salvar. {conflictError}</p>}
      <section aria-label="Necessidades de equipamentos" className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-800">Necessidades de equipamentos</h3><Button type="button" variant="outline" size="sm" disabled={optionsLoading || !!optionsError || !options.length || needs.length >= 100} onClick={() => setNeeds((current) => [...current, { key: crypto.randomUUID(), equipmentId: "", quantity: "1", notes: "" }])}><Plus />Adicionar equipamento</Button></div><p className="mt-2 rounded-lg bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">{PRELIMINARY_NOTICE}</p>
        <Input className="mt-4" aria-label="Buscar equipamento para solicitação" placeholder="Buscar equipamento pelo nome ou categoria" value={equipmentSearch} onChange={(e) => { setEquipmentSearch(e.target.value); setOptionsLoading(true); }} />
        {optionsLimitReached && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">O estoque atingiu o limite de 2.000 opções nesta consulta. Busque pelo nome ou categoria para encontrar outros equipamentos.</p>}
        {optionsLoading && <p role="status" className="mt-3 text-xs text-slate-500">Consultando estoque…</p>}{optionsError && <div role="alert" className="mt-3 text-xs text-rose-700"><p>{optionsError}</p><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { setOptionsLoading(true); setOptionsRetry((current) => current + 1); }}>Tentar novamente</Button></div>}{!optionsLoading && !optionsError && !options.length && <p className="mt-3 text-xs text-slate-500">{equipmentSearch ? "Nenhum equipamento encontrado para esta busca." : "Nenhum equipamento ativo cadastrado no estoque. O evento pode ser salvo sem necessidades."}</p>}
        {needs.length > 0 && <div className="mt-4 space-y-4">{needs.map((need, index) => {
          const selectedOption = allOptions.find((option) => option.id === need.equipmentId);
          const filteredOptions = allOptions.filter((option) => option.id === need.equipmentId || (!option.archivedAt && options.some((result) => result.id === option.id)));
          return <div key={need.key} className="rounded-lg bg-slate-50 p-3"><div className="grid items-start gap-3 sm:grid-cols-[1fr_100px_auto]">{field(`equipmentNeeds.${index}.equipmentId`, `Equipamento ${index + 1}`, <select {...accessibility(`equipmentNeeds.${index}.equipmentId`)} className={controlClass} value={need.equipmentId} onChange={(e) => updateNeed(need.key, { equipmentId: e.target.value })}><option value="">Selecione um equipamento</option>{filteredOptions.map((option) => <option key={option.id} value={option.id} disabled={!!option.archivedAt}>{option.name} · {option.category}{option.archivedAt ? " (arquivado)" : ""}</option>)}</select>)}{field(`equipmentNeeds.${index}.quantity`, `Quantidade ${index + 1}`, <Input {...accessibility(`equipmentNeeds.${index}.quantity`)} type="number" min={1} max={1_000_000} step={1} value={need.quantity} onChange={(e) => updateNeed(need.key, { quantity: e.target.value })} required />)}<Button type="button" variant="ghost" size="icon" className="text-slate-500 sm:mt-6" aria-label={`Remover equipamento ${index + 1}`} onClick={() => setNeeds((current) => current.filter((item) => item.key !== need.key))}><Trash2 /></Button></div><div className="mt-3">{field(`equipmentNeeds.${index}.notes`, `Observações ${index + 1}`, <Input {...accessibility(`equipmentNeeds.${index}.notes`)} value={need.notes} maxLength={1000} onChange={(e) => updateNeed(need.key, { notes: e.target.value })} placeholder="Ex.: Cabos e suporte necessários" />)}</div>{selectedOption?.archivedAt && <p className="mt-2 text-xs text-amber-800">Equipamento arquivado. O vínculo anterior pode ser mantido para preservar o registro.</p>}</div>;
        })}</div>}{errors.equipmentNeeds && <p className="mt-2 text-xs text-rose-700">{errors.equipmentNeeds}</p>}
      </section>
      <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">O responsável informado é o contato operacional do evento. A autoria e as alterações são registradas com sua conta autenticada.</p>
      {event && field("reason", "Motivo da alteração", <textarea {...accessibility("reason")} className={`${controlClass} min-h-20 resize-y`} value={values.reason ?? ""} onChange={(e) => update("reason", e.target.value)} maxLength={500} required />)}
    </fieldset>{error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<DialogFooter className="border-t border-slate-100 pt-5"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving && <LoaderCircle className="animate-spin" />}{saving ? "Salvando…" : event ? "Salvar alterações" : "Criar evento"}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
