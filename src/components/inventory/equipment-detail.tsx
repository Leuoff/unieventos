"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CalendarClock, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { useInventory } from "@/components/providers/inventory-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { ReservationsPanel } from "@/components/requests/reservations-panel";
import { MovementsPanel } from "@/components/movements/movements-panel";
import { DetailItem } from "@/components/modules/module-controls";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime, formatNumber } from "@/lib/format";
import { inventoryRequest } from "@/lib/inventory-client";
import type { EquipmentDetail } from "@/types/inventory";
import { EquipmentForm } from "./equipment-form";
import { InventoryError, InventoryPagination, StockLevels, unitStatusLabels } from "./inventory-controls";

export function EquipmentDetailView({ id, compact = false, onChanged, onDeleted }: { id: string; compact?: boolean; onChanged?: () => void; onDeleted?: () => void }) {
  const { refresh, notify } = useInventory();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("INVENTORY_WRITE");
  const [historyPage, setHistoryPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; data?: EquipmentDetail; error?: string }>({ key: "" });
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const requestKey = `${id}:${historyPage}:${revision}`;
  const detail = response.key === requestKey ? response.data : undefined;
  const error = response.key === requestKey ? response.error : undefined;
  const loading = response.key !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await inventoryRequest<EquipmentDetail>(`/api/equipment/${encodeURIComponent(id)}?historyPage=${historyPage}`, { signal: controller.signal });
        if (!controller.signal.aborted) setResponse({ key: requestKey, data });
      } catch (failure) {
        if (!controller.signal.aborted) setResponse({ key: requestKey, error: failure instanceof Error ? failure.message : "Não foi possível carregar este equipamento." });
      }
    }
    void load();
    return () => controller.abort();
  }, [id, historyPage, requestKey]);

  async function remove() {
    if (!detail || deleting || !detail.canDelete || !canWrite) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const result = await inventoryRequest<{ archived: boolean }>(`/api/equipment/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ version: detail.equipment.version }) });
      notify(result.archived ? "Equipamento arquivado com sucesso. O histórico foi preservado." : "Equipamento excluído com sucesso.");
      void refresh();
      setConfirming(false);
      onChanged?.();
      onDeleted?.();
    } catch (failure) { setDeleteError(failure instanceof Error ? failure.message : "Não foi possível excluir o equipamento."); }
    finally { setDeleting(false); }
  }

  if (loading) return <p role="status" className="flex items-center gap-2 py-8 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" /> Carregando equipamento…</p>;
  if (error || !detail) return <InventoryError message={error ?? "Equipamento não encontrado."} onRetry={() => setRevision((value) => value + 1)} />;
  const { equipment, history, historyPagination } = detail;

  return <div className="space-y-6">
    {!compact && <><Button variant="ghost" size="sm" asChild><Link href="/estoque"><ArrowLeft /> Voltar ao estoque</Link></Button><PageHeader eyebrow="RECURSOS DO CAMPUS" title={equipment.name} description="Cadastro, posição atual das unidades e histórico do equipamento." /></>}
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{equipment.category}</Badge><Badge variant="outline">{equipment.trackingMode === "INDIVIDUAL" ? "Por patrimônio" : "Por quantidade"}</Badge>{equipment.archivedAt && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Arquivado</Badge>}</div>
      <div className="flex flex-wrap gap-2">{compact && <Button variant="ghost" size="sm" asChild><Link href={`/estoque/${encodeURIComponent(id)}`}>Página completa <ArrowUpRight /></Link></Button>}{!equipment.archivedAt && canWrite && <><Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil /> Editar equipamento</Button><Button variant="outline" size="sm" className="text-rose-600 hover:text-rose-700" disabled={!detail.canDelete} title={detail.deleteBlockedReason ?? undefined} onClick={() => { setDeleteError(""); setConfirming(true); }}><Trash2 /> Excluir equipamento</Button></>}</div>
    </div>
    {detail.deleteBlockedReason && !equipment.archivedAt && canWrite && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">{detail.deleteBlockedReason}</p>}
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs" aria-label="Informações do equipamento">
      <h2 className="mb-4 text-sm font-semibold text-slate-900">Informações do equipamento</h2>
      <dl className="grid gap-5 sm:grid-cols-2"><DetailItem label="Nome">{equipment.name}</DetailItem><DetailItem label="Local de armazenamento">{equipment.location}</DetailItem><div className="sm:col-span-2"><DetailItem label="Descrição"><span className="whitespace-pre-wrap break-words">{equipment.description || "Sem descrição informada."}</span></DetailItem></div><DetailItem label="Cadastrado em">{formatDateTime(equipment.createdAt)}</DetailItem><DetailItem label="Última atualização">{formatDateTime(equipment.updatedAt)}</DetailItem>{equipment.archivedAt && <DetailItem label="Arquivado em">{formatDateTime(equipment.archivedAt)}</DetailItem>}</dl>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs" aria-label="Posição do estoque"><h2 className="mb-4 text-sm font-semibold text-slate-900">Posição do estoque</h2><dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">{[{ label: "Total", value: equipment.total }, { label: "Disponíveis", value: equipment.available }, { label: "Reservados", value: equipment.reserved }, { label: "Em uso", value: equipment.inUse }, { label: "Em manutenção", value: equipment.maintenance }, { label: "Extraviados", value: equipment.lost }].map((item) => <div key={item.label}><dt className="text-xs text-slate-500">{item.label}</dt><dd className="mt-1 text-xl font-semibold text-slate-900">{formatNumber(item.value)}</dd></div>)}</dl><StockLevels equipment={equipment} /></section>
    {equipment.trackingMode === "INDIVIDUAL" && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs" aria-label="Patrimônios do equipamento"><h2 className="p-5 text-sm font-semibold text-slate-900">Patrimônios <span className="ml-1 font-normal text-slate-500">({equipment.units.length})</span></h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-y border-slate-100 bg-slate-50"><tr><th scope="col" className="px-5 py-3 text-xs font-medium text-slate-500">Número de patrimônio</th><th scope="col" className="px-5 py-3 text-xs font-medium text-slate-500">Estado atual</th></tr></thead><tbody className="divide-y divide-slate-100">{equipment.units.map((unit) => <tr key={unit.id}><td className="px-5 py-3 font-medium text-slate-800"><Link href={`/estoque/patrimonios/${unit.id}`} className="text-blue-700 hover:underline">{unit.assetNumber}</Link></td><td className="px-5 py-3"><Badge variant="secondary">{unitStatusLabels[unit.status]}</Badge></td></tr>)}</tbody></table></div></section>}
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs" aria-label="Histórico do equipamento"><div className="flex items-center gap-2 p-5"><CalendarClock className="size-4 text-slate-500" /><h2 className="text-sm font-semibold text-slate-900">Histórico do equipamento</h2></div>{history.length ? <ol className="divide-y divide-slate-100">{history.map((entry) => <li key={entry.id} className="px-5 py-4"><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{entry.description}</p><time dateTime={entry.createdAt} className="mt-1 block text-xs text-slate-500">{formatDateTime(entry.createdAt)}</time></li>)}</ol> : <p className="px-5 pb-5 text-sm text-slate-500">Nenhum registro de histórico disponível.</p>}<InventoryPagination pagination={historyPagination} onChange={setHistoryPage} label="registros" /></section>
    <ReservationsPanel key={`reservations-${id}-${revision}`} equipmentId={id} />
    <MovementsPanel key={`movements-${id}-${revision}`} equipmentId={id} />
    {editing && canWrite && <EquipmentForm key={`${equipment.id}-${equipment.version}`} equipment={equipment} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setHistoryPage(1); setRevision((value) => value + 1); onChanged?.(); }} />}
    <Dialog open={confirming} onOpenChange={(open) => { if (!deleting) setConfirming(open); }}><DialogContent onEscapeKeyDown={(event) => { if (deleting) event.preventDefault(); }} onPointerDownOutside={(event) => { if (deleting) event.preventDefault(); }}><DialogHeader><DialogTitle>Excluir equipamento</DialogTitle><DialogDescription>Deseja excluir “{equipment.name}” do estoque ativo? O cadastro será arquivado e seu histórico será preservado. Equipamentos com reservas ou movimentações ativas não podem ser excluídos.</DialogDescription></DialogHeader>{deleteError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{deleteError}</p>}<DialogFooter><Button variant="outline" disabled={deleting} onClick={() => setConfirming(false)}>Cancelar</Button><Button variant="destructive" disabled={deleting} onClick={() => void remove()}>{deleting && <LoaderCircle className="animate-spin" />}{deleting ? "Excluindo…" : "Confirmar exclusão"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
