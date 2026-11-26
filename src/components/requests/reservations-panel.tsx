"use client";

import { handleAuthenticationResponse } from "@/lib/auth-client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarClock, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEventRange } from "@/lib/event-time";
import { formatUnits } from "@/lib/format";
import type { ReservationView } from "@/types/requests";

type ReservationTarget = { eventId: string; equipmentId?: never } | { equipmentId: string; eventId?: never };
const statusLabels = { ACTIVE: "Ativa", CANCELLED: "Cancelada", COMPLETED: "Concluída" } as const;
const statusColors = { ACTIVE: "border-blue-200 bg-blue-50 text-blue-700", CANCELLED: "border-slate-200 bg-slate-50 text-slate-600", COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700" } as const;

export function ReservationsPanel({ eventId, equipmentId }: ReservationTarget) {
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; items?: ReservationView[]; error?: string }>({ key: "" });
  const target = eventId ? `eventId=${encodeURIComponent(eventId)}` : `equipmentId=${encodeURIComponent(equipmentId ?? "")}`;
  const requestKey = `${target}:${revision}`;
  const loading = response.key !== requestKey;
  const items = response.key === requestKey ? response.items : undefined;
  const error = response.key === requestKey ? response.error : undefined;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await fetch(`/api/reservations?${target}`, { cache: "no-store", signal: controller.signal });
        handleAuthenticationResponse(result);
        const data = await result.json() as { items?: ReservationView[]; error?: string };
        if (!result.ok || !Array.isArray(data.items)) throw new Error(data.error ?? "Não foi possível carregar as reservas.");
        if (!controller.signal.aborted) setResponse({ key: requestKey, items: data.items });
      } catch (failure) {
        if (!controller.signal.aborted) setResponse({ key: requestKey, error: failure instanceof Error ? failure.message : "Não foi possível carregar as reservas." });
      }
    }
    void load();
    return () => controller.abort();
  }, [target, requestKey]);

  return <section aria-label="Reservas de equipamentos" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
    <div className="border-b border-slate-100 p-5"><div className="flex items-center gap-2"><CalendarClock className="size-4 text-blue-500" /><h2 className="text-sm font-semibold text-slate-900">Reservas de equipamentos</h2>{items && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{items.length}</span>}</div><p className="mt-2 text-xs leading-relaxed text-slate-500">Uma reserva aprovada compromete equipamentos apenas no período indicado. A retirada física é registrada separadamente.</p></div>
    {loading ? <p role="status" className="flex items-center gap-2 p-5 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Carregando reservas…</p> : error ? <div role="alert" className="space-y-3 p-5"><p className="text-sm text-rose-700">{error}</p><Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>Tentar novamente</Button></div> : !items?.length ? <p className="p-5 text-sm text-slate-500">Nenhuma reserva registrada para este {eventId ? "evento" : "equipamento"}. Necessidades preliminares e solicitações pendentes não bloqueiam estoque.</p> : <ul className="divide-y divide-slate-100">{items.map((reservation) => <li key={reservation.id} className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><Link href={`/estoque/${encodeURIComponent(reservation.equipmentId)}`} className="break-words text-sm font-medium text-blue-700 hover:underline">{reservation.equipmentName}</Link><p className="mt-1 text-xs text-slate-500">{formatUnits(reservation.quantity)}</p></div><Badge variant="outline" className={statusColors[reservation.status]}>{statusLabels[reservation.status]}</Badge></div>
      <p className="text-xs leading-relaxed text-slate-600">{formatEventRange(reservation.startsAt, reservation.endsAt)}<span className="mt-1 block text-[10px] text-slate-500">Horário de Brasília · America/Sao_Paulo</span></p>
      {reservation.assets.length > 0 && <p className="break-words text-xs text-slate-600">Patrimônios: {reservation.assets.join(", ")}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">{reservation.eventId && reservation.eventTitle && <Link href={`/eventos/${encodeURIComponent(reservation.eventId)}`} className="break-words font-medium text-blue-700 hover:underline">Evento: {reservation.eventTitle}</Link>}{reservation.requestId && <Link href={`/solicitacoes/${encodeURIComponent(reservation.requestId)}`} className="font-medium text-blue-700 hover:underline">Consultar solicitação</Link>}{!reservation.requestId && <span className="text-slate-500">Reserva sem solicitação vinculada</span>}</div>
    </li>)}</ul>}
  </section>;
}
