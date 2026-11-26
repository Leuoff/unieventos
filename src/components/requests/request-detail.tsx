"use client";

import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCheck, History, LoaderCircle, Pencil, Send, ShieldAlert, XCircle } from "lucide-react";
import { useRequests } from "@/components/providers/requests-provider";
import { MovementsPanel } from "@/components/movements/movements-panel";
import { AvailabilityNotice } from "@/components/requests/availability-notice";
import { RequestForm } from "@/components/requests/request-form";
import { InventoryError } from "@/components/inventory/inventory-controls";
import { DetailItem } from "@/components/modules/module-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatEventRange, INSTITUTIONAL_TIME_ZONE } from "@/lib/event-time";
import { requestsRequest } from "@/lib/requests-client";
import { requestStatusLabels, type EquipmentRequest, type RequestDetail } from "@/types/requests";

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: INSTITUTIONAL_TIME_ZONE });

export function RequestDetailPage({ id }: { id: string }) {
  const { refresh, notify } = useRequests();
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; data?: RequestDetail; error?: string }>({ key: "" });
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [action, setAction] = useState<"approve" | "refuse" | "cancel" | null>(null);
  const requestKey = `${id}:${revision}`;
  const data = response.key === requestKey && !response.error ? response.data : undefined;
  const error = response.key === requestKey ? response.error : undefined;
  const loading = response.key !== requestKey;
  function reload() { setRevision((current) => current + 1); }

  useEffect(() => {
    const controller = new AbortController();
    requestsRequest<RequestDetail>(`/api/requests/${encodeURIComponent(id)}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setResponse({ key: requestKey, data: result }); }).catch((failure) => { if (!controller.signal.aborted) setResponse({ key: requestKey, error: failure instanceof Error ? failure.message : "Não foi possível carregar esta solicitação." }); });
    return () => controller.abort();
  }, [id, requestKey]);

  async function sendForReview(request: EquipmentRequest) {
    setSubmitting(true); setSubmitError("");
    try {
      await requestsRequest<EquipmentRequest>(`/api/requests/${request.id}/submit`, { method: "POST", body: JSON.stringify({ version: request.version }) });
      notify("Solicitação enviada para análise. O estoque continua disponível até uma aprovação autorizada."); void refresh(); reload();
    } catch (failure) { setSubmitError(failure instanceof Error ? failure.message : "Não foi possível enviar a solicitação."); }
    finally { setSubmitting(false); }
  }

  if (loading) return <p role="status" className="flex min-h-60 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Carregando solicitação…</p>;
  if (error || !data) return <div className="space-y-5"><Button asChild variant="outline" size="sm"><Link href="/solicitacoes"><ArrowLeft />Voltar para solicitações</Link></Button><InventoryError message={error ?? "Solicitação não encontrada."} onRetry={reload} /></div>;
  const request = data.request;

  return <div className="space-y-6"><Button asChild variant="ghost" size="sm" className="-ml-3 text-slate-500"><Link href="/solicitacoes"><ArrowLeft />Voltar para solicitações</Link></Button><PageHeader eyebrow="SOLICITAÇÃO DE EQUIPAMENTOS" title={`Pedido para ${request.eventTitle}`} description={`Solicitação ${request.id.slice(0, 8)} · Acompanhe os equipamentos, a disponibilidade e o histórico.`}>{request.status === "DRAFT" && (data.permissions.edit || data.permissions.submit) && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setEditing(true)} disabled={submitting || !data.permissions.edit}><Pencil />Editar rascunho</Button><Button onClick={() => void sendForReview(request)} disabled={submitting || !data.permissions.submit}>{submitting ? <LoaderCircle className="animate-spin" /> : <Send />}{submitting ? "Enviando…" : "Enviar para análise"}</Button></div>}</PageHeader>
    {submitError && <div role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700"><p>{submitError}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => { setSubmitError(""); reload(); }}>Recarregar solicitação</Button></div>}
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"><section aria-label="Informações da solicitação" className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-slate-900">Informações da solicitação</h2><StatusBadge status={requestStatusLabels[request.status]} /></div><dl className="grid gap-5 sm:grid-cols-2"><DetailItem label="Evento"><Link href={`/eventos/${request.eventId}`} className="break-words text-blue-700 hover:underline">{request.eventTitle}</Link></DetailItem><DetailItem label="Setor organizador">{request.department}</DetailItem><DetailItem label="Responsável declarado"><span className="break-words">{request.responsibleName}</span></DetailItem><DetailItem label="Origem">{request.importedFromNeeds ? "Necessidades preliminares do evento" : "Cadastro de solicitação"}</DetailItem><div className="sm:col-span-2"><DetailItem label="Período necessário">{formatEventRange(request.startsAt, request.endsAt)}<span className="mt-1 block text-xs text-slate-500">Horário de Brasília · America/Sao_Paulo</span></DetailItem></div>{request.notes && <div className="sm:col-span-2"><DetailItem label="Observações gerais"><span className="whitespace-pre-wrap break-words">{request.notes}</span></DetailItem></div>}</dl><p className="mt-5 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">{request.createdByUserId ? "Pedido cadastrado por uma conta autenticada; o responsável informado é o contato operacional." : "Registro histórico anterior à autenticação, sem autoria autenticada."} Uma reserva aprovada compromete apenas o período indicado e não representa retirada física.</p><div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-[11px] text-slate-400"><span>Criado em {dateFormat.format(new Date(request.createdAt))}</span><span>Atualizado em {dateFormat.format(new Date(request.updatedAt))}</span><span>Versão {request.version}</span></div></section>{request.status !== "APPROVED" && <AvailabilityNotice items={data.availability} />}</div>
    <section aria-label="Equipamentos solicitados" className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs"><h2 className="font-semibold text-slate-900">Equipamentos solicitados</h2><ul className="mt-3 divide-y divide-slate-100">{request.items.map((item) => <li key={item.id} className="py-4"><div className="flex items-start justify-between gap-3"><Link href={`/estoque/${item.equipmentId}`} className="break-words text-sm font-medium text-blue-700 hover:underline">{item.equipmentName}</Link><Badge variant="secondary" className="shrink-0">{item.quantity} un.</Badge></div>{item.notes && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600">{item.notes}</p>}</li>)}</ul></section>
    <section aria-label="Análise da solicitação" className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs"><h2 className="font-semibold text-slate-900">Análise da solicitação</h2><p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{data.permissions.reason}</p>{request.status === "DRAFT" && <p className="mt-3 text-xs text-slate-500">Envie o rascunho para análise quando todos os dados estiverem prontos. Esse envio não cria reservas.</p>}{request.status === "PENDING" && <p className="mt-3 text-xs text-slate-500">Aguardando análise. Os equipamentos ainda não estão reservados.</p>}<div className="mt-4 flex flex-wrap gap-2"><Button disabled={!data.permissions.approve || request.status !== "PENDING"} onClick={() => setAction("approve")}><CheckCheck />Aprovar solicitação</Button><Button variant="outline" disabled={!data.permissions.refuse || request.status !== "PENDING"} onClick={() => setAction("refuse")}><XCircle />Recusar com justificativa</Button><Button variant="outline" disabled={!data.permissions.cancel || request.status === "CANCELLED" || request.status === "REFUSED"} onClick={() => setAction("cancel")}><XCircle />{request.status === "APPROVED" ? "Cancelar reserva aprovada" : "Cancelar solicitação"}</Button></div></section>
    <section aria-label="Reservas da solicitação" className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs"><h2 className="font-semibold text-slate-900">Reservas vinculadas</h2><p className="mt-1 text-xs text-slate-500">Reservar não equivale a retirar. Os saldos físicos permanecem separados dos compromissos de agenda.</p>{data.reservations.length ? <ul className="mt-3 divide-y divide-slate-100">{data.reservations.map((reservation) => <li key={reservation.id} className="space-y-2 py-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/estoque/${reservation.equipmentId}`} className="font-medium text-blue-700 hover:underline">{reservation.equipmentName}</Link><StatusBadge status={reservation.status === "ACTIVE" ? "Reservada" : reservation.status === "CANCELLED" ? "Cancelada" : "Concluída"} /></div><p className="text-xs text-slate-600">{reservation.quantity} un. · {formatEventRange(reservation.startsAt, reservation.endsAt)}</p>{reservation.assets.length > 0 && <p className="break-words text-xs text-slate-500">Patrimônios: {reservation.assets.join(", ")}</p>}</li>)}</ul> : <p className="py-8 text-center text-sm text-slate-500">Nenhuma reserva criada para esta solicitação.</p>}</section>
    <section aria-label="Histórico da solicitação" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"><div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><History className="size-4 text-slate-400" /><h2 className="font-semibold text-slate-900">Histórico e decisões</h2></div>{data.history.length ? <ol className="divide-y divide-slate-100 px-5">{data.history.map((entry) => <li key={entry.id} className="grid gap-2 py-4 sm:grid-cols-[170px_1fr]"><time dateTime={entry.createdAt} className="text-xs text-slate-500">{dateFormat.format(new Date(entry.createdAt))}</time><div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{entry.description}</p><p className="mt-1 text-[11px] text-slate-400">{entry.actorUserId ? "Operação registrada por conta autenticada." : "Registro sem identidade autenticada."}</p></div></li>)}</ol> : <p className="px-5 py-8 text-sm text-slate-500">Nenhuma alteração registrada.</p>}</section>
    <MovementsPanel key={`movements-${id}-${revision}`} requestId={id} />
    {editing && data.permissions.edit && <RequestForm request={request} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}{action && <RequestDecision request={request} action={action} onClose={() => setAction(null)} onSaved={() => { setAction(null); reload(); }} />}
  </div>;
}

function RequestDecision({ request, action, onClose, onSaved }: { request: EquipmentRequest; action: "approve" | "refuse" | "cancel"; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const { refresh, notify } = useRequests();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const label = action === "approve" ? "Aprovar solicitação" : action === "refuse" ? "Recusar solicitação" : request.status === "APPROVED" ? "Cancelar reserva aprovada" : "Cancelar solicitação";
  async function submit(event: FormEvent) {
    event.preventDefault(); if (reason.trim().length < 3) { setError("Informe uma justificativa com pelo menos 3 caracteres."); return; }
    setSaving(true); setError("");
    try { await requestsRequest(`/api/requests/${request.id}/decision`, { method: "POST", body: JSON.stringify({ action, version: request.version, reason: reason.trim() }) }); notify("Decisão registrada no histórico."); void refresh(); onSaved(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível registrar a decisão."); }
    finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>{action === "cancel" ? request.status === "APPROVED" ? "Cancelar uma reserva aprovada exige permissão específica. Os compromissos serão liberados, preservando o histórico e validando retiradas existentes." : "Cancelar este pedido sem reserva preserva o histórico e não altera o estoque. A operação é permitida ao autor do pedido ou a um gestor autorizado." : "A decisão exige autorização no servidor e preserva o histórico. A aprovação confere novamente os conflitos antes de comprometer o intervalo."}</DialogDescription></DialogHeader><form onSubmit={submit} noValidate className="space-y-5"><div><label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-700">Justificativa da decisão</label><textarea id={id} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} disabled={saving} className="min-h-24 w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" required /></div>{error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={saving}>Voltar</Button><Button type="submit" disabled={saving}>{saving && <LoaderCircle className="animate-spin" />}{label}</Button></DialogFooter></form></DialogContent></Dialog>;
}
