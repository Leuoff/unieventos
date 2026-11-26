import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/server/prisma";
import { requireActor, requireActorInTransaction } from "@/server/auth-context";
import { isTransactionConflict, waitForTransactionRetry } from "@/server/transaction-conflict";
import { lookupEquipment } from "@/server/inventory-service";
import { EventError } from "@/server/events-http";
import { normalizeSearch } from "@/lib/inventory-validation";
import { validateEvent, isEventDepartment } from "@/lib/events-validation";
import { INSTITUTIONAL_TIME_ZONE, institutionalDayRange, todayInstitutional } from "@/lib/event-time";
import { eventStatusLabels, eventKindLabels, type CalendarEvent, type EventConflict, type EventDetail, type EventInput, type EventList, type EventMutation, type EventOverview, type EventSummary } from "@/types/events";
import type { Department } from "@/types/domain";
import type { AuthUser } from "@/types/auth";

const include = { equipmentNeeds: { include: { equipment: true }, orderBy: [{ equipmentId: "asc" }] } } satisfies Prisma.CalendarEventInclude;
type Record = Prisma.CalendarEventGetPayload<{ include: typeof include }>;
type Tx = Prisma.TransactionClient;
type Reader = Pick<Tx, "calendarEvent">;
const locationKey = (location: string) => normalizeSearch(location).replace(/\s+/g, " ");

function dto(row: Record): CalendarEvent {
  return {
    id: row.id, createdByUserId: row.createdByUserId, title: row.title, description: row.description, department: row.department as Department,
    responsibleName: row.responsibleName, contact: row.contact, location: row.location, kind: row.kind, status: row.status,
    startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), version: row.version,
    archivedAt: row.archivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    equipmentNeeds: row.equipmentNeeds.map((need) => ({ id: need.id, equipmentId: need.equipmentId, equipmentName: need.equipment.name, equipmentCategory: need.equipment.category, equipmentArchived: need.equipment.archivedAt !== null, quantity: need.quantity, notes: need.notes })),
  };
}

function paginationNumber(value: string | null, fallback: number) {
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new EventError(400, "Página ou tamanho de página inválido.");
  return number;
}

function dateOnly(value: string) {
  try { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(); return Temporal.PlainDate.from(value).toString(); }
  catch { throw new EventError(400, "Informe o período com datas válidas."); }
}

function filters(params: URLSearchParams): Prisma.CalendarEventWhereInput {
  const where: Prisma.CalendarEventWhereInput = { archivedAt: params.get("archived") === "1" ? { not: null } : null };
  const q = normalizeSearch(params.get("q") ?? "");
  if (q.length > 300) throw new EventError(400, "Use até 300 caracteres na busca.");
  if (q) where.searchText = { contains: q };
  const department = params.get("department");
  if (department) { if (!isEventDepartment(department)) throw new EventError(400, "Setor inválido."); where.department = department; }
  const kind = params.get("kind");
  if (kind) { if (!Object.hasOwn(eventKindLabels, kind)) throw new EventError(400, "Tipo de evento inválido."); where.kind = kind as "INTERNAL" | "EXTERNAL"; }
  const status = params.get("status");
  if (status) { if (!Object.hasOwn(eventStatusLabels, status)) throw new EventError(400, "Status de evento inválido."); where.status = status as keyof typeof eventStatusLabels; }
  const location = params.get("location");
  if (location) where.locationKey = locationKey(location);
  const from = params.get("from");
  const to = params.get("to");
  if (from) { dateOnly(from); where.endsAt = { gt: new Date(institutionalDayRange(from, from).startsAt) }; }
  if (to) { dateOnly(to); where.startsAt = { lt: new Date(institutionalDayRange(to, to).endsAt) }; }
  if (from && to && from > to) throw new EventError(400, "O fim do período não pode ser anterior ao início.");
  return where;
}

function summarize(rows: { status: string; kind: string; startsAt: Date; endsAt: Date }[]): EventSummary {
  const now = new Date();
  const range = institutionalDayRange(todayInstitutional(), todayInstitutional());
  return {
    total: rows.length,
    confirmed: rows.filter((row) => row.status === "CONFIRMED").length,
    external: rows.filter((row) => row.kind === "EXTERNAL").length,
    cancelled: rows.filter((row) => row.status === "CANCELLED").length,
    today: rows.filter((row) => row.status !== "CANCELLED" && row.startsAt < new Date(range.endsAt) && row.endsAt > new Date(range.startsAt)).length,
    upcoming: rows.filter((row) => !["CANCELLED", "COMPLETED"].includes(row.status) && row.endsAt > now).length,
  };
}

export async function listEvents(params: URLSearchParams): Promise<EventList> {
  await requireActor();
  const where = filters(params);
  const pageSize = paginationNumber(params.get("pageSize"), 12);
  if (![6, 12, 24].includes(pageSize)) throw new EventError(400, "Selecione 6, 12 ou 24 eventos por página.");
  const requestedPage = paginationNumber(params.get("page"), 1);
  return getPrisma().$transaction(async (tx) => {
    const rows = await tx.calendarEvent.findMany({ where, select: { status: true, kind: true, startsAt: true, endsAt: true } });
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const items = await tx.calendarEvent.findMany({ where, include, orderBy: [{ startsAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
    const locations = await tx.calendarEvent.findMany({ where: { archivedAt: where.archivedAt }, select: { location: true }, distinct: ["location"], orderBy: { location: "asc" } });
    return { items: items.map(dto), summary: summarize(rows), locations: locations.map((row) => row.location), pagination: { page, pageSize, total: rows.length, totalPages } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 });
}

export async function calendarEvents(params: URLSearchParams) {
  await requireActor();
  const items = await getPrisma().calendarEvent.findMany({ where: filters(params), include, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 2001 });
  return { items: items.slice(0, 2000).map(dto), limitReached: items.length > 2000 };
}

export async function overviewEvents(): Promise<EventOverview> {
  await requireActor();
  const rows = await getPrisma().calendarEvent.findMany({ where: { archivedAt: null }, include, orderBy: [{ startsAt: "asc" }, { id: "asc" }] });
  return { items: rows.map(dto), summary: summarize(rows), today: todayInstitutional(), timeZone: INSTITUTIONAL_TIME_ZONE };
}

async function conflicts(reader: Reader, value: { location: string; startsAt: string; endsAt: string; id?: string; status?: string }): Promise<EventConflict[]> {
  if (value.status === "CANCELLED") return [];
  const rows = await reader.calendarEvent.findMany({ where: { archivedAt: null, status: { not: "CANCELLED" }, locationKey: locationKey(value.location), startsAt: { lt: new Date(value.endsAt) }, endsAt: { gt: new Date(value.startsAt) }, ...(value.id ? { id: { not: value.id } } : {}) }, select: { id: true, title: true, location: true, startsAt: true, endsAt: true, department: true }, orderBy: [{ startsAt: "asc" }, { id: "asc" }] });
  return rows.map((row) => ({ ...row, department: row.department as Department, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() }));
}

export async function eventConflicts(params: URLSearchParams) {
  await requireActor();
  const location = params.get("location") ?? "";
  let startsAt: string;
  let endsAt: string;
  try {
    startsAt = Temporal.Instant.from(params.get("startsAt") ?? "").toString();
    endsAt = Temporal.Instant.from(params.get("endsAt") ?? "").toString();
  } catch { throw new EventError(400, "Informe o início e o término com fuso horário."); }
  if (!Number.isFinite(new Date(startsAt).getTime()) || !Number.isFinite(new Date(endsAt).getTime())) throw new EventError(400, "Informe datas dentro do intervalo suportado.");
  if (location.trim().length < 2 || location.length > 160 || new Date(endsAt) <= new Date(startsAt)) throw new EventError(400, "Informe local e intervalo válidos.");
  const id = params.get("excludeId") ?? undefined;
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new EventError(400, "Identificação do evento inválida.");
  return { items: await conflicts(getPrisma(), { location, startsAt, endsAt, id, status: params.get("status") ?? undefined }) };
}

export async function getEventDetail(id: string, requestedPage = 1): Promise<EventDetail> {
  const actor = await requireActor();
  return getPrisma().$transaction(async (tx) => {
    const row = await tx.calendarEvent.findUnique({ where: { id }, include });
    if (!row) throw new EventError(404, "Evento não encontrado.");
    const total = await tx.eventHistory.count({ where: { eventId: id } });
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, requestedPage), totalPages);
    const history = await tx.eventHistory.findMany({ where: { eventId: id }, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const event = dto(row);
    const canManage = actor.permissions.includes("EVENT_MANAGE_ALL") || row.createdByUserId === actor.id;
    return { event, history: history.map(({ id, action, description, actorUserId, createdAt }) => ({ id, action, description, actorUserId, createdAt: createdAt.toISOString() })), historyPagination: { page, pageSize, total, totalPages }, conflicts: row.archivedAt ? [] : await conflicts(tx, event), permissions: { edit: canManage && !row.archivedAt, archive: canManage && !row.archivedAt } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 });
}

async function serializable<T>(action: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await getPrisma().$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 }); }
    catch (error) {
      if (isTransactionConflict(error) && attempt < 4) { await waitForTransactionRetry(attempt); continue; }
      if (isTransactionConflict(error)) throw new EventError(409, "O evento foi alterado simultaneamente. Atualize e tente novamente.");
      throw error;
    }
  }
  throw new EventError(409, "Não foi possível concluir a alteração simultânea. Tente novamente.");
}

function validated(input: EventInput, editing = false) {
  const result = validateEvent(input, editing);
  if (!result.success) throw new EventError(422, "Confira os campos do evento.", result.fieldErrors);
  return result.data;
}

async function checkNeeds(tx: Tx, input: EventInput, previous?: Record) {
  const records = await tx.equipment.findMany({ where: { id: { in: input.equipmentNeeds.map((need) => need.equipmentId) } }, select: { id: true, archivedAt: true } });
  for (const [index, need] of input.equipmentNeeds.entries()) {
    const equipment = records.find((row) => row.id === need.equipmentId);
    if (!equipment) throw new EventError(422, "Uma necessidade aponta para equipamento não encontrado.", { [`equipmentNeeds.${index}.equipmentId`]: "Selecione um equipamento existente." });
    const old = previous?.equipmentNeeds.find((row) => row.equipmentId === need.equipmentId);
    if (equipment.archivedAt && (!old || old.quantity !== need.quantity)) throw new EventError(409, "Equipamentos arquivados não podem receber novas necessidades. Mantenha o vínculo histórico ou remova-o.", { [`equipmentNeeds.${index}.equipmentId`]: "Este equipamento está arquivado." });
  }
}

function data(input: EventInput) {
  return { title: input.title, description: input.description, department: input.department, responsibleName: input.responsibleName, contact: input.contact, location: input.location, locationKey: locationKey(input.location), searchText: normalizeSearch([input.title, input.description, input.department, input.responsibleName, input.contact, input.location].join(" ")), kind: input.kind, status: input.status, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) };
}
function snapshot(value: CalendarEvent) { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }

function assertEventOwner(actor: AuthUser, row: { createdByUserId: string | null }) {
  if (row.createdByUserId !== actor.id && !actor.permissions.includes("EVENT_MANAGE_ALL")) throw new EventError(403, "Sua conta pode alterar somente os próprios eventos.");
}
function assertDepartment(actor: AuthUser, input: EventInput) {
  if (actor.role !== "ADMIN" && input.department !== actor.department) throw new EventError(403, "O setor organizador deve corresponder ao setor da sua conta autenticada.");
}

export async function createEvent(raw: EventInput): Promise<EventMutation> {
  const identity = await requireActor();
  const input = validated(raw);
  return serializable(async (tx) => {
    const actor = await requireActorInTransaction(tx, undefined, identity);
    assertDepartment(actor, input);
    await checkNeeds(tx, input);
    const row = await tx.calendarEvent.create({ data: { ...data(input), createdByUserId: actor.id, equipmentNeeds: { create: input.equipmentNeeds } }, include });
    const event = dto(row);
    await tx.eventHistory.create({ data: { eventId: row.id, action: "CADASTRO", actorUserId: actor.id, description: `Evento cadastrado por ${actor.name}, conta autenticada. Responsável informado para o evento: ${input.responsibleName}. Necessidades de equipamentos são preliminares, sem reserva.`, after: snapshot(event) } });
    return { event, conflicts: await conflicts(tx, event) };
  });
}

export async function updateEvent(id: string, raw: EventInput): Promise<EventMutation> {
  const identity = await requireActor();
  const input = validated(raw, true);
  return serializable(async (tx) => {
    const actor = await requireActorInTransaction(tx, undefined, identity);
    if (!actor.permissions.includes("EVENT_MANAGE_ALL")) assertDepartment(actor, input);
    // Same lock order as reservation approvals: event, request, equipment.
    await tx.$queryRaw`SELECT id FROM "CalendarEvent" WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.calendarEvent.findUnique({ where: { id }, include });
    if (!row) throw new EventError(404, "Evento não encontrado.");
    assertEventOwner(actor, row);
    if (row.archivedAt) throw new EventError(409, "Eventos arquivados não podem ser editados.");
    if (row.version !== input.version) throw new EventError(409, "Este evento foi alterado. Reabra os detalhes antes de salvar.", { version: "Atualize os dados do evento." });
    if ((input.status === "CANCELLED" || input.status === "COMPLETED") && input.status !== row.status || row.startsAt.getTime() !== new Date(input.startsAt).getTime() || row.endsAt.getTime() !== new Date(input.endsAt).getTime()) {
      await ensureNoActiveEventReservations(tx, id);
    }
    await checkNeeds(tx, input, row);
    const changed = await tx.calendarEvent.updateMany({ where: { id, version: input.version, archivedAt: null }, data: { ...data(input), version: { increment: 1 } } });
    if (changed.count !== 1) throw new EventError(409, "O evento foi alterado simultaneamente. Atualize os dados.");
    await tx.eventEquipmentNeed.deleteMany({ where: { eventId: id, equipmentId: { notIn: input.equipmentNeeds.map((need) => need.equipmentId) } } });
    for (const need of input.equipmentNeeds) await tx.eventEquipmentNeed.upsert({ where: { eventId_equipmentId: { eventId: id, equipmentId: need.equipmentId } }, create: { eventId: id, ...need }, update: { quantity: need.quantity, notes: need.notes } });
    const event = dto(await tx.calendarEvent.findUniqueOrThrow({ where: { id }, include }));
    const action = row.status !== "CANCELLED" && input.status === "CANCELLED" ? "CANCELAMENTO" : row.status === "CANCELLED" && input.status !== "CANCELLED" ? "REATIVACAO" : "ALTERACAO";
    await tx.eventHistory.create({ data: { eventId: id, action, actorUserId: actor.id, description: `${action === "CANCELAMENTO" ? "Evento cancelado" : action === "REATIVACAO" ? "Evento reativado" : "Evento atualizado"} por ${actor.name}, conta autenticada. Motivo: ${input.reason}. Responsável informado para o evento: ${input.responsibleName}.`, before: snapshot(dto(row)), after: snapshot(event) } });
    return { event, conflicts: await conflicts(tx, event) };
  });
}

export async function archiveEvent(id: string, version: number, reason: string) {
  const identity = await requireActor();
  if (!Number.isSafeInteger(version) || version < 1 || reason.trim().length < 3 || reason.length > 500) throw new EventError(422, "Informe a versão atual e o motivo do arquivamento.");
  return serializable(async (tx) => {
    const actor = await requireActorInTransaction(tx, undefined, identity);
    await tx.$queryRaw`SELECT id FROM "CalendarEvent" WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.calendarEvent.findUnique({ where: { id }, include });
    if (!row) throw new EventError(404, "Evento não encontrado.");
    assertEventOwner(actor, row);
    if (row.archivedAt || row.version !== version) throw new EventError(409, "O evento já foi arquivado ou alterado. Atualize os detalhes.");
    await ensureNoActiveEventReservations(tx, id);
    const changed = await tx.calendarEvent.updateMany({ where: { id, version, archivedAt: null }, data: { archivedAt: new Date(), version: { increment: 1 } } });
    if (changed.count !== 1) throw new EventError(409, "O evento foi alterado simultaneamente.");
    const after = dto(await tx.calendarEvent.findUniqueOrThrow({ where: { id }, include }));
    await tx.eventHistory.create({ data: { eventId: id, action: "ARQUIVAMENTO", actorUserId: actor.id, description: `Evento arquivado por ${actor.name}, conta autenticada. Motivo: ${reason.trim()}. O histórico e as necessidades foram preservados.`, before: snapshot(dto(row)), after: snapshot(after) } });
    return { archived: true };
  });
}

async function ensureNoActiveEventReservations(tx: Tx, eventId: string) {
  const withdrawals = await tx.withdrawal.findMany({ where: { reservation: { requestItem: { request: { eventId } } } }, select: { quantity: true, returnedQuantity: true, lostQuantity: true } });
  if (withdrawals.some((withdrawal) => withdrawal.quantity > withdrawal.returnedQuantity + withdrawal.lostQuantity)) throw new EventError(409, "Este evento possui equipamentos retirados, inclusive em reservas vencidas. Regularize todas as devoluções e ocorrências antes de alterar o período, encerrar ou arquivar o evento.");
  const active = await tx.reservation.count({ where: { status: "ACTIVE", endsAt: { gt: new Date() }, requestItem: { request: { eventId } } } });
  if (active) throw new EventError(409, "Este evento possui reservas ativas. É necessário cancelá-las com autorização antes de alterar o período, encerrar ou arquivar o evento.");
}

export async function eventEquipmentOptions(query = "") {
  await requireActor();
  if (query.length > 300) throw new EventError(400, "Use até 300 caracteres na busca de equipamentos.");
  const result = await lookupEquipment(query);
  // Saldo físico não é uma promessa de disponibilidade por período; necessidades não o consomem.
  return { items: result.items.map(({ id, name, category, total, available, archivedAt }) => ({ id, name, category, total, available, archivedAt })), limitReached: result.limitReached };
}
