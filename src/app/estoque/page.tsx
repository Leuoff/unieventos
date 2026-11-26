"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Boxes, Check, LoaderCircle, Plus } from "lucide-react";
import { useInventory } from "@/components/providers/inventory-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { EquipmentForm } from "@/components/inventory/equipment-form";
import { EquipmentDetailView } from "@/components/inventory/equipment-detail";
import { InventoryError, InventoryPagination, InventorySummaryCards, StockLevels } from "@/components/inventory/inventory-controls";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FilterSelect, SearchField } from "@/components/modules/module-controls";
import { formatNumber } from "@/lib/format";
import { inventoryRequest } from "@/lib/inventory-client";
import type { EquipmentList } from "@/types/inventory";

export default function InventoryPage() {
  const { summary } = useInventory();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("INVENTORY_WRITE");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState({ q: "", category: "", availability: "", trackingMode: "", status: "active", page: 1, pageSize: 6 });
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; data?: EquipmentList; error?: string }>({ key: "" });
  const [creating, setCreating] = useState(false);
  const selectedId = searchParams.get("item");
  const requestQuery = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)])).toString();
  const requestKey = `${requestQuery}:${revision}`;
  const data = response.key === requestKey && !response.error ? response.data : undefined;
  const error = response.key === requestKey ? response.error : undefined;
  const loading = response.key !== requestKey;
  const categories = response.data?.categories ?? [];
  const hasFilters = !!(filters.q || filters.category || filters.availability || filters.trackingMode);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const result = await inventoryRequest<EquipmentList>(`/api/equipment?${requestQuery}`, { signal: controller.signal });
        if (!controller.signal.aborted) setResponse({ key: requestKey, data: result });
      } catch (failure) {
        if (!controller.signal.aborted) setResponse((current) => ({ key: requestKey, data: current.data, error: failure instanceof Error ? failure.message : "Não foi possível carregar o estoque." }));
      }
    }, 200);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [requestKey, requestQuery]);

  function filter(key: "q" | "category" | "availability" | "trackingMode" | "status", value: string) { setFilters((current) => ({ ...current, [key]: value, page: 1 })); }
  function clearFilters() { setFilters((current) => ({ ...current, q: "", category: "", availability: "", trackingMode: "", page: 1 })); }
  function reload() { setRevision((value) => value + 1); }

  return <div className="space-y-6">
    <PageHeader eyebrow="RECURSOS DO CAMPUS" title="Estoque" description="Visibilidade de cada equipamento, da reserva à devolução.">{canWrite && <Button onClick={() => setCreating(true)}><Plus /> Novo equipamento</Button>}</PageHeader>
    {!canWrite && <p className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs leading-relaxed text-blue-800">O estoque é compartilhado entre os setores. Sua conta pode consultar equipamentos, disponibilidade e reservas. Alterações no cadastro exigem permissão específica.</p>}
    <InventorySummaryCards summary={data?.summary ?? summary} loading={loading} />
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs" aria-label="Inventário de equipamentos">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5"><h2 className="font-semibold text-slate-900">Inventário de equipamentos</h2><p className="text-xs text-slate-500">{data ? `${formatNumber(data.pagination.total)} tipos de equipamentos ${filters.status === "archived" ? "arquivados" : "encontrados"}` : "Consultando inventário"}</p></div>
      <div className="space-y-3 border-b border-slate-100 p-5 [&_select]:min-w-0 [&_select]:max-w-full"><div className="flex flex-col gap-3 md:flex-row md:flex-wrap"><SearchField value={filters.q} onChange={(value) => filter("q", value)} placeholder="Buscar equipamento, patrimônio ou localização..." /><FilterSelect label="Categoria do equipamento" value={filters.category} onChange={(value) => filter("category", value)} options={[{ value: "", label: "Todas as categorias" }, ...categories.map((value) => ({ value, label: value }))]} /><FilterSelect label="Disponibilidade do equipamento" value={filters.availability} onChange={(value) => filter("availability", value)} options={[{ value: "", label: "Qualquer disponibilidade" }, { value: "available", label: "Com unidades disponíveis" }, { value: "unavailable", label: "Sem unidades disponíveis" }, { value: "lost", label: "Com extravios" }, { value: "conflict", label: "Com conflito físico" }]} /></div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap"><FilterSelect label="Modo de controle do equipamento" value={filters.trackingMode} onChange={(value) => filter("trackingMode", value)} options={[{ value: "", label: "Todos os modos de controle" }, { value: "QUANTITY", label: "Por quantidade" }, { value: "INDIVIDUAL", label: "Por patrimônio" }]} /><FilterSelect label="Situação do equipamento" value={filters.status} onChange={(value) => filter("status", value)} options={[{ value: "active", label: "Equipamentos ativos" }, { value: "archived", label: "Equipamentos arquivados" }]} /><FilterSelect label="Equipamentos por página" value={String(filters.pageSize)} onChange={(value) => setFilters((current) => ({ ...current, pageSize: Number(value), page: 1 }))} options={[{ value: "6", label: "6 por página" }, { value: "12", label: "12 por página" }, { value: "24", label: "24 por página" }]} />{hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>Limpar filtros</Button>}</div>
      </div>
      {loading ? <p role="status" className="flex min-h-60 items-center justify-center gap-2 p-8 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" /> Carregando estoque…</p> : error ? <div className="p-5"><InventoryError message={error} onRetry={reload} /></div> : data?.items.length ? <div className="grid gap-4 p-5 md:grid-cols-2 2xl:grid-cols-3">{data.items.map((item) => <article key={item.id} className="min-w-0 rounded-xl border border-slate-200 p-5 transition hover:border-blue-200">
        <div className="flex items-start justify-between gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Boxes className="size-5" aria-hidden="true" /></span><Badge variant="secondary" className="max-w-[75%] break-words whitespace-normal text-right">{item.category}</Badge></div>
        <h3 className="mt-4 break-words font-semibold text-slate-900">{item.name}</h3><p className="mt-1 break-words text-xs text-slate-500">{item.location}</p><p className="mt-2 text-[11px] text-slate-400">{item.trackingMode === "INDIVIDUAL" ? "Controle por patrimônio" : "Controle por quantidade"}{item.archivedAt ? " · Arquivado" : ""}</p>
        <div className="mt-5 flex items-end justify-between gap-2"><p className="text-2xl font-semibold text-slate-900">{formatNumber(item.available)}<span className="ml-1 text-sm font-normal text-slate-500">/ {formatNumber(item.total)}</span></p><p className={`flex items-center gap-1 text-xs font-medium ${item.available ? "text-emerald-600" : "text-amber-600"}`}>{item.available > 0 && <Check className="size-3" />} {item.available ? "disponíveis" : "indisponível"}</p></div>
        <StockLevels equipment={item} /><Button className="mt-5 w-full" variant="outline" size="sm" onClick={() => router.push(`/estoque?item=${encodeURIComponent(item.id)}`, { scroll: false })} aria-label={`Consultar ${item.name}`}>Consultar equipamento</Button>
      </article>)}</div> : <div className="p-5"><EmptyState title={hasFilters ? "Nenhum equipamento encontrado" : filters.status === "archived" ? "Nenhum equipamento arquivado" : "Seu estoque começa aqui"} description={hasFilters ? "Ajuste sua busca ou os filtros para consultar o inventário." : filters.status === "archived" ? "Equipamentos removidos do estoque ativo aparecerão aqui com o histórico preservado." : canWrite ? "Cadastre o primeiro equipamento para acompanhar suas unidades, disponibilidade e histórico." : "Ainda não há equipamentos cadastrados. A administração pode cadastrar os recursos compartilhados."} /><div className="mb-6 text-center">{hasFilters ? <Button variant="outline" size="sm" onClick={clearFilters}>Limpar filtros</Button> : filters.status === "active" && canWrite && <Button onClick={() => setCreating(true)}><Plus /> Novo equipamento</Button>}</div></div>}
      {data && <InventoryPagination pagination={data.pagination} onChange={(page) => setFilters((current) => ({ ...current, page }))} disabled={loading} />}
    </section>
    {creating && canWrite && <EquipmentForm categories={categories} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); setFilters((current) => ({ ...current, status: "active", page: 1 })); reload(); }} />}
    <Dialog open={!!selectedId} onOpenChange={(open) => { if (!open) router.replace("/estoque", { scroll: false }); }}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>Detalhes do equipamento</DialogTitle><DialogDescription>Informações, posição do estoque e histórico de alterações.</DialogDescription></DialogHeader>{selectedId && <EquipmentDetailView key={selectedId} id={selectedId} compact onChanged={reload} onDeleted={() => router.replace("/estoque", { scroll: false })} />}</DialogContent></Dialog>
  </div>;
}
