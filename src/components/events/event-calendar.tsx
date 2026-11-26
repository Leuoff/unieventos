"use client";

import Link from "next/link";
import { addDays, eventOverlapsDay, INSTITUTIONAL_TIME_ZONE, institutionalDate, monthRange, weekRange } from "@/lib/event-time";
import { cn } from "@/lib/utils";
import { eventStatusLabels, type CalendarEvent } from "@/types/events";

const sectorColors = { Multimeios: "border-blue-200 bg-blue-50 text-blue-800", Marketing: "border-violet-200 bg-violet-50 text-violet-800", "Projeto de Extensão": "border-emerald-200 bg-emerald-50 text-emerald-800" };
const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: INSTITUTIONAL_TIME_ZONE });
const dayFormat = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export function calendarRange(anchor: string, view: "month" | "week") {
  if (view === "week") return weekRange(anchor);
  const month = monthRange(anchor);
  return { from: weekRange(month.from).from, to: weekRange(month.to).to };
}

export function EventCalendar({ events, anchor, view, today }: { events: CalendarEvent[]; anchor: string; view: "month" | "week"; today: string }) {
  const range = calendarRange(anchor, view);
  const days: string[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) days.push(date);
  const forDay = (date: string) => events.filter((event) => eventOverlapsDay(event.startsAt, event.endsAt, date));
  function eventLink(event: CalendarEvent, date: string, compact = false) {
    const continued = institutionalDate(event.startsAt) < date;
    return <Link key={event.id} href={`/eventos/${event.id}`} title={`${event.title} · ${event.department} · ${eventStatusLabels[event.status]}`} className={cn("block min-w-0 break-words rounded-md border px-2 py-1.5 text-xs leading-snug [overflow-wrap:anywhere] outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-blue-500", sectorColors[event.department], event.status === "CANCELLED" && "border-slate-200 bg-slate-100 text-slate-500", compact && "text-[11px]")}><span className="block font-medium">{continued ? "Continuação" : timeFormat.format(new Date(event.startsAt))} · <span className={event.status === "CANCELLED" ? "line-through" : ""}>{event.title}</span></span><span className="mt-0.5 block opacity-80">{event.department}{!compact && ` · ${event.location}`}{event.status === "CANCELLED" && " · Cancelado"}</span></Link>;
  }
  return <div>
    <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-slate-100 px-5 py-3 text-[11px] text-slate-600">{Object.entries(sectorColors).map(([department, colors]) => <span key={department} className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full border", colors)} />{department}</span>)}</div>
    {!events.length && <p role="status" className="border-b border-slate-100 bg-slate-50/50 px-5 py-4 text-sm text-slate-500">Nenhum evento neste período para os filtros selecionados.</p>}
    <div className={view === "month" ? "hidden md:block" : "hidden lg:block"} aria-label={view === "month" ? "Calendário mensal" : "Calendário semanal"}>
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/70">{weekdays.map((day) => <div key={day} className="px-2 py-3 text-center text-xs font-medium text-slate-500">{day}</div>)}</div>
      <div className="grid grid-cols-7">{days.map((date) => { const dailyEvents = forDay(date); return <section key={date} aria-label={dayFormat.format(new Date(`${date}T12:00:00Z`))} className={cn("min-h-36 min-w-0 border-b border-r border-slate-100 p-2 last:border-r-0", date.slice(0, 7) !== anchor.slice(0, 7) && view === "month" && "bg-slate-50/60", view === "week" && "min-h-72")}><p className="mb-2 flex justify-end"><span className={cn("inline-flex size-7 items-center justify-center rounded-full text-xs", date === today ? "bg-blue-600 font-semibold text-white" : "text-slate-500")}>{Number(date.slice(-2))}</span></p><div className="space-y-1.5">{dailyEvents.map((event) => eventLink(event, date, view === "month"))}{view === "week" && !dailyEvents.length && <p className="py-4 text-center text-[11px] text-slate-400">Sem eventos</p>}</div></section>; })}</div>
    </div>
    <div className={cn("divide-y divide-slate-100", view === "month" ? "md:hidden" : "lg:hidden")} aria-label="Agenda por dia">{days.filter((date) => view === "week" || (date.slice(0, 7) === anchor.slice(0, 7) && forDay(date).length > 0)).map((date) => <section key={date} className="p-4"><h2 className={cn("mb-3 text-sm font-semibold capitalize", date === today ? "text-blue-700" : "text-slate-700")}>{dayFormat.format(new Date(`${date}T12:00:00Z`))}{date === today && " · Hoje"}</h2><div className="space-y-2">{forDay(date).map((event) => eventLink(event, date))}{!forDay(date).length && <p className="text-xs text-slate-400">Sem eventos neste dia.</p>}</div></section>)}{view === "month" && !days.some((date) => date.slice(0, 7) === anchor.slice(0, 7) && forDay(date).length > 0) && <p className="p-8 text-center text-sm text-slate-500">Sem eventos neste mês para os filtros selecionados.</p>}</div>
  </div>;
}
