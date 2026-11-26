"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Download, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useRequests } from "@/components/providers/requests-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { AvailabilityNotice } from "@/components/requests/availability-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { institutionalToInstant, instantToInstitutionalInput, todayInstitutional } from "@/lib/event-time";
import { RequestsApiError, requestsRequest } from "@/lib/requests-client";
import type { CalendarEvent, EventEquipmentOption } from "@/types/events";
import type { AvailabilityItem, EquipmentRequest, RequestInput } from "@/types/requests";

const controlClass = "w-full min-w-0 rounded-lg border border-input bg-white px-3 py-2 text-sm text-slate-800 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
type Item = { key: string; equipmentId: string; quantity: string; notes: string };

export function RequestForm({ request, eventId = "", onSaved, onClose }: { request?: EquipmentRequest; eventId?: string; onSaved?: (saved: EquipmentRequest) => void; onClose?: () => void }) {
  const [open, setOpen] = useState(!!request);
  function close() { setOpen(false); onClose?.(); }
  return <>{!request && <Button onClick={() => setOpen(true)}><Plus />Nova solicitação</Button>}{open && <RequestEditor request={request} eventId={eventId} onClose={close} onSaved={(saved) => { close(); onSaved?.(saved); }} />}</>;
}

function RequestEditor({ request, eventId, onSaved, onClose }: { request?: EquipmentRequest; eventId: string; onSaved: (saved: EquipmentRequest) => void; onClose: () => void }) {
  const id = useId();
  const { user, hasPermission } = useAuth();
  const canManageOtherEvents = hasPermission("REQUEST_MANAGE_ALL") || hasPermission("EVENT_MANAGE_ALL");
  const { refresh, notify } = useRequests();
  const [selectedEventId, setSelectedEventId] = useState(request?.eventId ?? eventId);
  const [responsibleName, setResponsibleName] = useState(request?.responsibleName ?? user?.name ?? "");
  const [startsAt, setStartsAt] = useState(request ? instantToInstitutionalInput(request.startsAt) : `${todayInstitutional()}T08:00`);
  const [endsAt, setEndsAt] = useState(request ? instantToInstitutionalInput(request.endsAt) : `${todayInstitutional()}T10:00`);
  const [notes, setNotes] = useState(request?.notes ?? "");
  const [items, setItems] = useState<Item[]>(request?.items.map((item) => ({ key: item.id, equipmentId: item.equipmentId, quantity: String(item.quantity), notes: item.notes })) ?? []);
  const [eventOptions, setEventOptions] = useState<CalendarEvent[]>([]);
  const [chosenEvent, setChosenEvent] = useState<CalendarEvent | null>(null);
  const [equipmentOptions, setEquipmentOptions] = useState<EventEquipmentOption[]>([]);
  const [chosenEquipment, setChosenEquipment] = useState<EventEquipmentOption[]>([]);
  const [eventQuery, setEventQuery] = useState("");
  const [equipmentQuery, setEquipmentQuery] = useState("");
  const [lookup, setLookup] = useState<{ key: string; loading: boolean; error: string }>({ key: "", loading: true, error: "" });
  const [eventLimit, setEventLimit] = useState(false);
  const [equipmentLimit, setEquipmentLimit] = useState(false);
  const [lookupRevision, setLookupRevision] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityItem[]>([]);
  const [availabilityError, setAvailabilityError] = useState("");
  const lookupKey = `${eventQuery}:${equipmentQuery}:${lookupRevision}`;
  const lookupLoading = lookup.key !== lookupKey || lookup.loading;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const [events, equipment] = await Promise.all([
          requestsRequest<{ items: CalendarEvent[]; limitReached: boolean }>(`/api/events/calendar?${new URLSearchParams({ q: eventQuery })}`, { signal: controller.signal }),
          requestsRequest<{ items: EventEquipmentOption[]; limitReached: boolean }>(`/api/events/equipment-options?${new URLSearchParams({ q: equipmentQuery })}`, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setEventOptions(events.items.filter((event) => !event.archivedAt && event.status !== "CANCELLED" && event.status !== "COMPLETED" && (canManageOtherEvents || event.createdByUserId === user?.id)));
        setEventLimit(events.limitReached); setEquipmentOptions(equipment.items); setEquipmentLimit(equipment.limitReached);
        setLookup({ key: lookupKey, loading: false, error: "" });
      } catch (failure) {
        if (!controller.signal.aborted) setLookup({ key: lookupKey, loading: false, error: failure instanceof Error ? failure.message : "Não foi possível consultar os eventos e o estoque." });
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [eventQuery, equipmentQuery, lookupKey, user?.id, canManageOtherEvents]);

  useEffect(() => {
    if (!selectedEventId) return;
    const controller = new AbortController();
    requestsRequest<{ event: CalendarEvent }>(`/api/events/${encodeURIComponent(selectedEventId)}`, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setChosenEvent(result.event);
        if (!request) {
          setStartsAt(instantToInstitutionalInput(result.event.startsAt));
          setEndsAt(instantToInstitutionalInput(result.event.endsAt));
          setResponsibleName(result.event.responsibleName);
        }
      }
    }).catch(() => { /* The server validates unavailable or invalid event links on save. */ });
    return () => controller.abort();
  }, [selectedEventId, request]);

  function accessibility(key: string) { return { id: `${id}-${key}`, name: key, "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined }; }
  function field(key: string, label: string, content: ReactNode) { return <div className="min-w-0"><label htmlFor={`${id}-${key}`} className="mb-1.5 block text-xs font-medium text-slate-700">{label}</label>{content}{errors[key] && <p id={`${id}-${key}-error`} className="mt-1 text-xs text-rose-700">{errors[key]}</p>}</div>; }
  function invalidateAvailability() { setAvailability([]); setAvailabilityError(""); }
  function updateItem(key: string, patch: Partial<Item>) {
    const selected = equipmentOptions.find((option) => option.id === patch.equipmentId);
    if (selected) setChosenEquipment((current) => [...current.filter((option) => option.id !== selected.id), selected]);
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item)); invalidateAvailability();
  }
  function selectEvent(value: string) {
    setSelectedEventId(value); setChosenEvent(null);
    const selected = eventOptions.find((event) => event.id === value);
    if (selected) {
      setChosenEvent(selected);
      if (!request) { setStartsAt(instantToInstitutionalInput(selected.startsAt)); setEndsAt(instantToInstitutionalInput(selected.endsAt)); setResponsibleName(selected.responsibleName); }
    }
    invalidateAvailability();
  }
  function input(): RequestInput | null {
    const next: Record<string, string> = {};
    if (!selectedEventId) next.eventId = "Selecione um evento real da agenda.";
    const linkedEvent = eventOptions.find((event) => event.id === selectedEventId) ?? chosenEvent;
    if (linkedEvent && !canManageOtherEvents && linkedEvent.createdByUserId !== user?.id) next.eventId = "Você só pode criar pedidos para eventos de sua autoria. Selecione um de seus eventos.";
    if (responsibleName.trim().length < 2) next.responsibleName = "Informe o nome do responsável declarado.";
    let start = "", end = "";
    try { start = institutionalToInstant(startsAt); } catch { next.startsAt = "Informe a data e o horário de início."; }
    try { end = institutionalToInstant(endsAt); } catch { next.endsAt = "Informe a data e o horário de término."; }
    if (start && end && end <= start) next.endsAt = "O término deve ser posterior ao início.";
    if (!items.length) next.items = "Adicione pelo menos um equipamento real do estoque.";
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (!item.equipmentId) next[`items.${index}.equipmentId`] = "Selecione um equipamento do estoque.";
      else if (seen.has(item.equipmentId)) next[`items.${index}.equipmentId`] = "Este equipamento já está na solicitação.";
      seen.add(item.equipmentId);
      const quantity = Number(item.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) next[`items.${index}.quantity`] = "Informe uma quantidade inteira entre 1 e 1.000.000.";
    });
    setErrors(next);
    if (Object.keys(next).length) { setError("Revise os campos indicados antes de continuar."); return null; }
    setError("");
    return { eventId: selectedEventId, responsibleName: responsibleName.trim(), startsAt: start, endsAt: end, notes: notes.trim(), items: items.map((item) => ({ equipmentId: item.equipmentId, quantity: Number(item.quantity), notes: item.notes.trim() })), ...(request ? { version: request.version } : {}) };
  }
  async function checkAvailability() {
    const values = input(); if (!values) return;
    setChecking(true); setAvailabilityError("");
    try { const result = await requestsRequest<{ items: AvailabilityItem[] }>("/api/requests/availability", { method: "POST", body: JSON.stringify({ startsAt: values.startsAt, endsAt: values.endsAt, items: values.items.map(({ equipmentId, quantity }) => ({ equipmentId, quantity })) }) }); setAvailability(result.items); }
    catch (failure) { setAvailability([]); setAvailabilityError(failure instanceof Error ? failure.message : "Não foi possível consultar a disponibilidade."); }
    finally { setChecking(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = input(); if (!values) return;
    setSaving(true);
    try {
      const saved = await requestsRequest<EquipmentRequest>(request ? `/api/requests/${request.id}` : "/api/requests", { method: request ? "PATCH" : "POST", body: JSON.stringify(values) });
      notify(request ? "Rascunho atualizado. Nenhuma reserva foi criada." : "Rascunho criado. Nenhuma reserva foi criada.");
      void refresh(); onSaved(saved);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível salvar a solicitação."); if (failure instanceof RequestsApiError) setErrors(failure.fieldErrors); }
    finally { setSaving(false); }
  }
  async function importNeeds() {
    if (!selectedEventId) { setErrors({ eventId: "Selecione um evento para importar as necessidades." }); return; }
    setSaving(true); setError("");
    try {
      const saved = await requestsRequest<EquipmentRequest>("/api/requests/import-needs", { method: "POST", body: JSON.stringify({ eventId: selectedEventId }) });
      notify("Necessidades vinculadas a um rascunho, sem criar reservas. Importações repetidas reutilizam a mesma solicitação."); void refresh(); onSaved(saved);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível importar as necessidades."); }
    finally { setSaving(false); }
  }

  const allEvents = [...eventOptions, ...(chosenEvent && !eventOptions.some((option) => option.id === chosenEvent.id) ? [chosenEvent] : [])];
  const selectedEvent = allEvents.find((event) => event.id === selectedEventId);
  const allEquipment = [...equipmentOptions, ...chosenEquipment.filter((option) => !equipmentOptions.some((candidate) => candidate.id === option.id)), ...(request?.items.filter((item) => !equipmentOptions.some((option) => option.id === item.equipmentId) && !chosenEquipment.some((option) => option.id === item.equipmentId)).map((item) => ({ id: item.equipmentId, name: item.equipmentName, category: "Vínculo existente", archivedAt: null, total: 0, available: 0 })) ?? [])];

  return <Dialog open onOpenChange={(open) => { if (!open && !saving && !checking) onClose(); }}><DialogContent className="sm:max-w-3xl" onEscapeKeyDown={(event) => { if (saving || checking) event.preventDefault(); }} onPointerDownOutside={(event) => { if (saving || checking) event.preventDefault(); }}><DialogHeader><DialogTitle>{request ? "Editar rascunho" : "Nova solicitação"}</DialogTitle><DialogDescription>Vincule equipamentos reais a um evento. Salvar um rascunho ou enviar para análise não reserva nem retira recursos.</DialogDescription></DialogHeader><form noValidate onSubmit={submit} className="space-y-5"><fieldset disabled={saving || checking} className="min-w-0 space-y-5">
    <div className="rounded-xl border border-slate-200 p-4"><h3 className="mb-3 text-sm font-semibold text-slate-800">Evento vinculado</h3><Input aria-label="Buscar evento para solicitação" placeholder="Buscar evento por título, local ou responsável" value={eventQuery} onChange={(event) => setEventQuery(event.target.value)} className="mb-3" />{field("eventId", "Evento", <select {...accessibility("eventId")} className={controlClass} value={selectedEventId} onChange={(event) => selectEvent(event.target.value)} disabled={!!request}><option value="">Selecione um evento da agenda</option>{allEvents.map((event) => <option key={event.id} value={event.id}>{event.title} · {event.department}</option>)}{selectedEventId && !allEvents.some((event) => event.id === selectedEventId) && <option value={selectedEventId}>{request?.eventTitle ?? "Consultando evento selecionado…"}</option>}</select>)}{selectedEvent && <p className="mt-2 text-xs text-slate-500">Setor organizador: {selectedEvent.department} · {selectedEvent.location}</p>}{!request && <div className="mt-3 rounded-lg bg-blue-50 p-3"><p className="text-xs leading-relaxed text-blue-800">Reaproveite as necessidades preliminares do evento em um rascunho persistido. A importação preserva os vínculos e reutiliza a solicitação já importada, sem duplicar registros ou criar reservas.</p><Button type="button" variant="outline" size="sm" className="mt-3" disabled={!selectedEvent || !selectedEvent.equipmentNeeds.length} onClick={() => void importNeeds()}><Download />Importar necessidades do evento</Button>{selectedEvent && !selectedEvent.equipmentNeeds.length && <p className="mt-2 text-xs text-slate-500">Este evento não possui necessidades preliminares.</p>}</div>}</div>
    {lookupLoading && <p role="status" className="text-xs text-slate-500">Consultando eventos e equipamentos…</p>}{lookup.error && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700"><p>{lookup.error}</p><Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setLookupRevision((value) => value + 1)}>Tentar novamente</Button></div>}{(eventLimit || equipmentLimit) && <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">A consulta atingiu o limite de 2.000 registros. Refine a busca para encontrar outros eventos ou equipamentos.</p>}{!lookupLoading && !lookup.error && !eventOptions.length && !chosenEvent && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Nenhum evento elegível encontrado. Cadastre um evento ativo na agenda ou refine a busca.</p>}
    {field("responsibleName", "Responsável declarado", <Input {...accessibility("responsibleName")} value={responsibleName} maxLength={120} onChange={(event) => setResponsibleName(event.target.value)} required />)}
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="mb-3 text-xs font-medium text-slate-600">Período necessário · Horário de Brasília · America/Sao_Paulo</p><div className="grid gap-4 sm:grid-cols-2">{field("startsAt", "Início necessário", <Input {...accessibility("startsAt")} type="datetime-local" value={startsAt} onChange={(event) => { setStartsAt(event.target.value); invalidateAvailability(); }} required />)}{field("endsAt", "Término necessário", <Input {...accessibility("endsAt")} type="datetime-local" value={endsAt} onChange={(event) => { setEndsAt(event.target.value); invalidateAvailability(); }} required />)}</div></div>
    <section aria-label="Equipamentos da solicitação" className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-800">Equipamentos solicitados</h3><Button type="button" variant="outline" size="sm" disabled={lookupLoading || !!lookup.error || !equipmentOptions.length || items.length >= 100} onClick={() => { setItems((current) => [...current, { key: crypto.randomUUID(), equipmentId: "", quantity: "1", notes: "" }]); invalidateAvailability(); }}><Plus />Adicionar equipamento</Button></div><Input className="mt-3" aria-label="Buscar equipamento para solicitação" placeholder="Buscar equipamento pelo nome ou categoria" value={equipmentQuery} onChange={(event) => setEquipmentQuery(event.target.value)} />{!lookupLoading && !lookup.error && !equipmentOptions.length && <p className="mt-3 text-xs text-slate-500">Nenhum equipamento ativo encontrado. Verifique o estoque ou refine a busca.</p>}<div className="mt-4 space-y-3">{items.map((item, index) => <div key={item.key} className="rounded-lg bg-slate-50 p-3"><div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_110px_auto]">{field(`items.${index}.equipmentId`, `Equipamento ${index + 1}`, <select {...accessibility(`items.${index}.equipmentId`)} className={controlClass} value={item.equipmentId} onChange={(event) => updateItem(item.key, { equipmentId: event.target.value })}><option value="">Selecione um equipamento</option>{allEquipment.filter((option) => option.id === item.equipmentId || equipmentOptions.some((candidate) => candidate.id === option.id)).map((option) => <option key={option.id} value={option.id}>{option.name} · {option.category}</option>)}</select>)}{field(`items.${index}.quantity`, `Quantidade ${index + 1}`, <Input {...accessibility(`items.${index}.quantity`)} type="number" min={1} max={1_000_000} step={1} value={item.quantity} onChange={(event) => updateItem(item.key, { quantity: event.target.value })} required />)}<Button type="button" variant="ghost" size="icon" className="text-slate-500 sm:mt-6" aria-label={`Remover equipamento ${index + 1}`} onClick={() => { setItems((current) => current.filter((candidate) => candidate.key !== item.key)); invalidateAvailability(); }}><Trash2 /></Button></div><div className="mt-3">{field(`items.${index}.notes`, `Observações do equipamento ${index + 1}`, <Input {...accessibility(`items.${index}.notes`)} value={item.notes} maxLength={1000} onChange={(event) => updateItem(item.key, { notes: event.target.value })} />)}</div></div>)}</div>{errors.items && <p className="mt-2 text-xs text-rose-700">{errors.items}</p>}<Button type="button" variant="outline" className="mt-4" disabled={checking || !items.length} onClick={() => void checkAvailability()}>{checking && <LoaderCircle className="animate-spin" />}Consultar disponibilidade</Button></section>
    {availabilityError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{availabilityError}</p>}<AvailabilityNotice items={availability} />
    {field("notes", "Observações gerais", <textarea {...accessibility("notes")} className={`${controlClass} min-h-20 resize-y`} value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />)}<p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">O responsável informado é o contato operacional. A autoria do pedido é registrada com sua conta autenticada. Aprovação, recusa e cancelamento de reservas aprovadas dependem de permissão específica.</p>
    </fieldset>{error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<DialogFooter className="border-t border-slate-100 pt-5"><Button type="button" variant="outline" disabled={saving || checking} onClick={onClose}>Voltar</Button><Button type="submit" disabled={saving || checking}>{saving && <LoaderCircle className="animate-spin" />}{saving ? "Salvando…" : "Salvar rascunho"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
