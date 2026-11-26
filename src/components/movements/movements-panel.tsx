"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { authRequest } from "@/lib/auth-client";
import { InventoryError, InventoryPagination } from "@/components/inventory/inventory-controls";
import { MovementsTable } from "./movement-controls";
import type { MovementList } from "@/types/movements";

export function MovementsPanel({ eventId, equipmentId, reservationId, requestId }: { eventId?: string; equipmentId?: string; reservationId?: string; requestId?: string }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; data?: MovementList; error?: string }>({ key: "" });
  const query = new URLSearchParams({ ...(eventId ? { eventId } : {}), ...(equipmentId ? { equipmentId } : {}), ...(reservationId ? { reservationId } : {}), ...(requestId ? { requestId } : {}), page: String(page), pageSize: "6" }).toString();
  const key = `${query}:${revision}`;
  const data = response.key === key ? response.data : undefined;
  useEffect(() => {
    const controller = new AbortController();
    authRequest<MovementList>(`/api/movements?${query}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setResponse({ key, data: result }); }).catch((failure) => { if (!controller.signal.aborted) setResponse({ key, error: failure instanceof Error ? failure.message : "Movimentações indisponíveis." }); });
    return () => controller.abort();
  }, [query, key]);
  return <section aria-label="Movimentações físicas vinculadas" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"><div className="flex items-center justify-between gap-3 p-5"><div><h2 className="text-sm font-semibold text-slate-900">Movimentações físicas</h2><p className="mt-1 text-xs text-slate-500">Retiradas, devoluções e ocorrências vinculadas a este cadastro.</p></div><Link href="/movimentacoes" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">Ver módulo<ArrowUpRight className="size-3.5" /></Link></div>{response.key !== key ? <p role="status" className="flex items-center gap-2 px-5 pb-5 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin" />Consultando movimentações…</p> : response.error ? <div className="px-5 pb-5"><InventoryError message={response.error} onRetry={() => setRevision((value) => value + 1)} /></div> : data?.items.length ? <><MovementsTable items={data.items} /><InventoryPagination pagination={data.pagination} label="movimentações vinculadas" onChange={setPage} /></> : <p className="px-5 pb-5 text-sm text-slate-500">Nenhuma retirada registrada para este cadastro.</p>}</section>;
}
