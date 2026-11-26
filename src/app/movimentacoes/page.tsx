"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useEvents } from "@/components/providers/events-provider";
import { useInventory } from "@/components/providers/inventory-provider";
import { useMovements } from "@/components/providers/movements-provider";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, ResultCount, SearchField } from "@/components/modules/module-controls";
import { InventoryError, InventoryPagination } from "@/components/inventory/inventory-controls";
import { MovementSummaryCards, MovementsTable } from "@/components/movements/movement-controls";
import { WithdrawalForm } from "@/components/movements/withdrawal-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authRequest } from "@/lib/auth-client";
import { movementStatusLabels, type MovementList } from "@/types/movements";

export default function MovementsPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { items: events } = useEvents();
  const { items: equipment } = useInventory();
  const { refresh } = useMovements();
  const [filters, setFilters] = useState(() => ({ q: "", eventId: "", equipmentId: "", responsible: "", from: "", to: "", status: typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("status") ?? "", page: 1, pageSize: 6 }));
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [response, setResponse] = useState<{ key: string; data?: MovementList; error?: string }>({ key: "" });
  const query = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)])).toString();
  const requestKey = `${query}:${revision}`;
  const data = response.key === requestKey ? response.data : undefined;
  const error = response.key === requestKey ? response.error : undefined;
  const loading = response.key !== requestKey;
  const change = (key: keyof typeof filters, value: string | number) => setFilters((current) => ({ ...current, [key]: value, page: key === "page" ? Number(value) : 1 }));
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { authRequest<MovementList>(`/api/movements?${query}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setResponse({ key: requestKey, data: result }); }).catch((failure) => { if (!controller.signal.aborted) setResponse({ key: requestKey, error: failure instanceof Error ? failure.message : "Não foi possível carregar as movimentações." }); }); }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, requestKey]);
  return <div className="space-y-6"><PageHeader eyebrow="CONTROLE FÍSICO E RASTREABILIDADE" title="Movimentações" description="Retiradas, devoluções e ocorrências dos equipamentos do UniSALESIANO.">{hasPermission("MOVEMENTS_WRITE") && <Button onClick={() => setCreating(true)}><Plus />Registrar retirada</Button>}</PageHeader><MovementSummaryCards summary={data?.summary} loading={loading} /><div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs leading-relaxed text-blue-800">Reservar não representa retirada física. Somente reservas aprovadas e dentro do período autorizado permitem retiradas. Devoluções em atraso continuam indisponíveis; avarias seguem para manutenção e extravios permanecem bloqueados.</div><section aria-label="Registro de movimentações" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"><div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5"><h2 className="font-semibold text-slate-900">Registro de movimentações</h2>{data && <ResultCount count={data.pagination.total} singular="movimentação" plural="movimentações" gender="feminine" />}</div><div className="space-y-3 p-5 [&_select]:min-w-0 [&_select]:max-w-full"><div className="flex flex-col gap-3 md:flex-row md:flex-wrap"><SearchField value={filters.q} onChange={(value) => change("q", value)} placeholder="Buscar equipamento, evento, destino ou patrimônio..." /><FilterSelect label="Status da movimentação" value={filters.status} onChange={(value) => change("status", value)} options={[{ value: "", label: "Todos os status" }, ...Object.entries(movementStatusLabels).map(([value, label]) => ({ value, label }))]} /><FilterSelect label="Movimentações por página" value={String(filters.pageSize)} onChange={(value) => change("pageSize", Number(value))} options={[{ value: "6", label: "6 por página" }, { value: "12", label: "12 por página" }, { value: "24", label: "24 por página" }]} /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><FilterSelect label="Evento da movimentação" value={filters.eventId} onChange={(value) => change("eventId", value)} options={[{ value: "", label: "Todos os eventos" }, ...events.map((entry) => ({ value: entry.id, label: entry.title }))]} /><FilterSelect label="Equipamento da movimentação" value={filters.equipmentId} onChange={(value) => change("equipmentId", value)} options={[{ value: "", label: "Todos os equipamentos" }, ...equipment.map((entry) => ({ value: entry.id, label: entry.name }))]} /><Input aria-label="Filtrar responsável pela retirada" placeholder="Responsável pela retirada" value={filters.responsible} onChange={(event) => change("responsible", event.target.value)} /><div><label htmlFor="movements-from" className="mb-1.5 block text-xs text-slate-500">Retiradas a partir de</label><Input id="movements-from" type="date" value={filters.from} onChange={(event) => change("from", event.target.value)} /></div><div><label htmlFor="movements-to" className="mb-1.5 block text-xs text-slate-500">Retiradas até</label><Input id="movements-to" type="date" value={filters.to} onChange={(event) => change("to", event.target.value)} /></div><div className="flex items-end"><Button variant="ghost" size="sm" onClick={() => setFilters({ q: "", eventId: "", equipmentId: "", responsible: "", from: "", to: "", status: "", page: 1, pageSize: 6 })}>Limpar filtros</Button></div></div></div>{loading ? <p role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Carregando movimentações…</p> : error ? <div className="p-5"><InventoryError message={error} onRetry={() => setRevision((value) => value + 1)} /></div> : data?.items.length ? <MovementsTable items={data.items} /> : <div className="p-8"><EmptyState title="Nenhuma movimentação encontrada" description="As retiradas registradas a partir de reservas aprovadas aparecerão aqui. Confira os filtros ou registre uma retirada autorizada." /></div>}{data && <InventoryPagination pagination={data.pagination} disabled={loading} label="movimentações" onChange={(page) => change("page", page)} />}<p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Histórico persistido e auditado · Horário de Brasília · America/Sao_Paulo</p></section>{creating && <WithdrawalForm onClose={() => setCreating(false)} onSaved={(movement) => { setCreating(false); setRevision((value) => value + 1); void refresh(); router.push(`/movimentacoes/${movement.id}`); }} />}</div>;
}
