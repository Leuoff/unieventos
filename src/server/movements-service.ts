import "server-only";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/server/prisma";
import { requireActor, requireActorInTransaction } from "@/server/auth-context";
import { InventoryError } from "@/server/inventory-error";
import { isTransactionConflict, waitForTransactionRetry } from "@/server/transaction-conflict";
import { availabilityInclude, calculateRequestAvailability } from "@/server/requests-availability";
import { normalizeSearch } from "@/lib/inventory-validation";
import { institutionalDayRange } from "@/lib/event-time";
import { extensionSchema, settlementSchema, withdrawalSchema } from "@/lib/movements-validation";
import type { AuthUser } from "@/types/auth";
import { movementStatusLabels, type AssetMovementHistory, type ExtensionInput, type MovementChecklist, type MovementDetail, type MovementList, type MovementOverview, type MovementSummary, type PhysicalMovement, type SettlementInput, type WithdrawalInput, type WithdrawalOption } from "@/types/movements";

type Tx = Prisma.TransactionClient;
const include = {
  equipment: true,
  reservation: { include: { requestItem: { include: { request: { include: { event: true } } } } } },
  units: { include: { unit: true }, orderBy: { unitId: "asc" as const } },
  settlements: { include: { units: { include: { unit: true } } }, orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }] },
  history: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }] },
} satisfies Prisma.WithdrawalInclude;
type Record = Prisma.WithdrawalGetPayload<{ include: typeof include }>;
const reservationInclude = { equipment: { include: availabilityInclude }, units: { include: { unit: true } }, withdrawals: { include: { units: true } }, requestItem: { include: { request: { include: { event: true } } } } } satisfies Prisma.ReservationInclude;
type ReservationRecord = Prisma.ReservationGetPayload<{ include: typeof reservationInclude }>;
function uuid(value: string) { if (!z.uuid().safeParse(value).success) throw new InventoryError(400, "Identificação inválida."); return value; }
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new InventoryError(422, "Confira os campos da movimentação.", Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message])));
  return result.data;
}
const pending = (row: { quantity: number; returnedQuantity: number; lostQuantity: number }) => Math.max(0, row.quantity - row.returnedQuantity - row.lostQuantity);
const dueAt = (row: Record) => row.expectedReturnAt ?? row.reservation?.endsAt ?? null;
function checklist(value: Prisma.JsonValue | null): MovementChecklist | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (typeof value.quantityChecked !== "boolean" || typeof value.conditionChecked !== "boolean" || typeof value.accessoriesChecked !== "boolean") return null;
  return { quantityChecked: value.quantityChecked, conditionChecked: value.conditionChecked, accessoriesChecked: value.accessoriesChecked };
}
function settlementChecklist(value: Prisma.JsonValue): MovementChecklist {
  const result = checklist(value);
  if (!result) throw new InventoryError(409, "Uma conferência persistida possui checklist inconsistente. Solicite uma revisão administrativa do registro.");
  return result;
}
async function actorNames(tx: Tx, rows: Record[]) {
  const ids = [...new Set(rows.flatMap((row) => [row.actorUserId, ...row.settlements.map((settlement) => settlement.actorUserId), ...row.history.map((entry) => entry.actorUserId)]).filter((id): id is string => !!id))];
  return new Map((await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((user) => [user.id, user.name]));
}
function dto(row: Record, names: Map<string, string>, now = new Date()): PhysicalMovement {
  const remaining = pending(row);
  const due = dueAt(row);
  const damagedQuantity = row.settlements.reduce((sum, settlement) => sum + settlement.damagedQuantity, 0);
  const settledUnits = new Map(row.settlements.flatMap((settlement) => settlement.units.map((unit) => [unit.unitId, unit.condition] as const)));
  const status = remaining > 0 ? (due && due <= now ? "OVERDUE" : row.returnedQuantity + row.lostQuantity > 0 ? "PARTIAL" : "IN_USE") : row.lostQuantity > 0 ? "LOST" : damagedQuantity > 0 ? "DAMAGED" : "COMPLETED";
  const event = row.reservation?.requestItem?.request.event;
  return {
    id: row.id, equipmentId: row.equipmentId, equipmentName: row.equipment.name, trackingMode: row.equipment.trackingMode,
    reservationId: row.reservationId, eventId: event?.id ?? null, eventTitle: event?.title ?? null,
    quantity: row.quantity, returnedQuantity: row.returnedQuantity, lostQuantity: row.lostQuantity, damagedQuantity, pendingQuantity: remaining,
    responsibleName: row.responsibleName, destination: row.destination, notes: row.notes, checklist: checklist(row.checklist), createdAt: row.createdAt.toISOString(), expectedReturnAt: due?.toISOString() ?? null,
    actorUserId: row.actorUserId, actorName: row.actorUserId ? names.get(row.actorUserId) ?? null : null, version: row.version, status,
    units: row.units.map((unit) => ({ id: unit.unitId, assetNumber: unit.unit.assetNumber, condition: settledUnits.get(unit.unitId) ?? (unit.lostAt ? "LOST" : unit.returnedAt ? "GOOD" : "IN_USE"), returnedAt: unit.returnedAt?.toISOString() ?? null, lostAt: unit.lostAt?.toISOString() ?? null })),
  };
}
function summary(rows: PhysicalMovement[]): MovementSummary {
  return { total: rows.length, inUse: rows.reduce((sum, row) => sum + row.pendingQuantity, 0), pending: rows.filter((row) => row.pendingQuantity > 0).length, overdue: rows.filter((row) => row.status === "OVERDUE").length, damaged: rows.reduce((sum, row) => sum + row.damagedQuantity, 0), lost: rows.reduce((sum, row) => sum + row.lostQuantity, 0) };
}
async function serializable<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await getPrisma().$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 }); }
    catch (error) {
      if (isTransactionConflict(error) && attempt < 4) { await waitForTransactionRetry(attempt); continue; }
      if (isTransactionConflict(error)) throw new InventoryError(409, "O estoque foi alterado simultaneamente. Atualize os dados e tente novamente.");
      throw error;
    }
  }
  throw new InventoryError(409, "Não foi possível concluir a movimentação simultânea.");
}
function snapshot(value: PhysicalMovement): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
async function recordOperation(tx: Tx, actor: AuthUser, row: Record, action: string, description: string, before?: PhysicalMovement) {
  const names = await actorNames(tx, [row]); const result = dto(row, names);
  await tx.movementHistory.create({ data: { withdrawalId: row.id, action, description, actorUserId: actor.id, before: before ? snapshot(before) : undefined, after: snapshot(result) } });
  await tx.stockHistory.create({ data: { equipmentId: row.equipmentId, action, description, actorUserId: actor.id, before: before ? snapshot(before) : undefined, after: snapshot(result) } });
  await tx.auditLog.create({ data: { actorUserId: actor.id, action: `MOVEMENT_${action}`, entityType: "Withdrawal", entityId: row.id, description, before: before ? snapshot(before) : undefined, after: snapshot(result) } });
  return result;
}
async function lockReservation(tx: Tx, reservationId: string) {
  const source = await tx.reservation.findUnique({ where: { id: reservationId }, select: { equipmentId: true, requestItem: { select: { request: { select: { id: true, eventId: true } } } } } });
  if (!source) throw new InventoryError(404, "Reserva não encontrada.");
  const request = source.requestItem?.request;
  if (request) {
    await tx.$queryRaw`SELECT "id" FROM "CalendarEvent" WHERE "id" = ${request.eventId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "EquipmentRequest" WHERE "id" = ${request.id}::uuid FOR UPDATE`;
  }
  await tx.$queryRaw`SELECT "id" FROM "Equipment" WHERE "id" = ${source.equipmentId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${reservationId}::uuid FOR UPDATE`;
  const reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude });
  if (!reservation) throw new InventoryError(404, "Reserva não encontrada.");
  return reservation;
}
async function lockWithdrawal(tx: Tx, id: string) {
  const source = await tx.withdrawal.findUnique({ where: { id }, select: { reservationId: true, equipmentId: true } });
  if (!source) throw new InventoryError(404, "Movimentação não encontrada.");
  if (source.reservationId) await lockReservation(tx, source.reservationId);
  else await tx.$queryRaw`SELECT "id" FROM "Equipment" WHERE "id" = ${source.equipmentId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Withdrawal" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const row = await tx.withdrawal.findUnique({ where: { id }, include });
  if (!row) throw new InventoryError(404, "Movimentação não encontrada.");
  return row;
}
function assertEligible(reservation: ReservationRecord, now: Date) {
  const request = reservation.requestItem?.request;
  if (reservation.status !== "ACTIVE" || !request || request.status !== "APPROVED") throw new InventoryError(409, "Somente reservas vinculadas a solicitações aprovadas autorizam retiradas.");
  if (request.event.archivedAt || ["CANCELLED", "COMPLETED"].includes(request.event.status)) throw new InventoryError(409, "Este evento está cancelado, concluído ou arquivado. A retirada não é permitida.");
  if (reservation.equipment.archivedAt) throw new InventoryError(409, "Não é possível retirar equipamentos arquivados.");
  if (now < reservation.startsAt) throw new InventoryError(409, "Retirada antecipada não é permitida. Solicite a revisão do período aprovado antes de retirar.");
  if (now >= reservation.endsAt) throw new InventoryError(409, "O período aprovado desta reserva terminou. Regularize a reserva antes de uma nova retirada.");
}
function dateFilter(raw: string) {
  try { if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(); return Temporal.PlainDate.from(raw).toString(); }
  catch { throw new InventoryError(400, "Informe datas válidas para o período."); }
}
function pageNumber(value: string | null, fallback: number) { if (!value) return fallback; const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new InventoryError(400, "Paginação inválida."); return number; }
function filters(params: URLSearchParams): Prisma.WithdrawalWhereInput {
  const where: Prisma.WithdrawalWhereInput = {};
  const reservationId = params.get("reservationId"); if (reservationId) where.reservationId = uuid(reservationId);
  const eventId = params.get("eventId"); const requestId = params.get("requestId");
  if (eventId || requestId) where.reservation = { requestItem: { request: { ...(eventId ? { eventId: uuid(eventId) } : {}), ...(requestId ? { id: uuid(requestId) } : {}) } } };
  const equipmentId = params.get("equipmentId"); if (equipmentId) where.equipmentId = uuid(equipmentId);
  const responsible = params.get("responsible")?.trim(); if (responsible) { if (responsible.length > 120) throw new InventoryError(400, "Responsável inválido."); where.responsibleName = { contains: responsible, mode: "insensitive" }; }
  const from = params.get("from"); const to = params.get("to");
  if (from && to && from > to) throw new InventoryError(400, "O término do filtro deve ser posterior ao início.");
  if (from || to) where.createdAt = { ...(from ? { gte: new Date(institutionalDayRange(dateFilter(from), from).startsAt) } : {}), ...(to ? { lt: new Date(institutionalDayRange(dateFilter(to), to).endsAt) } : {}) };
  return where;
}
function filterSearch(rows: PhysicalMovement[], params: URLSearchParams) {
  const q = normalizeSearch(params.get("q") ?? "");
  if (q.length > 300) throw new InventoryError(400, "Use até 300 caracteres na busca.");
  const status = params.get("status");
  if (status && status !== "all" && !Object.hasOwn(movementStatusLabels, status)) throw new InventoryError(400, "Status de movimentação inválido.");
  return rows.filter((row) => {
    // Ocorrências continuam pesquisáveis quando o estado principal é parcial ou em atraso.
    const matchesStatus = !status || status === "all" || (status === "DAMAGED" ? row.damagedQuantity > 0 : status === "LOST" ? row.lostQuantity > 0 : row.status === status);
    return matchesStatus && (!q || normalizeSearch([row.eventTitle, row.equipmentName, row.responsibleName, row.destination, row.notes, ...row.units.map((unit) => unit.assetNumber)].join(" ")).includes(q));
  });
}

export async function listMovements(params: URLSearchParams): Promise<MovementList> {
  await requireActor();
  const pageSize = pageNumber(params.get("pageSize"), 12); if (![6, 12, 24].includes(pageSize)) throw new InventoryError(400, "Selecione 6, 12 ou 24 movimentações por página.");
  const requestedPage = pageNumber(params.get("page"), 1);
  return getPrisma().$transaction(async (tx) => {
    const rows = await tx.withdrawal.findMany({ where: filters(params), include, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    const names = await actorNames(tx, rows); const items = filterSearch(rows.map((row) => dto(row, names)), params);
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize)); const page = Math.min(requestedPage, totalPages);
    return { items: items.slice((page - 1) * pageSize, page * pageSize), summary: summary(items), pagination: { page, pageSize, total: items.length, totalPages } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
}
export async function overviewMovements(): Promise<MovementOverview> {
  await requireActor();
  return getPrisma().$transaction(async (tx) => {
    const rows = await tx.withdrawal.findMany({ include, orderBy: [{ createdAt: "desc" }, { id: "asc" }] }); const names = await actorNames(tx, rows); const items = rows.map((row) => dto(row, names));
    return { items: items.slice(0, 1000), summary: summary(items), limitReached: items.length > 1000 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
}
async function detail(tx: Tx, row: Record, actor: AuthUser): Promise<MovementDetail> {
  const names = await actorNames(tx, [row]); const movement = dto(row, names); const warnings: string[] = [];
  if (!row.actorUserId) warnings.push("Registro histórico anterior à identificação autenticada; responsável e destino podem não ter sido informados.");
  if (movement.status === "OVERDUE") warnings.push("Devolução em atraso. O saldo físico permanece em uso até a conferência; reservas futuras podem estar comprometidas.");
  if (movement.damagedQuantity) warnings.push("Os itens devolvidos com avaria foram direcionados à manutenção na conferência. Consulte no estoque a condição atual após eventuais reparos.");
  if (movement.lostQuantity) warnings.push("Os extravios permanecem no histórico e fora do saldo disponível.");
  const equipment = await tx.equipment.findUnique({ where: { id: row.equipmentId }, include: availabilityInclude });
  const now = new Date();
  if (equipment) for (const reservation of equipment.reservations.filter((entry) => entry.status === "ACTIVE" && entry.endsAt > now)) {
    const issued = equipment.withdrawals.filter((withdrawal) => withdrawal.reservationId === reservation.id).reduce((sum, withdrawal) => sum + withdrawal.quantity, 0);
    const remaining = Math.max(0, reservation.quantity - issued); if (!remaining) continue;
    const availability = calculateRequestAvailability(equipment, remaining, new Date(Math.max(now.getTime(), reservation.startsAt.getTime())), reservation.endsAt, reservation.id);
    if (!availability.item.sufficient) warnings.push(`Reserva ${reservation.reference || reservation.id}: o estoque físico atual é insuficiente. Regularize a utilização, manutenção ou extravio antes da próxima retirada.`);
  }
  const canSettle = actor.permissions.includes("MOVEMENTS_WRITE") && movement.pendingQuantity > 0;
  return {
    movement, warnings,
    permissions: { settle: canSettle, extend: canSettle && actor.permissions.includes("REQUEST_APPROVE") && !!row.reservationId, reason: "Registrar retiradas e conferências exige permissão de movimentação. Estender utilização exige também permissão de aprovação de solicitações." },
    settlements: row.settlements.map((settlement) => ({ id: settlement.id, createdAt: settlement.createdAt.toISOString(), actorUserId: settlement.actorUserId, actorName: names.get(settlement.actorUserId) ?? "Conta histórica", notes: settlement.notes, checklist: settlementChecklist(settlement.checklist), goodQuantity: settlement.goodQuantity, damagedQuantity: settlement.damagedQuantity, lostQuantity: settlement.lostQuantity, units: settlement.units.map((unit) => ({ unitId: unit.unitId, assetNumber: unit.unit.assetNumber, condition: unit.condition })) })),
    history: row.history.map((entry) => ({ id: entry.id, action: entry.action, description: entry.description, actorUserId: entry.actorUserId, actorName: entry.actorUserId ? names.get(entry.actorUserId) ?? null : null, createdAt: entry.createdAt.toISOString() })),
  };
}
export async function getMovementDetail(id: string): Promise<MovementDetail> {
  const actor = await requireActor(); uuid(id);
  return getPrisma().$transaction(async (tx) => { const row = await tx.withdrawal.findUnique({ where: { id }, include }); if (!row) throw new InventoryError(404, "Movimentação não encontrada."); return detail(tx, row, actor); }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
}
export async function withdrawalOptions(params: URLSearchParams): Promise<{ items: WithdrawalOption[]; limitReached: boolean }> {
  await requireActor(); const now = new Date();
  const eventId = params.get("eventId"); const equipmentId = params.get("equipmentId"); const q = normalizeSearch(params.get("q") ?? "");
  if (q.length > 300) throw new InventoryError(400, "Use até 300 caracteres na busca.");
  // Filtrar no banco antes do limite permite localizar reservas fora da primeira janela.
  // O índice textual do equipamento também contém seus números de patrimônio.
  const rows = await getPrisma().reservation.findMany({ where: { status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now }, ...(equipmentId ? { equipmentId: uuid(equipmentId) } : {}), equipment: { archivedAt: null }, requestItem: { request: { status: "APPROVED", ...(eventId ? { eventId: uuid(eventId) } : {}), event: { archivedAt: null, status: { notIn: ["CANCELLED", "COMPLETED"] } } } }, ...(q ? { OR: [{ equipment: { searchText: { contains: q } } }, { requestItem: { request: { event: { searchText: { contains: q } } } } }] } : {}) }, include: reservationInclude, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 1001 });
  const items: WithdrawalOption[] = [];
  for (const row of rows.slice(0, 1000)) {
    const request = row.requestItem!.request;
    const issued = row.withdrawals.reduce((sum, withdrawal) => sum + withdrawal.quantity, 0); const remainingQuantity = Math.max(0, row.quantity - issued); if (!remainingQuantity) continue;
    const availability = calculateRequestAvailability(row.equipment, row.equipment.total, now, row.endsAt, row.id);
    const issuedUnits = new Set(row.withdrawals.flatMap((withdrawal) => withdrawal.units.map((unit) => unit.unitId)));
    items.push({ reservationId: row.id, equipmentId: row.equipmentId, equipmentName: row.equipment.name, eventId: request.eventId, eventTitle: request.event.title, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), quantity: row.quantity, remainingQuantity, trackingMode: row.equipment.trackingMode, units: row.units.filter((unit) => !issuedUnits.has(unit.unitId)).map((unit) => ({ id: unit.unitId, assetNumber: unit.unit.assetNumber, available: availability.unitIds.includes(unit.unitId) })) });
  }
  return { items, limitReached: rows.length > 1000 };
}

export async function createWithdrawal(raw: WithdrawalInput): Promise<PhysicalMovement> {
  const identity = await requireActor("MOVEMENTS_WRITE"); const input = parse(withdrawalSchema, raw);
  return serializable(async (tx) => {
    const actor = await requireActorInTransaction(tx, "MOVEMENTS_WRITE", identity);
    const reservation = await lockReservation(tx, input.reservationId); const now = new Date(); assertEligible(reservation, now);
    const due = input.expectedReturnAt ? new Date(input.expectedReturnAt) : reservation.endsAt;
    if (due <= now || due > reservation.endsAt) throw new InventoryError(422, "A devolução prevista deve ser futura e respeitar o término da reserva aprovada.", { expectedReturnAt: "Informe um horário dentro do período aprovado." });
    const issued = reservation.withdrawals.reduce((sum, withdrawal) => sum + withdrawal.quantity, 0);
    if (input.quantity > reservation.quantity - issued) throw new InventoryError(409, "A quantidade excede o saldo ainda não retirado desta reserva. Devoluções não autorizam uma nova retirada da mesma unidade reservada.");
    const available = calculateRequestAvailability(reservation.equipment, reservation.equipment.total, now, due, reservation.id);
    if (input.quantity > available.item.available) throw new InventoryError(409, "Estoque físico insuficiente no período. Verifique retiradas pendentes, manutenção, extravios e outras reservas.");
    if (reservation.equipment.trackingMode === "INDIVIDUAL") {
      if (input.unitIds.length !== input.quantity) throw new InventoryError(422, "Selecione exatamente um patrimônio para cada unidade retirada.", { unitIds: "A quantidade de patrimônios deve corresponder à retirada." });
      const allocated = new Set(reservation.units.map((unit) => unit.unitId));
      const previouslyIssued = new Set(reservation.withdrawals.flatMap((withdrawal) => withdrawal.units.map((unit) => unit.unitId)));
      if (input.unitIds.some((id) => !allocated.has(id) || previouslyIssued.has(id) || !available.unitIds.includes(id))) throw new InventoryError(409, "Um patrimônio não pertence à reserva, já foi retirado, está em uso, manutenção, extraviado ou possui conflito no período.");
    } else if (input.unitIds.length) throw new InventoryError(422, "Materiais controlados por quantidade não aceitam patrimônios individuais.");
    const row = await tx.withdrawal.create({ data: { equipmentId: reservation.equipmentId, reservationId: reservation.id, quantity: input.quantity, responsibleName: input.responsibleName, destination: input.destination, notes: input.notes, actorUserId: actor.id, expectedReturnAt: due, createdAt: now, checklist: input.checklist, units: { create: input.unitIds.map((unitId) => ({ unitId })) } }, include });
    await tx.equipment.update({ where: { id: row.equipmentId }, data: { version: { increment: 1 } } });
    return recordOperation(tx, actor, row, "RETIRADA", `${input.quantity} unidade(s) retirada(s) por ${input.responsibleName} para ${input.destination}. Registro conferido por ${actor.name}.`);
  });
}

export async function settleWithdrawal(id: string, raw: SettlementInput): Promise<PhysicalMovement> {
  const identity = await requireActor("MOVEMENTS_WRITE"); uuid(id); const input = parse(settlementSchema, raw);
  return serializable(async (tx) => {
    const actor = await requireActorInTransaction(tx, "MOVEMENTS_WRITE", identity); const row = await lockWithdrawal(tx, id);
    if (row.version !== input.version) throw new InventoryError(409, "Esta movimentação foi alterada. Reabra os dados atuais antes de conferir.");
    const count = input.goodQuantity + input.damagedQuantity + input.lostQuantity;
    if (count > pending(row)) throw new InventoryError(409, "A quantidade informada excede as unidades ainda pendentes desta retirada.");
    const before = dto(row, await actorNames(tx, [row])); const now = new Date();
    if (row.equipment.trackingMode === "INDIVIDUAL") {
      if (input.units.length !== count || input.units.filter((unit) => unit.condition === "GOOD").length !== input.goodQuantity || input.units.filter((unit) => unit.condition === "DAMAGED").length !== input.damagedQuantity || input.units.filter((unit) => unit.condition === "LOST").length !== input.lostQuantity) throw new InventoryError(422, "As condições dos patrimônios devem corresponder às quantidades conferidas.");
      for (const unit of input.units) {
        const issued = row.units.find((entry) => entry.unitId === unit.unitId);
        if (!issued || issued.returnedAt || issued.lostAt) throw new InventoryError(409, "Um patrimônio não pertence à retirada ou já foi regularizado.");
        await tx.withdrawalUnit.update({ where: { withdrawalId_unitId: { withdrawalId: id, unitId: unit.unitId } }, data: unit.condition === "LOST" ? { lostAt: now } : { returnedAt: now } });
        if (unit.condition !== "GOOD") await tx.equipmentUnit.update({ where: { id: unit.unitId }, data: { state: unit.condition === "DAMAGED" ? "MAINTENANCE" : "LOST" } });
      }
    } else if (input.units.length) throw new InventoryError(422, "Materiais controlados por quantidade não aceitam conferência de patrimônio.");
    await tx.withdrawalSettlement.create({ data: { withdrawalId: id, goodQuantity: input.goodQuantity, damagedQuantity: input.damagedQuantity, lostQuantity: input.lostQuantity, actorUserId: actor.id, notes: input.notes, checklist: input.checklist, createdAt: now, units: { create: input.units } } });
    const updated = await tx.withdrawal.update({ where: { id }, data: { returnedQuantity: { increment: input.goodQuantity + input.damagedQuantity }, lostQuantity: { increment: input.lostQuantity }, version: { increment: 1 } }, include });
    await tx.equipment.update({ where: { id: row.equipmentId }, data: { maintenance: { increment: input.damagedQuantity }, lost: { increment: input.lostQuantity }, version: { increment: 1 } } });
    // A conferência registra a realidade física mesmo quando revela conflito futuro.
    return recordOperation(tx, actor, updated, "CONFERENCIA", `Conferência por ${actor.name}: ${input.goodQuantity} em bom estado, ${input.damagedQuantity} com avaria para manutenção e ${input.lostQuantity} extraviado(s).${input.notes ? ` ${input.notes}` : ""}`, before);
  });
}

export async function extendWithdrawal(id: string, raw: ExtensionInput): Promise<PhysicalMovement> {
  const identity = await requireActor("MOVEMENTS_WRITE"); if (!identity.permissions.includes("REQUEST_APPROVE")) throw new InventoryError(403, "Estender utilização exige também permissão para aprovar solicitações.");
  uuid(id); const input = parse(extensionSchema, raw);
  return serializable(async (tx) => {
    const actor = await requireActorInTransaction(tx, "MOVEMENTS_WRITE", identity);
    if (!actor.permissions.includes("REQUEST_APPROVE")) throw new InventoryError(403, "Estender utilização exige também permissão para aprovar solicitações.");
    const row = await lockWithdrawal(tx, id); const now = new Date(); const nextDue = new Date(input.expectedReturnAt); const previousDue = dueAt(row);
    if (row.version !== input.version) throw new InventoryError(409, "Esta movimentação foi alterada. Reabra os dados atuais.");
    if (!row.reservationId || !row.reservation || !row.reservation.requestItem || row.reservation.requestItem.request.status !== "APPROVED" || row.reservation.status !== "ACTIVE") throw new InventoryError(409, "A extensão exige uma reserva aprovada e ativa vinculada à movimentação.");
    if (row.reservation.requestItem.request.event.archivedAt || ["CANCELLED", "COMPLETED"].includes(row.reservation.requestItem.request.event.status)) throw new InventoryError(409, "Regularize o evento antes de estender a utilização.");
    if (!pending(row)) throw new InventoryError(409, "Esta movimentação não possui unidades em uso para estender.");
    if (nextDue <= now || (previousDue && nextDue <= previousDue)) throw new InventoryError(422, "O novo prazo deve ser futuro e posterior ao prazo atual.", { expectedReturnAt: "Informe um prazo posterior ao atual." });
    const equipment = await tx.equipment.findUnique({ where: { id: row.equipmentId }, include: availabilityInclude });
    if (!equipment) throw new InventoryError(404, "Equipamento não encontrado.");
    // Simula somente a liberação física da retirada alvo. Sua quantidade emitida e
    // seus patrimônios permanecem registrados para não recriar o saldo da reserva.
    // A reserva própria segue no cálculo pelo saldo ainda não emitido; o alvo é
    // comparado uma única vez com a capacidade que sobra para a extensão.
    const virtual = { ...equipment, withdrawals: equipment.withdrawals.map((withdrawal) => withdrawal.id !== id ? withdrawal : {
      ...withdrawal,
      returnedQuantity: withdrawal.quantity - withdrawal.lostQuantity,
      units: withdrawal.units.map((unit) => unit.returnedAt || unit.lostAt ? unit : { ...unit, returnedAt: now }),
    }) };
    const availability = calculateRequestAvailability(virtual, equipment.total, now, nextDue);
    if (pending(row) > availability.item.available) throw new InventoryError(409, "A extensão conflita com reservas futuras ou com o estoque físico disponível.");
    const unresolvedUnits = row.units.filter((unit) => !unit.returnedAt && !unit.lostAt);
    if (equipment.trackingMode === "INDIVIDUAL" && unresolvedUnits.some((unit) => !availability.unitIds.includes(unit.unitId))) throw new InventoryError(409, "Um patrimônio em uso possui reserva conflitante com a extensão solicitada.");
    const before = dto(row, await actorNames(tx, [row]));
    const updated = await tx.withdrawal.update({ where: { id }, data: { expectedReturnAt: nextDue, version: { increment: 1 } }, include });
    await tx.equipment.update({ where: { id: row.equipmentId }, data: { version: { increment: 1 } } });
    return recordOperation(tx, actor, updated, "EXTENSAO", `Prazo de utilização estendido por ${actor.name} até ${nextDue.toISOString()}. Reserva original preservada. Justificativa: ${input.reason}`, before);
  });
}
export async function assetMovementHistory(unitId: string): Promise<AssetMovementHistory> {
  const actor = await requireActor(); uuid(unitId);
  return getPrisma().$transaction(async (tx) => {
    const unit = await tx.equipmentUnit.findUnique({ where: { id: unitId }, include: { equipment: true } });
    if (!unit) throw new InventoryError(404, "Patrimônio não encontrado.");
    const rows = await tx.withdrawal.findMany({ where: { units: { some: { unitId } } }, include, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    const items: MovementDetail[] = [];
    for (const row of rows) items.push(await detail(tx, row, actor));
    return { unitId: unit.id, assetNumber: unit.assetNumber, equipmentId: unit.equipmentId, equipmentName: unit.equipment.name, items };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 });
}
