"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CheckCheck, ChevronLeft, ChevronRight, Globe2, List, LoaderCircle } from "lucide-react";
import { EventForm } from "@/components/events/event-form";
import { EventCard } from "@/components/events/event-card";
import { EventCalendar, calendarRange } from "@/components/events/event-calendar";
import { useEvents } from "@/components/providers/events-provider";
import { InventoryError, InventoryPagination } from "@/components/inventory/inventory-controls";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterSelect, SearchField, SummaryCard } from "@/components/modules/module-controls";
import { addDays, monthRange, todayInstitutional } from "@/lib/event-time";
import { eventsRequest } from "@/lib/events-client";
import { formatNumber } from "@/lib/format";
import { DEPARTMENTS, eventKindLabels, eventStatusLabels, type CalendarEvent, type EventList } from "@/types/events";

type View = "month" | "week" | "list";
const emptyFilters = { q: "", department: "", kind: "", status: "", location: "", from: "", to: "", archived: "0", page: 1, pageSize: 6 };
type CalendarResponse = { items: CalendarEvent[]; limitReached: boolean };

export default function EventsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { summary, today } = useEvents();
  const [filters, setFilters] = useState(emptyFilters);
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(todayInstitutional);
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; data?: EventList; calendar?: CalendarResponse; error?: string }>({ key: "" });
  const selectedId = searchParams.get("item");
  const range = view === "list" ? null : calendarRange(anchor, view);
  const periodError = filters.from && filters.to && filters.from > filters.to ? "O período final deve ser igual ou posterior ao inicial." : "";
  const from = range ? (filters.from && filters.from > range.from ? filters.from : range.from) : filters.from;
  const to = range ? (filters.to && filters.to < range.to ? filters.to : range.to) : filters.to;
  const outsidePeriod = !!(from && to && from > to);
  const query = new URLSearchParams(Object.entries({ ...filters, from: outsidePeriod ? "" : from, to: outsidePeriod ? "" : to }).map(([key, value]) => [key, String(value)])).toString();
  const requestKey = `${query}:${view}:${revision}:${outsidePeriod}`;
  const loading = response.key !== requestKey && !periodError;
  const data = response.key === requestKey && !response.error ? response.data : undefined;
  const calendar = response.key === requestKey && !response.error ? response.calendar : undefined;
  const error = response.key === requestKey ? response.error : undefined;
  const locations = response.data?.locations ?? [];
  const hasFilters = !!(filters.q || filters.department || filters.kind || filters.status || filters.location || filters.from || filters.to || filters.archived !== "0");

  useEffect(() => { if (selectedId) router.replace(`/eventos/${encodeURIComponent(selectedId)}`); }, [selectedId, router]);
  useEffect(() => {
    if (periodError) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const [result, calendarResult] = await Promise.all([eventsRequest<EventList>(`/api/events?${query}`, { signal: controller.signal }), view !== "list" && !outsidePeriod ? eventsRequest<CalendarResponse>(`/api/events/calendar?${query}`, { signal: controller.signal }) : Promise.resolve(undefined)]);
        if (!controller.signal.aborted) setResponse({ key: requestKey, data: result, calendar: outsidePeriod ? { items: [], limitReached: false } : calendarResult });
      } catch (failure) {
        if (!controller.signal.aborted) setResponse((current) => ({ key: requestKey, data: current.data, error: failure instanceof Error ? failure.message : "Não foi possível carregar os eventos." }));
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, requestKey, view, outsidePeriod, periodError]);

  function filter(key: keyof typeof emptyFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
    if (key === "from" && value) setAnchor(value);
  }
  function reload() { setRevision((value) => value + 1); }
  function clearFilters() { setFilters(emptyFilters); }
  function movePeriod(direction: number) {
    if (view === "week") setAnchor((current) => addDays(current, 7 * direction));
    else setAnchor((current) => { const month = monthRange(current); return direction > 0 ? addDays(month.to, 1) : monthRange(addDays(month.from, -1)).from; });
  }
  const summaryData = summary ?? data?.summary;
  const periodLabel = view === "week" ? `${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${range!.from}T12:00:00Z`))} a ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${range!.to}T12:00:00Z`))}` : new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${anchor}T12:00:00Z`));

  return <div className="space-y-6">
    <PageHeader eyebrow="AGENDA INSTITUCIONAL" title="Eventos" description="Uma agenda compartilhada para conectar os setores e a comunidade."><EventForm onSaved={() => { setFilters((current) => ({ ...current, archived: "0", page: 1 })); reload(); }} /></PageHeader>
    <div className="grid gap-4 sm:grid-cols-3"><SummaryCard title="Eventos na agenda" value={summaryData ? formatNumber(summaryData.total) : "—"} description="Programação de todos os setores" icon={<CalendarDays className="size-4" />} /><SummaryCard title="Confirmados" value={summaryData ? formatNumber(summaryData.confirmed) : "—"} description="Prontos para acontecer" icon={<CheckCheck className="size-4" />} tone="green" /><SummaryCard title="Eventos externos" value={summaryData ? formatNumber(summaryData.external) : "—"} description="UniSALESIANO além do campus" icon={<Globe2 className="size-4" />} tone="slate" /></div>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs" aria-label="Agenda compartilhada">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="font-semibold text-slate-900">Agenda compartilhada</h2><p className="mt-1 text-xs text-slate-500">Todos os setores · Horário de Brasília · America/Sao_Paulo</p></div><div className="flex rounded-lg bg-slate-100 p-1" aria-label="Visualização da agenda">{([{ value: "month", label: "Mês" }, { value: "week", label: "Semana" }, { value: "list", label: "Lista" }] as const).map((item) => <button key={item.value} type="button" aria-pressed={view === item.value} onClick={() => { setView(item.value); setFilters((current) => ({ ...current, page: 1 })); }} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${view === item.value ? "bg-white text-blue-700 shadow-xs" : "text-slate-500 hover:text-slate-900"}`}>{item.value === "list" ? <List className="size-3.5" /> : <CalendarDays className="size-3.5" />}{item.label}</button>)}</div></div>
      <div className="space-y-3 border-b border-slate-100 p-5 [&_select]:min-w-0 [&_select]:max-w-full"><div className="flex flex-col gap-3 md:flex-row md:flex-wrap"><SearchField value={filters.q} onChange={(value) => filter("q", value)} placeholder="Buscar eventos por título, local ou responsável" /><FilterSelect label="Setor do evento" value={filters.department} onChange={(value) => filter("department", value)} options={[{ value: "", label: "Todos os setores" }, ...DEPARTMENTS.map((value) => ({ value, label: value }))]} /><FilterSelect label="Tipo do evento" value={filters.kind} onChange={(value) => filter("kind", value)} options={[{ value: "", label: "Todos os tipos" }, ...Object.entries(eventKindLabels).map(([value, label]) => ({ value, label }))]} /></div><div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap"><FilterSelect label="Status do evento" value={filters.status} onChange={(value) => filter("status", value)} options={[{ value: "", label: "Todos os status" }, ...Object.entries(eventStatusLabels).map(([value, label]) => ({ value, label }))]} /><FilterSelect label="Local do evento" value={filters.location} onChange={(value) => filter("location", value)} options={[{ value: "", label: "Todos os locais" }, ...[...new Set([...locations, ...(filters.location ? [filters.location] : [])])].map((value) => ({ value, label: value }))]} /><FilterSelect label="Situação do cadastro" value={filters.archived} onChange={(value) => filter("archived", value)} options={[{ value: "0", label: "Eventos ativos" }, { value: "1", label: "Eventos arquivados" }]} /></div><div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"><label className="min-w-0 text-xs text-slate-500">Período inicial<Input aria-label="Período inicial" type="date" value={filters.from} onChange={(event) => filter("from", event.target.value)} className="mt-1" /></label><label className="min-w-0 text-xs text-slate-500">Período final<Input aria-label="Período final" type="date" value={filters.to} onChange={(event) => filter("to", event.target.value)} className="mt-1" /></label>{view === "list" && <FilterSelect label="Eventos por página" value={String(filters.pageSize)} onChange={(value) => setFilters((current) => ({ ...current, pageSize: Number(value), page: 1 }))} options={[6, 12, 24].map((value) => ({ value: String(value), label: `${value} por página` }))} />}{hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>Limpar filtros</Button>}</div>{periodError && <p role="alert" className="text-xs text-rose-700">{periodError}</p>}</div>
      {view !== "list" && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><h3 className="text-sm font-semibold capitalize text-slate-800">{periodLabel}</h3><div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => setAnchor(today || todayInstitutional())}>Hoje</Button><Button variant="outline" size="icon" aria-label={view === "week" ? "Semana anterior" : "Mês anterior"} onClick={() => movePeriod(-1)}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label={view === "week" ? "Próxima semana" : "Próximo mês"} onClick={() => movePeriod(1)}><ChevronRight /></Button></div></div>}
      {periodError ? <EmptyState title="Revise o período informado" description="A data final deve ser igual ou posterior à data inicial." /> : loading ? <p role="status" className="flex min-h-60 items-center justify-center gap-2 p-8 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Carregando agenda…</p> : error ? <div className="p-5"><InventoryError message={error} onRetry={reload} /></div> : view !== "list" ? <>{calendar?.limitReached && <p role="status" className="m-5 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">O calendário atingiu o limite de 2.000 eventos. Refine o período ou os filtros para ver toda a programação.</p>}<EventCalendar events={calendar?.items ?? []} anchor={anchor} view={view} today={today || todayInstitutional()} /></> : data?.items.length ? <div className="grid gap-4 p-5 md:grid-cols-2 2xl:grid-cols-3">{data.items.map((event) => <EventCard key={event.id} event={event} />)}</div> : <EmptyState title={hasFilters ? "Nenhum evento encontrado" : "Sua agenda começa aqui"} description={hasFilters ? "Ajuste a busca e os filtros para consultar a programação." : "Cadastre o primeiro evento e compartilhe a programação com todos os setores."} />}
      {view === "list" && data && !periodError && <InventoryPagination label="eventos" pagination={data.pagination} onChange={(page) => setFilters((current) => ({ ...current, page }))} disabled={loading} />}
    </section>
  </div>;
}
