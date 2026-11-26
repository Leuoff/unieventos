"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { institutionalDayRange, instantToInstitutionalInput } from "@/lib/event-time";
import type { CalendarEvent } from "@/types/events";

export function CalendarPanel({ events, today, loading = false, error = null }: { events: CalendarEvent[]; today: string; loading?: boolean; error?: string | null }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [year, monthNumber] = (cursor ?? today).split("-").map(Number);
  const month = monthNumber - 1;
  const selectedDay = selected ?? today;
  const firstDay = new Date(Date.UTC(year, month, 1));
  const offset = firstDay.getUTCDay();
  const lastDate = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cellCount = Math.ceil((offset + lastDate) / 7) * 7;
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(firstDay);
  const activeEvents = !loading && !error ? events.filter((event) => event.status !== "CANCELLED").map((event) => ({ event, start: new Date(event.startsAt).getTime(), end: new Date(event.endsAt).getTime() })) : [];
  const selectedRange = institutionalDayRange(selectedDay, selectedDay);
  const selectedStart = new Date(selectedRange.startsAt).getTime();
  const selectedEnd = new Date(selectedRange.endsAt).getTime();
  const selectedEvents = activeEvents.filter((item) => item.start < selectedEnd && item.end > selectedStart).map((item) => item.event);

  function moveMonth(delta: number) {
    const date = new Date(Date.UTC(year, month + delta, 1));
    const iso = date.toISOString().slice(0, 10);
    setCursor(iso);
    setSelected(iso);
  }

  return <Card className="flex h-full flex-col p-5 shadow-none" aria-busy={loading}>
    <div className="mb-5 flex items-center justify-between"><h2 className="panel-heading">Calendário</h2><Link href="/eventos" aria-label="Ver agenda completa" className="rounded p-1 text-slate-500 hover:bg-blue-50 hover:text-blue-600"><ArrowUpRight className="size-4" /></Link></div>
    <div className="mb-5 flex items-center justify-between"><p className="text-xs font-semibold capitalize text-slate-700">{monthLabel}</p><div className="flex gap-1"><button type="button" aria-label="Mês anterior" onClick={() => moveMonth(-1)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><ChevronLeft className="size-4" /></button><button type="button" aria-label="Próximo mês" onClick={() => moveMonth(1)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><ChevronRight className="size-4" /></button></div></div>
    <div className="grid grid-cols-7 gap-y-1 text-center">{["D", "S", "T", "Q", "Q", "S", "S"].map((day, index) => <span key={index} className="pb-2 text-[11px] font-medium text-slate-500">{day}</span>)}{Array.from({ length: cellCount }, (_, index) => {
      const date = new Date(Date.UTC(year, month, index - offset + 1));
      const iso = date.toISOString().slice(0, 10);
      const inMonth = date.getUTCMonth() === month;
      const range = institutionalDayRange(iso, iso);
      const startsAt = new Date(range.startsAt).getTime();
      const endsAt = new Date(range.endsAt).getTime();
      const hasEvent = activeEvents.some((item) => item.start < endsAt && item.end > startsAt);
      return <button type="button" key={iso} onClick={() => setSelected(iso)} aria-label={`${date.getUTCDate()} de ${new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(date)}${hasEvent ? ", com eventos" : ""}`} aria-pressed={iso === selectedDay} className={cn("relative mx-auto flex size-8 items-center justify-center rounded-lg text-xs transition-colors", !inMonth ? "text-slate-300" : "text-slate-600 hover:bg-blue-50", iso === today && iso !== selectedDay && "bg-blue-50 font-semibold text-blue-700", iso === selectedDay && "bg-blue-600 font-semibold text-white hover:bg-blue-700")}><span>{date.getUTCDate()}</span>{hasEvent && <span className={cn("absolute bottom-1 size-[3px] rounded-full", iso === selectedDay ? "bg-white" : "bg-blue-500")} />}</button>;
    })}</div>
    <div className="mt-5 flex items-center gap-3 border-t pt-4 text-[10px] text-slate-500"><span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-blue-500" />Com eventos</span><button type="button" onClick={() => { setCursor(null); setSelected(null); }} className="ml-auto font-medium text-blue-600 hover:underline">Voltar para hoje</button></div>
    <div aria-live="polite" className="mt-4 rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-semibold text-slate-500">{new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${selectedDay}T12:00:00Z`))}</p><p className="mt-1 text-xs leading-relaxed text-slate-600">{loading ? "Carregando agenda…" : error ? "Agenda indisponível." : selectedEvents.length ? `${selectedEvents.length} ${selectedEvents.length === 1 ? "evento na agenda" : "eventos na agenda"}` : "Nenhum evento para este dia"}</p>{selectedEvents.map((event) => <Link key={event.id} href={`/eventos/${encodeURIComponent(event.id)}`} className="mt-2 block truncate text-[11px] text-blue-600 hover:underline">{instantToInstitutionalInput(event.startsAt).slice(11)} · {event.title}</Link>)}<p className="mt-2 text-[10px] text-slate-500">Horário de Brasília · America/Sao_Paulo</p></div>
  </Card>;
}
