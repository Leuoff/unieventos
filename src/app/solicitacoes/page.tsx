"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, CheckCheck, ClipboardList, Clock3, LoaderCircle } from "lucide-react";
import { useRequests } from "@/components/providers/requests-provider";
import { RequestForm } from "@/components/requests/request-form";
import { InventoryError, InventoryPagination } from "@/components/inventory/inventory-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterSelect, ModuleTable, ResultCount, SearchField, SummaryCard } from "@/components/modules/module-controls";
import { formatEventRange } from "@/lib/event-time";
import { formatNumber } from "@/lib/format";
import { requestsRequest } from "@/lib/requests-client";
import { DEPARTMENTS } from "@/types/events";
import { requestStatusLabels, type RequestList } from "@/types/requests";

const emptyFilters = { q: "", status: "", department: "", eventId: "", from: "", to: "", page: 1, pageSize: 6 };

export default function RequestsPage() {
  return <Suspense fallback={<p role="status" className="p-8 text-sm text-slate-500">Carregando solicitações…</p>}><RequestsPageContent /></Suspense>;
}

function RequestsPageContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const status = searchParams.get("status") ?? "";
  return <RequestsList key={`${eventId}:${status}`} eventId={eventId} status={status} />;
}

function RequestsList({ eventId, status }: { eventId: string; status: string }) {
  const router = useRouter();
  const { summary, loading: summaryLoading, error: summaryError, refresh } = useRequests();
  const [filters, setFilters] = useState(() => ({ ...emptyFilters, eventId, status }));
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; data?: RequestList; error?: string }>({ key: "" });
  const query = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)])).toString();
  const requestKey = `${query}:${revision}`;
  const periodError = filters.from && filters.to && filters.from > filters.to ? "O período final deve ser igual ou posterior ao inicial." : "";
  const loading = response.key !== requestKey && !periodError;
  const data = response.key === requestKey && !response.error ? response.data : undefined;
  const error = response.key === requestKey ? response.error : undefined;
  const realSummary = summary ?? data?.summary;
  const hasFilters = !!(filters.q || filters.status || filters.department || filters.eventId || filters.from || filters.to);

  useEffect(() => {
    if (periodError) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      requestsRequest<RequestList>(`/api/requests?${query}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setResponse({ key: requestKey, data: result }); }).catch((failure) => { if (!controller.signal.aborted) setResponse({ key: requestKey, error: failure instanceof Error ? failure.message : "Não foi possível carregar as solicitações." }); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, requestKey, periodError]);

  function filter(key: keyof typeof emptyFilters, value: string) { setFilters((current) => ({ ...current, [key]: value, page: 1 })); }
  function reload() { setRevision((current) => current + 1); }
  const value = (key: "total" | "pending" | "approved") => realSummary ? formatNumber(realSummary[key]) : summaryLoading ? "…" : "—";

  return <div className="space-y-6"><PageHeader eyebrow="ATENDIMENTO AOS SETORES" title="Solicitações" description="Organize os equipamentos necessários para cada evento e acompanhe a análise dos pedidos."><RequestForm eventId={filters.eventId} onSaved={(saved) => router.push(`/solicitacoes/${saved.id}`)} /></PageHeader>
    <div className="grid gap-4 sm:grid-cols-3"><SummaryCard title="Total de solicitações" value={value("total")} description="Registros persistidos dos setores" icon={<ClipboardList className="size-4" />} /><SummaryCard title="Aguardando análise" value={value("pending")} description="Pedidos pendentes não bloqueiam o estoque" icon={<Clock3 className="size-4" />} tone="amber" /><SummaryCard title="Aprovadas" value={value("approved")} description="Reservas comprometidas apenas no período" icon={<CheckCheck className="size-4" />} tone="green" /></div>
    {summaryError && !realSummary && <InventoryError message={summaryError} onRetry={() => void refresh()} />}
    <p className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs leading-relaxed text-blue-800">Rascunhos e solicitações pendentes não reservam nem retiram equipamentos. Você pode gerenciar seus próprios pedidos. Aprovação, recusa e cancelamento de reservas aprovadas dependem das permissões da sua conta.</p>
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs" aria-label="Solicitações de equipamentos"><div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5"><h2 className="font-semibold text-slate-900">Solicitações de equipamentos</h2>{data && <ResultCount count={data.pagination.total} singular="solicitação" plural="solicitações" gender="feminine" />}</div>
      <div className="space-y-3 p-5"><div className="flex flex-col gap-3 md:flex-row md:flex-wrap"><SearchField value={filters.q} onChange={(value) => filter("q", value)} placeholder="Buscar solicitação, evento ou responsável..." /><FilterSelect label="Setor solicitante" value={filters.department} onChange={(value) => filter("department", value)} options={[{ value: "", label: "Todos os setores" }, ...DEPARTMENTS.map((value) => ({ value, label: value }))]} /><FilterSelect label="Status da solicitação" value={filters.status} onChange={(value) => filter("status", value)} options={[{ value: "", label: "Todos os status" }, ...Object.entries(requestStatusLabels).map(([value, label]) => ({ value, label }))]} /></div><div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"><label className="min-w-0 text-xs text-slate-500">Período inicial<Input aria-label="Período inicial" type="date" value={filters.from} onChange={(event) => filter("from", event.target.value)} className="mt-1" /></label><label className="min-w-0 text-xs text-slate-500">Período final<Input aria-label="Período final" type="date" value={filters.to} onChange={(event) => filter("to", event.target.value)} className="mt-1" /></label><FilterSelect label="Solicitações por página" value={String(filters.pageSize)} onChange={(value) => setFilters((current) => ({ ...current, pageSize: Number(value), page: 1 }))} options={[6, 12, 24].map((value) => ({ value: String(value), label: `${value} por página` }))} />{hasFilters && <Button variant="ghost" size="sm" onClick={() => setFilters(emptyFilters)}>Limpar filtros</Button>}</div>{filters.eventId && <p className="text-xs text-blue-700">Exibindo solicitações vinculadas ao evento selecionado. Use “Limpar filtros” para consultar todos os eventos.</p>}{periodError && <p role="alert" className="text-xs text-rose-700">{periodError}</p>}</div>
      {periodError ? <EmptyState title="Revise o período informado" description="A data final deve ser igual ou posterior à data inicial." /> : loading ? <p role="status" className="flex min-h-60 items-center justify-center gap-2 p-8 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Carregando solicitações…</p> : error ? <div className="p-5"><InventoryError message={error} onRetry={reload} /></div> : data?.items.length ? <ModuleTable columns={[{ key: "request", label: "Solicitação / evento" }, { key: "responsible", label: "Responsável declarado" }, { key: "period", label: "Período necessário" }, { key: "quantity", label: "Unidades" }, { key: "status", label: "Status" }, { key: "details", label: "Detalhes", className: "text-right" }]}>{data.items.map((request) => <tr key={request.id} className="transition hover:bg-slate-50/70"><td className="max-w-72 px-5 py-4"><Link href={`/solicitacoes/${request.id}`} className="block truncate font-medium text-slate-800 hover:text-blue-700 hover:underline">{request.eventTitle}</Link><p className="mt-1 text-[11px] text-slate-400">Pedido {request.id.slice(0, 8)}</p></td><td className="px-5 py-4"><p className="text-slate-700">{request.responsibleName}</p><p className="mt-1 text-xs text-slate-500">{request.department}</p></td><td className="max-w-60 px-5 py-4 text-xs leading-relaxed text-slate-500">{formatEventRange(request.startsAt, request.endsAt)}</td><td className="px-5 py-4 text-slate-600">{formatNumber(request.items.reduce((sum, item) => sum + item.quantity, 0))}</td><td className="px-5 py-4"><StatusBadge status={requestStatusLabels[request.status]} /></td><td className="px-5 py-4 text-right"><Button asChild variant="ghost" size="icon"><Link href={`/solicitacoes/${request.id}`} aria-label={`Ver solicitação para ${request.eventTitle}`}><ArrowUpRight className="size-4 text-slate-500" /></Link></Button></td></tr>)}</ModuleTable> : <div className="p-8"><EmptyState title={hasFilters ? "Nenhuma solicitação encontrada" : "Solicitações para seus eventos"} description={hasFilters ? "Tente outro termo ou altere os filtros selecionados." : "Crie um rascunho com equipamentos do estoque ou importe as necessidades preliminares de um evento real."} />{hasFilters && <div className="mt-4 text-center"><Button variant="outline" size="sm" onClick={() => setFilters(emptyFilters)}>Limpar filtros</Button></div>}</div>}
      {data && <InventoryPagination label="solicitações" pagination={data.pagination} onChange={(page) => setFilters((current) => ({ ...current, page }))} disabled={loading} />}
    </section></div>;
}
