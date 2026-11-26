import "server-only";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/server/prisma";
import { requireActor, requireActorInTransaction } from "@/server/auth-context";
import type { AuthUser, Permission } from "@/types/auth";
import { isTransactionConflict, waitForTransactionRetry } from "@/server/transaction-conflict";
import { InventoryError } from "@/server/inventory-error";
import { normalizeSearch } from "@/lib/inventory-validation";
import { isEventDepartment } from "@/lib/events-validation";
import { institutionalDayRange } from "@/lib/event-time";
import { requestAvailabilitySchema, requestDecisionSchema, requestSubmitSchema, validateRequest } from "@/lib/requests-validation";
import { availabilityInTransaction } from "@/server/requests-availability";
import { authorizeRequest, REQUEST_AUTHORIZATION_MESSAGE, authenticatedRequestAuthorizer, type RequestAuthorizer } from "@/server/requests-permissions";
import { requestStatusLabels, type EquipmentRequest, type RequestInput, type RequestList, type RequestOverview, type RequestSummary, type RequestDetail, type ReservationView } from "@/types/requests";

const include = { event: true, items: { include: { equipment: true }, orderBy: [{ equipmentId: "asc" as const }] } } satisfies Prisma.EquipmentRequestInclude;
const reservationInclude = { equipment: true, units: { include: { unit: true } }, requestItem: { include: { request: { include: { event: true } } } } } satisfies Prisma.ReservationInclude;
type Record = Prisma.EquipmentRequestGetPayload<{ include: typeof include }>;
type Tx = Prisma.TransactionClient;

function uuid(id: string) { if (!z.uuid().safeParse(id).success) throw new InventoryError(400, "Identificação inválida."); return id; }
function dto(row: Record): EquipmentRequest {
  return { id: row.id, createdByUserId: row.createdByUserId, eventId: row.eventId, eventTitle: row.event.title, department: row.event.department, responsibleName: row.responsibleName, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), notes: row.notes, status: row.status, version: row.version, importedFromNeeds: row.importedEventKey !== null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), items: row.items.map((item) => ({ id: item.id, equipmentId: item.equipmentId, equipmentName: item.equipment.name, quantity: item.quantity, notes: item.notes })) };
}
function reservationDto(row: Prisma.ReservationGetPayload<{ include: typeof reservationInclude }>, actor: AuthUser): ReservationView {
  const source = row.requestItem?.request;
  return { id: row.id, equipmentId: row.equipmentId, equipmentName: row.equipment.name, eventId: source?.eventId ?? null, eventTitle: source?.event.title ?? null, requestId: source && canReadRequest(actor, source) ? source.id : null, quantity: row.quantity, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), status: row.status, assets: row.units.map((unit) => unit.unit.assetNumber).sort((a, b) => a.localeCompare(b, "pt-BR")) };
}

const reviewPermissions: Permission[] = ["REQUEST_MANAGE_ALL", "REQUEST_APPROVE", "REQUEST_REFUSE", "RESERVATION_CANCEL"];
function canReadAll(actor: AuthUser) { return reviewPermissions.some((permission) => actor.permissions.includes(permission)); }
function canReadRequest(actor: AuthUser, row: { createdByUserId: string | null }) { return row.createdByUserId === actor.id || canReadAll(actor); }
function canEditRequest(actor: AuthUser, row: { createdByUserId: string | null }) { return row.createdByUserId === actor.id || actor.permissions.includes("REQUEST_MANAGE_ALL"); }
function assertRequestOwner(actor: AuthUser, row: { createdByUserId: string | null }) { if (!canEditRequest(actor, row)) throw new InventoryError(403, "Sua conta pode alterar somente as próprias solicitações."); }
function assertRequestRead(actor: AuthUser, row: { createdByUserId: string | null }) { if (!canReadRequest(actor, row)) throw new InventoryError(403, "Sua conta não possui acesso a esta solicitação."); }
function assertEventOwner(actor: AuthUser, row: { createdByUserId: string | null }) {
  if (row.createdByUserId !== actor.id && !actor.permissions.includes("EVENT_MANAGE_ALL") && !actor.permissions.includes("REQUEST_MANAGE_ALL")) throw new InventoryError(403, "Crie solicitações para os próprios eventos ou solicite permissão de gerenciamento.");
}
function requestPermissions(actor: AuthUser, row: Record): RequestDetail["permissions"] {
  const own = canEditRequest(actor, row);
  return {
    edit: own && row.status === "DRAFT", submit: own && row.status === "DRAFT",
    approve: actor.permissions.includes("REQUEST_APPROVE") && row.status === "PENDING",
    refuse: actor.permissions.includes("REQUEST_REFUSE") && row.status === "PENDING",
    cancel: ["DRAFT", "PENDING"].includes(row.status) ? own : row.status === "APPROVED" && actor.permissions.includes("RESERVATION_CANCEL"),
    reason: REQUEST_AUTHORIZATION_MESSAGE,
  };
}
function summary(rows: { status: string }[]): RequestSummary {
  return { total: rows.length, draft: rows.filter((row) => row.status === "DRAFT").length, pending: rows.filter((row) => row.status === "PENDING").length, approved: rows.filter((row) => row.status === "APPROVED").length, refused: rows.filter((row) => row.status === "REFUSED").length, cancelled: rows.filter((row) => row.status === "CANCELLED").length };
}
function pageNumber(value: string | null, fallback: number) { if (!value) return fallback; const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new InventoryError(400, "Página inválida."); return number; }
function civil(value: string) { try { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(); return Temporal.PlainDate.from(value).toString(); } catch { throw new InventoryError(400, "Informe um período com datas válidas."); } }
function filters(params: URLSearchParams): Prisma.EquipmentRequestWhereInput {
  const where: Prisma.EquipmentRequestWhereInput = {};
  const q = normalizeSearch(params.get("q") ?? "");
  if (q.length > 300) throw new InventoryError(400, "Use até 300 caracteres na busca.");
  if (q) where.OR = [{ searchText: { contains: q } }, { event: { searchText: { contains: q } } }];
  const status = params.get("status");
  if (status && status !== "all") { if (!Object.hasOwn(requestStatusLabels, status)) throw new InventoryError(400, "Status de solicitação inválido."); where.status = status as keyof typeof requestStatusLabels; }
  const department = params.get("department");
  if (department && department !== "all") { if (!isEventDepartment(department)) throw new InventoryError(400, "Setor inválido."); where.event = { department }; }
  const eventId = params.get("eventId"); if (eventId) where.eventId = uuid(eventId);
  const from = params.get("from"); const to = params.get("to");
  if (from) where.endsAt = { gt: new Date(institutionalDayRange(civil(from), from).startsAt) };
  if (to) where.startsAt = { lt: new Date(institutionalDayRange(civil(to), to).endsAt) };
  if (from && to && from > to) throw new InventoryError(400, "O fim do período não pode ser anterior ao início.");
  return where;
}

async function serializable<T>(action: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await getPrisma().$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 }); }
    catch (error) {
      if (isTransactionConflict(error) && attempt < 4) { await waitForTransactionRetry(attempt); continue; }
      if (isTransactionConflict(error)) throw new InventoryError(409, "O estoque ou a solicitação foi alterado simultaneamente. Atualize e tente novamente.");
      throw error;
    }
  }
  throw new InventoryError(409, "Não foi possível concluir a alteração simultânea.");
}
function validated(raw: RequestInput, editing = false) { const parsed = validateRequest(raw, editing); if (!parsed.success) throw new InventoryError(422, "Confira os campos da solicitação.", parsed.fieldErrors); return parsed.data; }
function snapshot(value: EquipmentRequest) { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function data(input: RequestInput, eventTitle: string, equipmentNames: string[]) {
  return { responsibleName: input.responsibleName, notes: input.notes, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), searchText: normalizeSearch([eventTitle, input.responsibleName, input.notes, ...equipmentNames].join(" ")) };
}
async function eventForMutation(tx: Tx, eventId: string) {
  await tx.$queryRaw`SELECT "id" FROM "CalendarEvent" WHERE "id" = ${uuid(eventId)}::uuid FOR UPDATE`;
  const event = await tx.calendarEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new InventoryError(404, "O evento informado não foi encontrado.");
  if (event.archivedAt || ["CANCELLED", "COMPLETED"].includes(event.status)) throw new InventoryError(409, "Selecione um evento ativo, não cancelado e ainda não concluído.");
  return event;
}
async function checkItems(tx: Tx, input: RequestInput) {
  const equipment = await tx.equipment.findMany({ where: { id: { in: input.items.map((item) => item.equipmentId) } }, select: { id: true, name: true, archivedAt: true } });
  for (const [index, item] of input.items.entries()) {
    const row = equipment.find((entry) => entry.id === item.equipmentId);
    if (!row) throw new InventoryError(422, "Selecione equipamentos reais do estoque.", { [`items.${index}.equipmentId`]: "Equipamento não encontrado." });
    if (row.archivedAt) throw new InventoryError(409, "Equipamentos arquivados não podem receber novas solicitações.", { [`items.${index}.equipmentId`]: "Este equipamento está arquivado." });
  }
  return equipment.map((row) => row.name);
}
async function requestForMutation(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "EquipmentRequest" WHERE "id" = ${uuid(id)}::uuid FOR UPDATE`;
  const row = await tx.equipmentRequest.findUnique({ where: { id }, include });
  if (!row) throw new InventoryError(404, "Solicitação não encontrada.");
  return row;
}
function checkVersion(row: Record, version: number | undefined) { if (row.version !== version) throw new InventoryError(409, "Esta solicitação foi alterada. Reabra os dados atuais e tente novamente."); }
async function history(tx: Tx, request: EquipmentRequest, action: string, description: string, before?: EquipmentRequest, actorUserId?: string) {
  await tx.requestHistory.create({ data: { requestId: request.id, action, description, before: before ? snapshot(before) : undefined, after: snapshot(request), actorUserId: actorUserId ?? null } });
}

export async function listRequests(params: URLSearchParams): Promise<RequestList> {
  const actor = await requireActor();
  const where = filters(params);
  if (!canReadAll(actor)) where.createdByUserId = actor.id;
  const pageSize = pageNumber(params.get("pageSize"), 12);
  if (![6, 12, 24].includes(pageSize)) throw new InventoryError(400, "Selecione 6, 12 ou 24 solicitações por página.");
  const requestedPage = pageNumber(params.get("page"), 1);
  return getPrisma().$transaction(async (tx) => {
    const rows = await tx.equipmentRequest.findMany({ where, select: { status: true } });
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize)); const page = Math.min(requestedPage, totalPages);
    const items = await tx.equipmentRequest.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
    return { items: items.map(dto), summary: summary(rows), pagination: { page, pageSize, total: rows.length, totalPages } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 });
}
export async function overviewRequests(): Promise<RequestOverview> {
  const actor = await requireActor();
  return { summary: summary(await getPrisma().equipmentRequest.findMany({ where: canReadAll(actor) ? {} : { createdByUserId: actor.id }, select: { status: true } })) };
}
export async function getRequestDetail(id: string): Promise<RequestDetail> {
  const actor = await requireActor();
  uuid(id);
  return getPrisma().$transaction(async (tx) => {
    const row = await tx.equipmentRequest.findUnique({ where: { id }, include });
    if (!row) throw new InventoryError(404, "Solicitação não encontrada.");
    assertRequestRead(actor, row);
    const entries = await tx.requestHistory.findMany({ where: { requestId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const reservations = await tx.reservation.findMany({ where: { requestItem: { requestId: id } }, include: reservationInclude, orderBy: [{ startsAt: "asc" }, { id: "asc" }] });
    const request = dto(row);
    const availability = await availabilityInTransaction(tx, request);
    return { request, history: entries.map(({ id, action, description, actorUserId, createdAt }) => ({ id, action, description, actorUserId, createdAt: createdAt.toISOString() })), reservations: reservations.map((reservation) => reservationDto(reservation, actor)), availability: availability.map((result) => result.item), permissions: requestPermissions(actor, row) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 });
}

export async function createRequest(raw: RequestInput): Promise<EquipmentRequest> {
  const identity = await requireActor();
  const input = validated(raw);
  if (input.version !== undefined) throw new InventoryError(422, "Novas solicitações não devem informar versão.");
  return serializable(async (tx) => {
    const actor = await requireActorInTransaction(tx, undefined, identity);
    const event = await eventForMutation(tx, input.eventId); const names = await checkItems(tx, input);
    assertEventOwner(actor, event);
    const row = await tx.equipmentRequest.create({ data: { ...data(input, event.title, names), createdByUserId: actor.id, eventId: event.id, items: { create: input.items } }, include });
    const request = dto(row);
    await history(tx, request, "CADASTRO", `Rascunho criado por ${actor.name}, conta autenticada. Responsável informado: ${request.responsibleName}. Nenhum saldo foi reservado.`, undefined, actor.id);
    return request;
  });
}
export async function updateRequest(id: string, raw: RequestInput): Promise<EquipmentRequest> {
  const identity = await requireActor();
  uuid(id); const input = validated(raw, true);
  return serializable(async (tx) => {
    const actor = await requireActorInTransaction(tx, undefined, identity);
    const event = await eventForMutation(tx, input.eventId); const row = await requestForMutation(tx, id);
    assertRequestOwner(actor, row);
    if (row.eventId !== input.eventId) assertEventOwner(actor, event);
    checkVersion(row, input.version);
    if (row.status !== "DRAFT") throw new InventoryError(409, "Somente rascunhos podem ser editados.");
    if (row.importedEventKey && row.eventId !== input.eventId) throw new InventoryError(409, "Uma solicitação importada deve permanecer vinculada ao evento de origem.");
    const names = await checkItems(tx, input);
    await tx.equipmentRequestItem.deleteMany({ where: { requestId: id, equipmentId: { notIn: input.items.map((item) => item.equipmentId) } } });
    for (const item of input.items) await tx.equipmentRequestItem.upsert({ where: { requestId_equipmentId: { requestId: id, equipmentId: item.equipmentId } }, create: { ...item, requestId: id }, update: { quantity: item.quantity, notes: item.notes } });
    const updated = await tx.equipmentRequest.update({ where: { id }, data: { ...data(input, event.title, names), eventId: event.id, version: { increment: 1 } }, include });
    const request = dto(updated); await history(tx, request, "ALTERACAO", `Rascunho atualizado por ${actor.name}, conta autenticada; não há reserva de estoque.`, dto(row), actor.id); return request;
  });
}
export async function importEventNeeds(eventId: string): Promise<EquipmentRequest> {
  const identity = await requireActor();
  uuid(eventId);
  try { return await serializable(async (tx) => {
    const actor = await requireActorInTransaction(tx, undefined, identity);
    const event = await eventForMutation(tx, eventId);
    assertEventOwner(actor, event);
    const existing = await tx.equipmentRequest.findUnique({ where: { importedEventKey: eventId }, include });
    if (existing) { assertRequestOwner(actor, existing); return dto(existing); }
    const needs = await tx.eventEquipmentNeed.findMany({ where: { eventId }, include: { equipment: true }, orderBy: { equipmentId: "asc" } });
    if (!needs.length) throw new InventoryError(422, "Este evento não possui necessidades preliminares para reaproveitar.");
    if (needs.some((need) => need.equipment.archivedAt !== null)) throw new InventoryError(409, "Uma necessidade utiliza equipamento arquivado. Revise as necessidades do evento antes de importar.");
    const input = validated({ eventId, responsibleName: event.responsibleName, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(), notes: "Necessidades preliminares reaproveitadas do evento. Revise o período e as quantidades antes de enviar.", items: needs.map((need) => ({ equipmentId: need.equipmentId, quantity: need.quantity, notes: need.notes })) });
    const row = await tx.equipmentRequest.create({ data: { ...data(input, event.title, needs.map((need) => need.equipment.name)), createdByUserId: actor.id, eventId, importedEventKey: eventId, items: { create: needs.map((need) => ({ equipmentId: need.equipmentId, quantity: need.quantity, notes: need.notes, sourceNeedId: need.id })) } }, include });
    const request = dto(row); await history(tx, request, "IMPORTACAO", `Necessidades preliminares reaproveitadas por ${actor.name}, conta autenticada, em rascunho, sem duplicá-las no evento e sem criar reserva.`, undefined, actor.id); return request;
  }); } catch (error) {
    // A restrição única também protege a importação quando o banco encerra a disputa antes do retry serializável.
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code === "P2002") {
      const existing = await getPrisma().equipmentRequest.findUnique({ where: { importedEventKey: eventId }, include });
      if (existing) { assertRequestOwner(await requireActor(), existing); return dto(existing); }
    }
    throw error;
  }
}
export async function submitRequest(id: string, version: number): Promise<EquipmentRequest> {
  const identity = await requireActor();
  uuid(id); if (!requestSubmitSchema.safeParse({ version }).success) throw new InventoryError(422, "Informe a versão atual da solicitação.");
  return serializable(async (tx) => {
    const actor = await requireActorInTransaction(tx, undefined, identity);
    const initial = await tx.equipmentRequest.findUnique({ where: { id }, select: { eventId: true } });
    if (!initial) throw new InventoryError(404, "Solicitação não encontrada.");
    await eventForMutation(tx, initial.eventId); const row = await requestForMutation(tx, id); checkVersion(row, version);
    assertRequestOwner(actor, row);
    if (row.status !== "DRAFT") throw new InventoryError(409, "Somente rascunhos podem ser enviados para análise.");
    await checkItems(tx, dto(row));
    const request = dto(await tx.equipmentRequest.update({ where: { id }, data: { status: "PENDING", version: { increment: 1 } }, include }));
    await history(tx, request, "ENVIO", `Solicitação enviada por ${actor.name}, conta autenticada, para análise. A pendência não bloqueia disponibilidade nem cria reserva.`, dto(row), actor.id); return request;
  });
}
export async function requestAvailability(raw: { startsAt: string; endsAt: string; items: { equipmentId: string; quantity: number }[] }) {
  await requireActor();
  const parsed = requestAvailabilitySchema.safeParse(raw);
  if (!parsed.success) throw new InventoryError(422, "Confira equipamentos, quantidades e período.", Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])));
  return getPrisma().$transaction(async (tx) => ({ items: (await availabilityInTransaction(tx, parsed.data)).map((result) => result.item) }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 });
}
export async function listReservations(params: URLSearchParams): Promise<{ items: ReservationView[] }> {
  const actor = await requireActor();
  const equipmentId = params.get("equipmentId"); const eventId = params.get("eventId");
  if (!equipmentId && !eventId) throw new InventoryError(400, "Informe o evento ou equipamento para consultar reservas.");
  const where: Prisma.ReservationWhereInput = {};
  if (equipmentId) where.equipmentId = uuid(equipmentId);
  if (eventId) where.requestItem = { request: { eventId: uuid(eventId) } };
  return { items: (await getPrisma().reservation.findMany({ where, include: reservationInclude, orderBy: [{ startsAt: "desc" }, { id: "asc" }] })).map((reservation) => reservationDto(reservation, actor)) };
}

export type RequestDecisionInput = { action: "approve" | "refuse" | "cancel"; version: number; reason?: string };
/** Injeção exclusiva de código confiável do servidor. Nenhum endpoint aceita um autorizador ou uma identidade enviada pelo cliente. */
export function createRequestDecisionService(authorizer: RequestAuthorizer) {
  return async (id: string, raw: RequestDecisionInput): Promise<EquipmentRequest> => {
    // Autorizar antes de acessar dados ou validar detalhes para negar toda ação HTTP anônima.
    const permission = raw?.action === "approve" ? "REQUEST_APPROVE" : raw?.action === "refuse" ? "REQUEST_REFUSE" : undefined;
    const actor = await authorizeRequest(authorizer, permission);
    uuid(id); const parsed = requestDecisionSchema.safeParse(raw);
    if (!parsed.success) throw new InventoryError(422, "Informe a decisão, versão e justificativa válidas.", Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])));
    const input = parsed.data;
    return serializable(async (tx) => {
      // Toda decisão exige sessão persistida, inclusive em chamadas diretas do serviço.
      const identity = await requireActorInTransaction(tx, permission, actor.identity ?? await requireActor());
      if (identity.id !== actor.actorUserId) throw new InventoryError(403, "A identidade da decisão não corresponde à sessão autenticada.");
      const actorUserId = identity.id;
      const permissions = identity.permissions.filter((permission) => actor.permissions.includes(permission));
      const initial = await tx.equipmentRequest.findUnique({ where: { id }, select: { eventId: true } });
      if (!initial) throw new InventoryError(404, "Solicitação não encontrada.");
      // Ordem global de bloqueios: evento, solicitação e equipamentos ordenados por UUID.
      await tx.$queryRaw`SELECT "id" FROM "CalendarEvent" WHERE "id" = ${initial.eventId}::uuid FOR UPDATE`;
      const row = await requestForMutation(tx, id); checkVersion(row, input.version);
      if (input.action === "cancel") {
        const allowed = row.status === "APPROVED" ? permissions.includes("RESERVATION_CANCEL") : row.createdByUserId === actorUserId || permissions.includes("REQUEST_MANAGE_ALL");
        if (!allowed) throw new InventoryError(403, row.status === "APPROVED" ? "Cancelar uma reserva aprovada exige permissão específica, inclusive quando a solicitação é própria." : "Sua conta pode cancelar somente os próprios rascunhos e solicitações pendentes.");
      }
      if (input.action === "approve" || input.action === "refuse") {
        if (row.status !== "PENDING") throw new InventoryError(409, "Somente solicitações pendentes podem receber uma decisão de análise.");
      } else if (!["DRAFT", "PENDING", "APPROVED"].includes(row.status)) throw new InventoryError(409, "Esta solicitação já está encerrada e não pode ser cancelada novamente.");
      const before = dto(row);
      for (const equipmentId of row.items.map((item) => item.equipmentId).sort()) await tx.$queryRaw`SELECT "id" FROM "Equipment" WHERE "id" = ${equipmentId}::uuid FOR UPDATE`;
      if (input.action === "approve") {
        const event = await tx.calendarEvent.findUnique({ where: { id: row.eventId } });
        if (!event || event.archivedAt || ["CANCELLED", "COMPLETED"].includes(event.status)) throw new InventoryError(409, "Não é possível aprovar equipamentos para evento cancelado, arquivado ou concluído.");
        if (row.endsAt <= new Date()) throw new InventoryError(409, "O período solicitado já terminou. Crie um rascunho com período futuro.");
        if (row.items.length === 0) throw new InventoryError(422, "A solicitação não possui equipamentos.");
        const availability = await availabilityInTransaction(tx, before);
        const conflict = availability.find((result) => !result.item.sufficient);
        if (conflict) throw new InventoryError(409, `${conflict.item.equipmentName}: ${conflict.item.message}`);
        for (const item of row.items) {
          const allocation = availability.find((result) => result.item.equipmentId === item.equipmentId)!;
          await tx.reservation.create({ data: { equipmentId: item.equipmentId, quantity: item.quantity, startsAt: row.startsAt, endsAt: row.endsAt, requestItemId: item.id, reference: `Solicitação ${id}`, units: { create: allocation.unitIds.map((unitId) => ({ unitId })) } } });
        }
      } else if (input.action === "cancel") {
        const reservations = await tx.reservation.findMany({ where: { requestItem: { requestId: id } }, include: { withdrawals: true } });
        if (reservations.some((reservation) => reservation.withdrawals.some((withdrawal) => withdrawal.quantity > withdrawal.returnedQuantity + withdrawal.lostQuantity))) throw new InventoryError(409, "Há retirada ainda não devolvida ou regularizada. Registre todas as devoluções e ocorrências antes de cancelar esta reserva.");
        await tx.reservation.updateMany({ where: { requestItem: { requestId: id }, status: "ACTIVE" }, data: { status: "CANCELLED" } });
      }
      const status = input.action === "approve" ? "APPROVED" : input.action === "refuse" ? "REFUSED" : "CANCELLED";
      const request = dto(await tx.equipmentRequest.update({ where: { id }, data: { status, version: { increment: 1 } }, include }));
      const description = input.action === "approve" ? "Solicitação aprovada por identidade autorizada. Reservas criadas apenas para o intervalo solicitado; nenhuma retirada física foi registrada." : input.action === "refuse" ? `Solicitação recusada. Justificativa: ${input.reason}` : `Solicitação e compromissos de reserva cancelados, preservando o histórico. Justificativa: ${input.reason}`;
      await history(tx, request, input.action === "approve" ? "APROVACAO" : input.action === "refuse" ? "RECUSA" : "CANCELAMENTO", description, before, actorUserId);
      return request;
    });
  };
}
export const decideRequest = createRequestDecisionService(authenticatedRequestAuthorizer);
