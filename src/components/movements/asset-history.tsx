"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { authRequest } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { InventoryError } from "@/components/inventory/inventory-controls";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MovementAudit, MovementInformation } from "./movement-detail";
import type { AssetMovementHistory } from "@/types/movements";

export function AssetHistory({ id }: { id: string }) {
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; data?: AssetMovementHistory; error?: string }>({ key: "" });
  const key = `${id}:${revision}`;
  const data = response.key === key ? response.data : undefined;
  useEffect(() => {
    const controller = new AbortController();
    authRequest<AssetMovementHistory>(`/api/equipment-units/${encodeURIComponent(id)}/history`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setResponse({ key, data: result }); }).catch((failure) => { if (!controller.signal.aborted) setResponse({ key, error: failure instanceof Error ? failure.message : "Histórico indisponível." }); });
    return () => controller.abort();
  }, [id, key]);
  if (response.key !== key) return <p role="status" className="flex items-center gap-2 py-8 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Consultando patrimônio…</p>;
  if (!data) return <InventoryError message={response.error ?? "Patrimônio não encontrado."} onRetry={() => setRevision((value) => value + 1)} />;
  return <div className="space-y-6"><Button asChild variant="ghost" size="sm"><Link href={`/estoque/${data.equipmentId}`}><ArrowLeft />Voltar ao equipamento</Link></Button><PageHeader eyebrow="RASTREABILIDADE DO PATRIMÔNIO" title={`Patrimônio ${data.assetNumber}`} description={`${data.equipmentName} · Histórico de eventos, responsáveis, destinos, devoluções e ocorrências.`} />{data.items.length ? data.items.map((detail) => <article key={detail.movement.id} className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-5"><div className="flex justify-end"><Link href={`/movimentacoes/${detail.movement.id}`} className="text-xs font-medium text-blue-700 hover:underline">Abrir movimentação completa</Link></div>{detail.movement.units.filter((unit) => unit.id === id).map((unit) => <div key={unit.id} className="rounded-lg border border-blue-100 bg-blue-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-blue-900">Situação do patrimônio {data.assetNumber} nesta retirada</p><Badge variant="outline">{{ IN_USE: "Em uso", GOOD: "Devolvido em boas condições", DAMAGED: "Devolvido com avaria", LOST: "Extraviado" }[unit.condition]}</Badge></div>{(unit.returnedAt || unit.lostAt) && <p className="mt-2 text-xs text-blue-800">Registrado em {formatDateTime((unit.returnedAt ?? unit.lostAt)!)}</p>}<p className="mt-2 text-xs text-blue-700">As quantidades e conferências abaixo pertencem à retirada completa, que pode conter outros patrimônios.</p></div>)}<MovementInformation movement={detail.movement} /><MovementAudit detail={detail} /></article>) : <p className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Nenhuma retirada registrada para este patrimônio.</p>}</div>;
}
