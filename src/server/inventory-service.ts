import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { normalizeSearch } from "@/lib/inventory-validation";
import { InventoryError } from "@/server/inventory-error";
import { getPrisma } from "@/server/prisma";
import { requireActor, requireActorInTransaction } from "@/server/auth-context";
import { isTransactionConflict, waitForTransactionRetry } from "@/server/transaction-conflict";
import type { EquipmentDetail, EquipmentInput, EquipmentList, InventoryEquipment, InventoryOverview, InventorySummary } from "@/types/inventory";

const equipmentInclude = {
  units: { include: { _count: { select: { reservationUnits: true, withdrawalUnits: true } } }, orderBy: { assetNumber: "asc" } },
  reservations: { include: { units: true } },
  withdrawals: { include: { units: true } },
} satisfies Prisma.EquipmentInclude;

type EquipmentRecord = Prisma.EquipmentGetPayload<{ include: typeof equipmentInclude }>;
type Transaction = Prisma.TransactionClient;

function remainingReservation(record: EquipmentRecord, reservationId: string, quantity: number) {
  const withdrawn = record.withdrawals.filter((withdrawal) => withdrawal.reservationId === reservationId).reduce((sum, withdrawal) => sum + withdrawal.quantity, 0);
  return Math.max(0, quantity - withdrawn);
}

function equipmentDto(record: EquipmentRecord, now: Date): InventoryEquipment {
  const withdrawnUnitIds = new Set(record.withdrawals.flatMap((withdrawal) => withdrawal.units.filter((unit) => unit.returnedAt === null && unit.lostAt === null).map((unit) => unit.unitId)));
  const currentReservations = record.reservations.filter((reservation) => reservation.status === "ACTIVE" && reservation.startsAt <= now && reservation.endsAt > now);
  const reservedUnitIds = new Set(currentReservations.flatMap((reservation) => {
    const fulfilled = new Set(record.withdrawals.filter((withdrawal) => withdrawal.reservationId === reservation.id).flatMap((withdrawal) => withdrawal.units.map((unit) => unit.unitId)));
    return reservation.units.filter((unit) => !fulfilled.has(unit.unitId)).map((unit) => unit.unitId);
  }));
  const total = record.trackingMode === "INDIVIDUAL" ? record.units.length : record.total;
  const maintenance = record.trackingMode === "INDIVIDUAL" ? record.units.filter((unit) => unit.state === "MAINTENANCE").length : record.maintenance;
  const lost = record.trackingMode === "INDIVIDUAL" ? record.units.filter((unit) => unit.state === "LOST").length : record.lost;
  const inUse = record.withdrawals.reduce((sum, withdrawal) => sum + Math.max(0, withdrawal.quantity - withdrawal.returnedQuantity - withdrawal.lostQuantity), 0);
  const reserved = currentReservations.reduce((sum, reservation) => sum + remainingReservation(record, reservation.id, reservation.quantity), 0);
  // Atrasos e ocorrências são fatos físicos. Exponha a falta para regularização,
  // sem esconder o inventário nem converter compromissos em saldo negativo.
  const balance = total - maintenance - lost - inUse - reserved;
  const available = Math.max(0, balance);
  const conflictQuantity = Math.max(0, -balance);
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    description: record.description,
    location: record.location,
    trackingMode: record.trackingMode,
    total, available, reserved, inUse, maintenance, lost, conflictQuantity,
    units: record.units.map((unit) => ({ id: unit.id, assetNumber: unit.assetNumber, status: unit.state === "LOST" ? "LOST" : withdrawnUnitIds.has(unit.id) ? "IN_USE" : unit.state === "MAINTENANCE" ? "MAINTENANCE" : reservedUnitIds.has(unit.id) ? "RESERVED" : "AVAILABLE" })),
    version: record.version,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function summarize(items: InventoryEquipment[]): InventorySummary {
  return items.reduce((summary, item) => ({ totalTypes: summary.totalTypes + 1, total: summary.total + item.total, available: summary.available + item.available, reserved: summary.reserved + item.reserved, inUse: summary.inUse + item.inUse, maintenance: summary.maintenance + item.maintenance, lost: summary.lost + item.lost, conflictQuantity: summary.conflictQuantity + item.conflictQuantity }), { totalTypes: 0, total: 0, available: 0, reserved: 0, inUse: 0, maintenance: 0, lost: 0, conflictQuantity: 0 });
}

function positiveInteger(value: string | null, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export async function listEquipment(params: URLSearchParams): Promise<EquipmentList> {
  await requireActor();
  const now = new Date();
  const records = await getPrisma().equipment.findMany({ include: equipmentInclude, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const all = records.map((record) => ({ record, item: equipmentDto(record, now) }));
  const summary = summarize(all.filter(({ record }) => record.archivedAt === null).map(({ item }) => item));
  const categories = [...new Set(records.map((record) => record.category))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const query = normalizeSearch(params.get("q") ?? "");
  const category = params.get("category");
  const trackingMode = params.get("trackingMode");
  const archived = params.get("status") === "archived";
  const availability = (params.get("availability") ?? "all").replace(/[_-]/g, "").toLowerCase();
  const filtered = all.filter(({ record, item }) => {
    if ((record.archivedAt !== null) !== archived) return false;
    if (query && !record.searchText.includes(query)) return false;
    if (category && category !== "all" && item.category !== category) return false;
    if (trackingMode && trackingMode !== "all" && item.trackingMode !== trackingMode) return false;
    if (availability === "available") return item.available > 0;
    if (availability === "reserved") return item.reserved > 0;
    if (availability === "inuse") return item.inUse > 0;
    if (availability === "maintenance") return item.maintenance > 0;
    if (availability === "lost") return item.lost > 0;
    if (availability === "conflict") return item.conflictQuantity > 0;
    if (availability === "unavailable") return item.available === 0;
    return true;
  });
  const requestedSize = positiveInteger(params.get("pageSize"), 12);
  const pageSize = [6, 12, 24].includes(requestedSize) ? requestedSize : 12;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(positiveInteger(params.get("page"), 1), totalPages);
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize).map(({ item }) => item), summary, categories, pagination: { page, pageSize, total: filtered.length, totalPages } };
}

export async function overviewEquipment(): Promise<InventoryOverview> {
  await requireActor();
  const now = new Date();
  const records = await getPrisma().equipment.findMany({ where: { archivedAt: null }, include: equipmentInclude, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const items = records.map((record) => equipmentDto(record, now));
  return { summary: summarize(items), items: items.slice(0, 1000) };
}

/** Consulta somente leitura para necessidades preliminares; não cria alocações. */
export async function lookupEquipment(query: string, limit = 2000) {
  await requireActor();
  const rows = await getPrisma().equipment.findMany({ where: { archivedAt: null, ...(query.trim() ? { searchText: { contains: normalizeSearch(query) } } : {}) }, include: equipmentInclude, orderBy: [{ name: "asc" }, { id: "asc" }], take: limit + 1 });
  const now = new Date();
  return { items: rows.slice(0, limit).map((row) => equipmentDto(row, now)), limitReached: rows.length > limit };
}

function deletionBlockedReason(record: EquipmentRecord, now: Date) {
  if (record.archivedAt) return "Este equipamento já foi arquivado.";
  if (record.reservations.some((reservation) => reservation.status === "ACTIVE" && reservation.endsAt > now)) return "Existem reservas ativas vinculadas a este equipamento.";
  if (record.withdrawals.some((withdrawal) => withdrawal.quantity > withdrawal.returnedQuantity + withdrawal.lostQuantity)) return "Existem retiradas com devolução ou regularização pendente para este equipamento.";
  const maintenance = record.trackingMode === "INDIVIDUAL" ? record.units.filter((unit) => unit.state === "MAINTENANCE").length : record.maintenance;
  if (maintenance > 0) return "Conclua a manutenção de todas as unidades antes de arquivar o equipamento.";
  return null;
}

export async function getEquipmentDetail(id: string, historyPage = 1): Promise<EquipmentDetail> {
  const actor = await requireActor();
  return getPrisma().$transaction(async (transaction) => {
    const record = await transaction.equipment.findUnique({ where: { id }, include: equipmentInclude });
    if (!record) throw new InventoryError(404, "Equipamento não encontrado.");
    const historyTotal = await transaction.stockHistory.count({ where: { equipmentId: id } });
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(historyTotal / pageSize));
    const page = Math.min(Number.isSafeInteger(historyPage) && historyPage > 0 ? historyPage : 1, totalPages);
    const history = await transaction.stockHistory.findMany({ where: { equipmentId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize });
    const now = new Date();
    const blockedReason = deletionBlockedReason(record, now);
    return { equipment: equipmentDto(record, now), history: history.map((entry) => ({ id: entry.id, action: entry.action, description: entry.description, actorUserId: entry.actorUserId, createdAt: entry.createdAt.toISOString() })), historyPagination: { page, pageSize, total: historyTotal, totalPages }, canDelete: actor.permissions.includes("INVENTORY_WRITE") && blockedReason === null, deleteBlockedReason: actor.permissions.includes("INVENTORY_WRITE") ? blockedReason : "Sua conta possui acesso somente à consulta do estoque." };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 });
}

async function serializable<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await getPrisma().$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
    } catch (error) {
      if (isTransactionConflict(error) && attempt < 4) { await waitForTransactionRetry(attempt); continue; }
      if (isTransactionConflict(error)) throw new InventoryError(409, "O estoque foi alterado simultaneamente. Atualize a página e tente novamente.");
      throw error;
    }
  }
  throw new InventoryError(409, "Não foi possível concluir a alteração. Tente novamente.");
}

function searchText(input: EquipmentInput) {
  return normalizeSearch([input.name, input.category, input.description, input.location, ...input.units.map((unit) => unit.assetNumber)].join(" "));
}

function snapshot(item: InventoryEquipment) {
  return { name: item.name, category: item.category, description: item.description, location: item.location, trackingMode: item.trackingMode, total: item.total, available: item.available, reserved: item.reserved, inUse: item.inUse, maintenance: item.maintenance, lost: item.lost, conflictQuantity: item.conflictQuantity, units: item.units.map((unit) => ({ id: unit.id, assetNumber: unit.assetNumber, status: unit.status })), version: item.version, archivedAt: item.archivedAt };
}

function physicalState(status: string): "AVAILABLE" | "MAINTENANCE" {
  if (status !== "AVAILABLE" && status !== "MAINTENANCE") throw new InventoryError(422, "Reservas, retiradas e extravios não podem ser criados pelo cadastro de equipamentos.", { units: "Cadastre novas unidades como disponíveis ou em manutenção." });
  return status;
}

export async function createEquipment(input: EquipmentInput): Promise<InventoryEquipment> {
  const identity = await requireActor("INVENTORY_WRITE");
  if (input.units.some((unit) => unit.id)) throw new InventoryError(422, "Não informe identificadores de unidades em um novo cadastro.", { units: "Novas unidades recebem identificação automaticamente." });
  const units = input.units.map((unit) => ({ assetNumber: unit.assetNumber, state: physicalState(unit.status) }));
  return serializable(async (transaction) => {
    const actor = await requireActorInTransaction(transaction, "INVENTORY_WRITE", identity);
    const record = await transaction.equipment.create({ data: { name: input.name, category: input.category, description: input.description, location: input.location, searchText: searchText(input), trackingMode: input.trackingMode, total: input.trackingMode === "INDIVIDUAL" ? units.length : input.total, maintenance: input.trackingMode === "INDIVIDUAL" ? units.filter((unit) => unit.state === "MAINTENANCE").length : input.maintenance, units: { create: units } }, include: equipmentInclude });
    const equipment = equipmentDto(record, new Date());
    await transaction.stockHistory.create({ data: { equipmentId: record.id, action: "CADASTRO", description: "Equipamento cadastrado no estoque.", actorUserId: actor.id, after: snapshot(equipment) } });
    return equipment;
  });
}

/** Calcula a demanda simultânea, respeitando intervalos semiabertos [início, fim). */
function futureReservationPeak(record: EquipmentRecord, now: Date) {
  const changes = new Map<number, number>();
  for (const reservation of record.reservations) {
    if (reservation.status !== "ACTIVE" || reservation.endsAt <= now) continue;
    const quantity = remainingReservation(record, reservation.id, reservation.quantity);
    if (quantity === 0) continue;
    const start = Math.max(now.getTime(), reservation.startsAt.getTime());
    const end = reservation.endsAt.getTime();
    if (end <= start) continue;
    changes.set(start, (changes.get(start) ?? 0) + quantity);
    changes.set(end, (changes.get(end) ?? 0) - quantity);
  }
  let current = 0;
  let peak = 0;
  for (const [, change] of [...changes.entries()].sort(([a], [b]) => a - b)) {
    current += change;
    peak = Math.max(peak, current);
  }
  return peak;
}

function validateCapacity(record: EquipmentRecord, input: EquipmentInput, now: Date) {
  const inUse = record.withdrawals.reduce((sum, withdrawal) => sum + Math.max(0, withdrawal.quantity - withdrawal.returnedQuantity - withdrawal.lostQuantity), 0);
  const lost = record.trackingMode === "INDIVIDUAL" ? record.units.filter((unit) => unit.state === "LOST").length : record.lost;
  const required = input.maintenance + lost + inUse + futureReservationPeak(record, now);
  if (input.total < required) throw new InventoryError(409, "A quantidade informada compromete unidades em manutenção, extraviadas, retiradas ou reservadas no mesmo período.", { total: `Mantenha ao menos ${required} unidades para atender os vínculos existentes.`, maintenance: "A manutenção deve preservar a capacidade das reservas e retiradas." });
}

function validateUnitChanges(record: EquipmentRecord, input: EquipmentInput, now: Date) {
  const existing = new Map(record.units.map((unit) => [unit.id, unit]));
  const current = new Map(equipmentDto(record, now).units.map((unit) => [unit.id, unit]));
  const busy = new Set([
    ...record.reservations.filter((reservation) => reservation.status === "ACTIVE" && reservation.endsAt > now).flatMap((reservation) => {
      const fulfilled = new Set(record.withdrawals.filter((withdrawal) => withdrawal.reservationId === reservation.id).flatMap((withdrawal) => withdrawal.units.map((unit) => unit.unitId)));
      return reservation.units.filter((unit) => !fulfilled.has(unit.unitId)).map((unit) => unit.unitId);
    }),
    ...record.withdrawals.flatMap((withdrawal) => withdrawal.units.filter((unit) => unit.returnedAt === null && unit.lostAt === null).map((unit) => unit.unitId)),
  ]);
  const submitted = new Set(input.units.flatMap((unit) => unit.id ? [unit.id] : []));
  for (const unit of record.units) {
    if (submitted.has(unit.id)) continue;
    if (unit.state === "LOST") throw new InventoryError(409, `O patrimônio ${unit.assetNumber} está extraviado.`, { units: "Preserve a identificação e o histórico de patrimônios extraviados." });
    if (busy.has(unit.id)) throw new InventoryError(409, `O patrimônio ${unit.assetNumber} possui reserva ativa ou retirada pendente.`, { units: "Não remova patrimônios com movimentações ativas." });
    if (unit._count.reservationUnits || unit._count.withdrawalUnits) throw new InventoryError(409, `O patrimônio ${unit.assetNumber} possui histórico de movimentações.`, { units: "Preserve patrimônios já utilizados em reservas ou retiradas." });
  }
  return input.units.map((unit, index) => {
    if (!unit.id) return { ...unit, state: physicalState(unit.status) };
    const previous = existing.get(unit.id);
    if (!previous) throw new InventoryError(422, "Uma unidade informada não pertence a este equipamento.", { [`units.${index}.id`]: "Reabra o equipamento e revise suas unidades." });
    if (previous.state === "LOST") {
      if (unit.assetNumber !== previous.assetNumber || unit.status !== "LOST") throw new InventoryError(409, `O patrimônio ${previous.assetNumber} está extraviado e não pode ser recuperado pelo cadastro.`, { [`units.${index}.status`]: "Preserve o estado e a identificação; a recuperação exige um fluxo auditado específico." });
      return { ...unit, state: previous.state };
    }
    const previousStatus = current.get(unit.id)!.status;
    if (busy.has(unit.id) && (previous.assetNumber !== unit.assetNumber || previousStatus !== unit.status)) throw new InventoryError(409, `O patrimônio ${previous.assetNumber} possui reserva ativa ou retirada pendente.`, { [`units.${index}.status`]: "Mantenha o patrimônio e a condição da unidade enquanto houver vínculos ativos." });
    if (unit.status === "RESERVED" || unit.status === "IN_USE") {
      if (unit.status !== previousStatus || unit.assetNumber !== previous.assetNumber) throw new InventoryError(422, "Reservas e retiradas não podem ser alteradas pelo cadastro.", { [`units.${index}.status`]: "Mantenha a condição atual da unidade." });
      return { ...unit, state: previous.state };
    }
    return { ...unit, state: physicalState(unit.status) };
  });
}

export async function updateEquipment(id: string, input: EquipmentInput): Promise<InventoryEquipment> {
  const identity = await requireActor("INVENTORY_WRITE");
  return serializable(async (transaction) => {
    const actor = await requireActorInTransaction(transaction, "INVENTORY_WRITE", identity);
    const record = await transaction.equipment.findUnique({ where: { id }, include: equipmentInclude });
    if (!record) throw new InventoryError(404, "Equipamento não encontrado.");
    if (record.archivedAt) throw new InventoryError(409, "Equipamentos arquivados não podem ser editados.");
    if (!input.version || record.version !== input.version) throw new InventoryError(409, "Este equipamento foi alterado por outra pessoa. Reabra os detalhes antes de editar.", { version: "Atualize os dados antes de salvar." });
    if (record.trackingMode !== input.trackingMode) throw new InventoryError(422, "O modo de controle não pode ser alterado após o cadastro.", { trackingMode: "Preserve o modo de controle original do equipamento." });
    const now = new Date();
    const before = equipmentDto(record, now);
    const units = validateUnitChanges(record, input, now);
    validateCapacity(record, input, now);
    const updated = await transaction.equipment.updateMany({ where: { id, version: input.version, archivedAt: null }, data: { name: input.name, category: input.category, description: input.description, location: input.location, searchText: searchText(input), total: input.trackingMode === "INDIVIDUAL" ? units.length : input.total, maintenance: input.trackingMode === "INDIVIDUAL" ? units.filter((unit) => unit.state === "MAINTENANCE").length : input.maintenance, version: { increment: 1 } } });
    if (updated.count !== 1) throw new InventoryError(409, "Este equipamento foi alterado simultaneamente. Atualize os dados antes de salvar.");
    const retainedIds = units.flatMap((unit) => unit.id ? [unit.id] : []);
    await transaction.equipmentUnit.deleteMany({ where: { equipmentId: id, id: { notIn: retainedIds } } });
    const previousAssets = new Map(record.units.map((unit) => [unit.id, unit.assetNumber]));
    // Free changing asset numbers inside this transaction before assigning the final values.
    // This permits permutations without exposing temporary names or writing them to history.
    for (const unit of units) {
      if (unit.id && previousAssets.get(unit.id) !== unit.assetNumber) {
        await transaction.equipmentUnit.update({ where: { id: unit.id }, data: { assetNumber: `__UNIEVENTOS_SWAP_${randomUUID()}` } });
      }
    }
    for (const unit of units) {
      if (unit.id) await transaction.equipmentUnit.update({ where: { id: unit.id }, data: { assetNumber: unit.assetNumber, state: unit.state } });
      else await transaction.equipmentUnit.create({ data: { equipmentId: id, assetNumber: unit.assetNumber, state: unit.state } });
    }
    const afterRecord = await transaction.equipment.findUniqueOrThrow({ where: { id }, include: equipmentInclude });
    const equipment = equipmentDto(afterRecord, now);
    await transaction.stockHistory.create({ data: { equipmentId: id, action: "ALTERACAO", description: `Cadastro do equipamento atualizado. Motivo: ${input.reason ?? "Atualização cadastral"}.`, actorUserId: actor.id, before: snapshot(before), after: snapshot(equipment) } });
    return equipment;
  });
}

export async function deleteEquipment(id: string, version: number): Promise<{ archived: boolean }> {
  const identity = await requireActor("INVENTORY_WRITE");
  return serializable(async (transaction) => {
    const actor = await requireActorInTransaction(transaction, "INVENTORY_WRITE", identity);
    const record = await transaction.equipment.findUnique({ where: { id }, include: equipmentInclude });
    if (!record) throw new InventoryError(404, "Equipamento não encontrado.");
    if (record.version !== version) throw new InventoryError(409, "Este equipamento foi alterado por outra pessoa. Atualize os detalhes antes de arquivar.");
    const now = new Date();
    const blockedReason = deletionBlockedReason(record, now);
    if (blockedReason) throw new InventoryError(409, blockedReason);
    const before = equipmentDto(record, now);
    const updated = await transaction.equipment.updateMany({ where: { id, version, archivedAt: null }, data: { archivedAt: now, version: { increment: 1 } } });
    if (updated.count !== 1) throw new InventoryError(409, "Este equipamento foi alterado simultaneamente. Atualize os dados antes de arquivar.");
    await transaction.stockHistory.create({ data: { equipmentId: id, action: "ARQUIVAMENTO", description: "Equipamento arquivado. O cadastro e seu histórico foram preservados.", actorUserId: actor.id, before: snapshot(before), after: snapshot({ ...before, archivedAt: now.toISOString(), version: version + 1 }) } });
    return { archived: true };
  });
}
