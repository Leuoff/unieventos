"use client";

import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, CalendarDays, ClipboardList, History, LoaderCircle, Pencil, XCircle } from "lucide-react";
import { EventForm, ConflictNotice, eventToInput, PRELIMINARY_NOTICE } from "@/components/events/event-form";
import { useEvents } from "@/components/providers/events-provider";
import { ReservationsPanel } from "@/components/requests/reservations-panel";
import { MovementsPanel } from "@/components/movements/movements-panel";
import { InventoryError, InventoryPagination } from "@/components/inventory/inventory-controls";
import { DetailItem } from "@/components/modules/module-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { EventsApiError, eventsRequest } from "@/lib/events-client";
import { formatEventRange, INSTITUTIONAL_TIME_ZONE } from "@/lib/event-time";
import { eventKindLabels, eventStatusLabels, type CalendarEvent, type EventDetail, type EventMutation } from "@/types/events";

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: INSTITUTIONAL_TIME_ZONE });

export function EventDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const [historyPage, setHistoryPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<"cancel" | "archive" | null>(null);
  const [response, setResponse] = useState<{ key: string; data?: EventDetail; error?: string }>({ key: "" });
  const requestKey = `${id}:${historyPage}:${revision}`;
  const data = response.key === requestKey && !response.error ? response.data : undefined;
  const error = response.key === requestKey ? response.error : undefined;
  const loading = response.key !== requestKey;
  function reload() { setRevision((current) => current + 1); }

  useEffect(() => {
    const controller = new AbortController();
    eventsRequest<EventDetail>(`/api/events/${encodeURIComponent(id)}?historyPage=${historyPage}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setResponse({ key: requestKey, data: result }); }).catch((failure) => { if (!controller.signal.aborted) setResponse({ key: requestKey, error: failure instanceof Error ? failure.message : "Não foi possível carregar este evento." }); });
    return () => controller.abort();
  }, [id, historyPage, requestKey]);

  if (loading) return <p role="status" className="flex min-h-60 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Carregando evento…</p>;
  if (error || !data) return <div className="space-y-5"><Button asChild variant="outline" size="sm"><Link href="/eventos"><ArrowLeft />Voltar para eventos</Link></Button><InventoryError message={error ?? "Evento não encontrado."} onRetry={reload} /></div>;
  const event = data.event;

  return <div className="space-y-6"><Button asChild variant="ghost" size="sm" className="-ml-3 text-slate-500"><Link href="/eventos"><ArrowLeft />Voltar para eventos</Link></Button>
    <PageHeader eyebrow="AGENDA INSTITUCIONAL" title={event.title} description="Informações compartilhadas, necessidades preliminares e histórico do evento.">{!event.archivedAt && data.permissions.edit && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setEditing(true)}><Pencil />Editar evento</Button>{event.status !== "CANCELLED" && <Button variant="outline" onClick={() => setAction("cancel")}><XCircle />Cancelar evento</Button>}{data.permissions.archive && <Button variant="outline" className="text-slate-600" onClick={() => setAction("archive")}><Archive />Arquivar evento</Button>}</div>}</PageHeader>
    {event.archivedAt && <p role="status" className="rounded-xl border border-slate-200 bg-slate-100 p-4 text-sm text-slate-600">Evento arquivado em {dateFormat.format(new Date(event.archivedAt))}. As informações e o histórico permanecem disponíveis para consulta.</p>}
    {event.status === "CANCELLED" && <p role="status" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Evento cancelado. O registro e seu histórico foram preservados. Eventos cancelados não geram alertas de sobreposição.</p>}
    <ConflictNotice conflicts={data.conflicts} />
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]"><section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6" aria-label="Informações do evento"><div className="mb-5 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">Informações do evento</h2><div className="flex flex-wrap gap-2"><Badge variant="outline">{eventKindLabels[event.kind]}</Badge><StatusBadge status={eventStatusLabels[event.status]} /></div></div><p className="mb-6 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">{event.description}</p><dl className="grid gap-5 sm:grid-cols-2"><div className="sm:col-span-2"><DetailItem label="Período"><span className="flex items-start gap-2"><CalendarDays className="mt-0.5 size-4 shrink-0 text-blue-500" />{formatEventRange(event.startsAt, event.endsAt)}</span><span className="mt-1 block text-xs text-slate-500">Horários de Brasília · America/Sao_Paulo</span></DetailItem></div><DetailItem label="Local"><span className="break-words">{event.location}</span></DetailItem><DetailItem label="Setor organizador">{event.department}</DetailItem><DetailItem label="Responsável declarado"><span className="break-words">{event.responsibleName}</span></DetailItem><DetailItem label="Contato informado"><span className="break-all">{event.contact}</span></DetailItem></dl><p className="mt-6 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">{event.createdByUserId ? "Evento cadastrado por uma conta autenticada. O responsável informado é o contato operacional." : "Registro histórico anterior à autenticação: responsável e setor foram declarados, sem autoria autenticada."}</p><div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-[11px] text-slate-400"><span>Cadastrado em {dateFormat.format(new Date(event.createdAt))}</span><span>Atualizado em {dateFormat.format(new Date(event.updatedAt))}</span><span>Versão {event.version}</span></div></section>
      <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6" aria-label="Necessidades preliminares"><h2 className="font-semibold text-slate-900">Necessidades de equipamentos</h2><p className="mt-3 rounded-lg bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">{PRELIMINARY_NOTICE}</p>{event.equipmentNeeds.length ? <ul className="mt-4 divide-y divide-slate-100">{event.equipmentNeeds.map((need) => <li key={need.id} className="py-4"><div className="flex items-start justify-between gap-3"><Link href={`/estoque/${need.equipmentId}`} className="break-words text-sm font-medium text-blue-700 hover:underline">{need.equipmentName}</Link><Badge variant="secondary" className="shrink-0">{need.quantity} un.</Badge></div><p className="mt-1 text-xs text-slate-500">{need.equipmentCategory}{need.equipmentArchived && " · Equipamento arquivado"}</p>{need.notes && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600">{need.notes}</p>}</li>)}</ul> : <p className="py-8 text-center text-sm text-slate-500">Nenhuma necessidade de equipamento cadastrada.</p>}</section>
    </div>
    <section aria-label="Histórico de alterações" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"><div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><History className="size-4 text-slate-400" /><h2 className="font-semibold text-slate-900">Histórico de alterações</h2></div>{data.history.length ? <ol className="divide-y divide-slate-100 px-5">{data.history.map((entry) => <li key={entry.id} className="grid gap-2 py-4 sm:grid-cols-[170px_1fr]"><time dateTime={entry.createdAt} className="text-xs text-slate-500">{dateFormat.format(new Date(entry.createdAt))}</time><div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{entry.description}</p><p className="mt-1 text-[11px] text-slate-400">{entry.actorUserId ? "Operação registrada por conta autenticada." : "Registro histórico sem autoria autenticada."}</p></div></li>)}</ol> : <p className="px-5 py-8 text-sm text-slate-500">Nenhuma alteração registrada.</p>}<InventoryPagination label="registros do histórico" pagination={data.historyPagination} onChange={setHistoryPage} /></section>
    <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold text-slate-900">Solicitações deste evento</h2><p className="mt-1 text-xs leading-relaxed text-slate-600">Consulte os pedidos e reaproveite as necessidades preliminares ao criar uma solicitação. Nenhuma reserva é criada automaticamente.</p></div><Button variant="outline" className="shrink-0" asChild><Link href={`/solicitacoes?eventId=${encodeURIComponent(id)}`}><ClipboardList />Ver solicitações</Link></Button></div>
    <ReservationsPanel key={`reservations-${id}-${revision}`} eventId={id} />
    <MovementsPanel key={`movements-${id}-${revision}`} eventId={id} />
    {editing && data.permissions.edit && <EventForm event={event} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setHistoryPage(1); reload(); }} />}
    {action && <EventActionDialog event={event} action={action} onClose={() => setAction(null)} onReload={() => { setAction(null); reload(); }} onSaved={() => { setAction(null); if (action === "archive") router.push("/eventos"); else { setHistoryPage(1); reload(); } }} />}
  </div>;
}

function EventActionDialog({ event, action, onClose, onSaved, onReload }: { event: CalendarEvent; action: "cancel" | "archive"; onClose: () => void; onSaved: () => void; onReload: () => void }) {
  const id = useId();
  const { refresh, notify } = useEvents();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const cancel = action === "cancel";
  async function submit(submission: FormEvent) {
    submission.preventDefault(); setError(""); setFieldError("");
    if (reason.trim().length < 3) { setFieldError("Informe um motivo com pelo menos 3 caracteres."); return; }
    setSaving(true);
    try {
      if (cancel) await eventsRequest<EventMutation>(`/api/events/${event.id}`, { method: "PATCH", body: JSON.stringify({ ...eventToInput(event), status: "CANCELLED", reason: reason.trim() }) });
      else await eventsRequest<{ archived: boolean }>(`/api/events/${event.id}`, { method: "DELETE", body: JSON.stringify({ version: event.version, reason: reason.trim() }) });
      notify(cancel ? "Evento cancelado. O histórico foi preservado." : "Evento arquivado. O histórico foi preservado.");
      void refresh(); onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível concluir a operação.");
      if (failure instanceof EventsApiError) { setFieldError(failure.fieldErrors.reason ?? ""); setStale(failure.status === 409); }
    } finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent onEscapeKeyDown={(e) => { if (saving) e.preventDefault(); }} onPointerDownOutside={(e) => { if (saving) e.preventDefault(); }}><DialogHeader><DialogTitle>{cancel ? "Cancelar evento" : "Arquivar evento"}</DialogTitle><DialogDescription>{cancel ? "O evento será marcado como cancelado. Suas informações, necessidades preliminares e histórico serão preservados." : "O evento sairá da agenda ativa e continuará disponível no filtro de arquivados, com todo o histórico preservado."}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-5" noValidate><div><label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-700">{cancel ? "Motivo do cancelamento" : "Motivo do arquivamento"}</label><textarea id={id} className="min-h-24 w-full resize-y rounded-lg border border-input px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={reason} maxLength={500} required disabled={saving} onChange={(e) => setReason(e.target.value)} aria-invalid={!!fieldError} aria-describedby={fieldError ? `${id}-error` : undefined} />{fieldError && <p id={`${id}-error`} className="mt-1 text-xs text-rose-700">{fieldError}</p>}</div>{error && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700"><p>{error}</p>{stale && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onReload}>Recarregar evento</Button>}</div>}<DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Voltar</Button><Button type="submit" disabled={saving || stale}>{saving && <LoaderCircle className="animate-spin" />}{saving ? "Salvando…" : cancel ? "Confirmar cancelamento" : "Confirmar arquivamento"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
