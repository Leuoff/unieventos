import "dotenv/config";
import assert from "node:assert/strict";
import { after } from "node:test";
import { test, cleanupAuthentication, integrationUserId } from "./helpers/integration-auth";
import { withSessionToken } from "@/server/auth-context";
import { randomUUID } from "node:crypto";
import { getPrisma } from "@/server/prisma";
import { createEquipment, deleteEquipment, getEquipmentDetail } from "@/server/inventory-service";
import { createEvent, archiveEvent, updateEvent } from "@/server/events-service";
import { createRequest, updateRequest, submitRequest, importEventNeeds, getRequestDetail, listRequests, overviewRequests, requestAvailability, listReservations, decideRequest, createRequestDecisionService } from "@/server/requests-service";
import { InventoryError } from "@/server/inventory-error";
import type { CalendarEvent, EventInput } from "@/types/events";
import type { EquipmentInput } from "@/types/inventory";
import type { EquipmentRequest, RequestInput } from "@/types/requests";

assert.ok(process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === "/unieventos_test", "Use exclusivamente unieventos_test.");
const db = getPrisma();
const events: string[] = [], stock: string[] = [];
const actorUserId = integrationUserId;
const decide = createRequestDecisionService(async () => ({ actorUserId, permissions: ["REQUEST_APPROVE", "REQUEST_REFUSE", "RESERVATION_CANCEL"] }));
const startsAt = "2042-10-21T12:00:00Z", endsAt = "2042-10-21T14:00:00Z";
const statusError = (status: number) => (error: unknown) => error instanceof InventoryError && error.status === status;

async function equipment(overrides: Partial<EquipmentInput> = {}) {
  const row = await createEquipment({ name: `Solicitações teste ${randomUUID()}`, category: "Teste isolado", description: "Fixture exclusiva dos testes de solicitações.", location: "Laboratório de testes", trackingMode: "QUANTITY", total: 5, maintenance: 0, units: [], ...overrides });
  stock.push(row.id); return row;
}
async function event(overrides: Partial<EventInput> = {}) {
  const { event: row } = await createEvent({ title: `Solicitações evento ${randomUUID()}`, description: "Fixture exclusiva do banco isolado.", department: "Multimeios", responsibleName: "Responsável declarado teste", contact: "teste@example.org", location: `Sala ${randomUUID()}`, kind: "INTERNAL", status: "CONFIRMED", startsAt, endsAt, equipmentNeeds: [], ...overrides });
  events.push(row.id); return row;
}
function input(eventId: string, equipmentId: string, overrides: Partial<RequestInput> = {}): RequestInput {
  return { eventId, responsibleName: "Responsável declarado", startsAt, endsAt, notes: "Montagem e operação do encontro", items: [{ equipmentId, quantity: 2, notes: "Cabo incluso" }], ...overrides };
}
function edit(row: EquipmentRequest, overrides: Partial<RequestInput> = {}): RequestInput {
  return { eventId: row.eventId, responsibleName: row.responsibleName, startsAt: row.startsAt, endsAt: row.endsAt, notes: row.notes, items: row.items.map(({ equipmentId, quantity, notes }) => ({ equipmentId, quantity, notes })), version: row.version, ...overrides };
}
async function pending(eventId: string, equipmentId: string, overrides: Partial<RequestInput> = {}) {
  const row = await createRequest(input(eventId, equipmentId, overrides));
  return submitRequest(row.id, row.version);
}
function eventEdit(row: CalendarEvent, overrides: Partial<EventInput>): EventInput {
  return { title: row.title, description: row.description, department: row.department, responsibleName: row.responsibleName, contact: row.contact, location: row.location, kind: row.kind, status: row.status, startsAt: row.startsAt, endsAt: row.endsAt, equipmentNeeds: row.equipmentNeeds.map(({ equipmentId, quantity, notes }) => ({ equipmentId, quantity, notes })), version: row.version, reason: "Teste de proteção de vínculo", ...overrides };
}

after(async () => {
  // Delete only this file's fixture IDs and only in the guarded test database.
  await db.withdrawalUnit.deleteMany({ where: { withdrawal: { equipmentId: { in: stock } } } });
  await db.withdrawal.deleteMany({ where: { equipmentId: { in: stock } } });
  await db.reservationUnit.deleteMany({ where: { reservation: { equipmentId: { in: stock } } } });
  await db.reservation.deleteMany({ where: { equipmentId: { in: stock } } });
  await db.requestHistory.deleteMany({ where: { request: { eventId: { in: events } } } });
  await db.equipmentRequestItem.deleteMany({ where: { request: { eventId: { in: events } } } });
  await db.equipmentRequest.deleteMany({ where: { eventId: { in: events } } });
  await db.eventEquipmentNeed.deleteMany({ where: { eventId: { in: events } } });
  await db.eventHistory.deleteMany({ where: { eventId: { in: events } } });
  await db.calendarEvent.deleteMany({ where: { id: { in: events } } });
  await db.stockHistory.deleteMany({ where: { equipmentId: { in: stock } } });
  await db.equipmentUnit.deleteMany({ where: { equipmentId: { in: stock } } });
  await db.equipment.deleteMany({ where: { id: { in: stock } } });
  await cleanupAuthentication();
  await db.$disconnect();
});

test("rascunho persiste, valida vínculos/intervalos/quantidades e rejeita identidade injetada", async () => {
  const item = await equipment(), meeting = await event();
  const raw = input(meeting.id, item.id);
  for (const invalid of [
    { ...raw, endsAt: startsAt }, { ...raw, startsAt: "2042-10-21T09:00" },
    { ...raw, items: [] }, { ...raw, items: [{ equipmentId: item.id, quantity: -1, notes: "" }] },
    { ...raw, items: [...raw.items, ...raw.items] }, { ...raw, actorUserId },
    { ...raw, status: "APPROVED" }, { ...raw, responsibleName: "" },
  ]) await assert.rejects(createRequest(invalid as RequestInput), statusError(422));
  await assert.rejects(createRequest(input(randomUUID(), item.id)), statusError(404));
  await assert.rejects(createRequest(input(meeting.id, randomUUID())), (error) => error instanceof InventoryError && [404, 409, 422].includes(error.status));
  const row = await createRequest(raw);
  assert.equal(row.status, "DRAFT");
  const changed = await updateRequest(row.id, edit(row, { notes: "Ajuste persistido" }));
  assert.equal((await getRequestDetail(row.id)).request.notes, "Ajuste persistido");
  await assert.rejects(updateRequest(row.id, edit(row)), statusError(409));
  const submitted = await submitRequest(row.id, changed.version);
  assert.equal(submitted.status, "PENDING");
  await assert.rejects(updateRequest(row.id, edit(submitted)), statusError(409));
  assert.equal(await db.reservation.count({ where: { equipmentId: item.id } }), 0);
  assert.equal((await getEquipmentDetail(item.id)).equipment.available, 5);
  assert.ok((await getRequestDetail(row.id)).history.length >= 3);
});

test("importação concorrente reaproveita necessidades uma vez, sem reservar ou duplicar a origem", async () => {
  const item = await equipment();
  const meeting = await event({ equipmentNeeds: [{ equipmentId: item.id, quantity: 3, notes: "Necessidade original" }] });
  const [first, second] = await Promise.all([importEventNeeds(meeting.id), importEventNeeds(meeting.id)]);
  assert.equal(first.id, second.id);
  assert.equal(first.importedFromNeeds, true);
  assert.equal(first.items[0].quantity, 3);
  assert.equal(first.status, "DRAFT");
  assert.equal(await db.eventEquipmentNeed.count({ where: { eventId: meeting.id } }), 1);
  assert.equal(await db.equipmentRequest.count({ where: { eventId: meeting.id } }), 1);
  assert.equal(await db.reservation.count({ where: { equipmentId: item.id } }), 0);
});

test("disponibilidade usa pico simultâneo, adjacência, manutenção e retiradas sem devolução", async () => {
  const item = await equipment({ total: 10, maintenance: 1 });
  await db.reservation.createMany({ data: [
    { equipmentId: item.id, quantity: 3, startsAt: new Date(startsAt), endsAt: new Date("2042-10-21T13:00:00Z") },
    { equipmentId: item.id, quantity: 4, startsAt: new Date("2042-10-21T13:00:00Z"), endsAt: new Date(endsAt) },
    { equipmentId: item.id, quantity: 8, startsAt: new Date(endsAt), endsAt: new Date("2042-10-21T15:00:00Z") },
  ] });
  await db.withdrawal.create({ data: { equipmentId: item.id, quantity: 2, returnedQuantity: 1 } });
  const result = await requestAvailability({ startsAt, endsAt, items: [{ equipmentId: item.id, quantity: 4 }] });
  assert.equal(result.items[0].available, 4);
  assert.equal(result.items[0].sufficient, true);
});

test("retirada vinculada não conta reserva duas vezes; devoluções não recriam compromisso consumido", async () => {
  const item = await equipment({ total: 10 });
  const reservation = await db.reservation.create({ data: { equipmentId: item.id, quantity: 4, startsAt: new Date(startsAt), endsAt: new Date(endsAt) } });
  await db.withdrawal.create({ data: { equipmentId: item.id, reservationId: reservation.id, quantity: 2, returnedQuantity: 1 } });
  assert.equal((await requestAvailability({ startsAt, endsAt, items: [{ equipmentId: item.id, quantity: 7 }] })).items[0].available, 7);
});

test("aprovação é atômica para todos os itens e não permite saldo negativo", async () => {
  const enough = await equipment({ total: 5 }), scarce = await equipment({ total: 1 }), meeting = await event();
  const row = await pending(meeting.id, enough.id, { items: [{ equipmentId: enough.id, quantity: 2, notes: "" }, { equipmentId: scarce.id, quantity: 2, notes: "" }] });
  await assert.rejects(decide(row.id, { action: "approve", version: row.version }), statusError(409));
  assert.equal(await db.reservation.count({ where: { equipmentId: { in: [enough.id, scarce.id] } } }), 0);
  assert.equal((await getRequestDetail(row.id)).request.status, "PENDING");
});

test("duas aprovações simultâneas disputam capacidade; apenas uma vence", async () => {
  const item = await equipment({ total: 1 }), meeting = await event(), otherMeeting = await event();
  const a = await pending(meeting.id, item.id, { items: [{ equipmentId: item.id, quantity: 1, notes: "" }] });
  const b = await pending(otherMeeting.id, item.id, { items: [{ equipmentId: item.id, quantity: 1, notes: "" }] });
  const results = await Promise.allSettled([decide(a.id, { action: "approve", version: a.version }), decide(b.id, { action: "approve", version: b.version })]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await db.reservation.count({ where: { equipmentId: item.id, status: "ACTIVE" } }), 1);
  assert.equal((await getEquipmentDetail(item.id)).equipment.available, 1, "Reserva futura não reduz saldo atual.");
  assert.equal(await db.withdrawal.count({ where: { equipmentId: item.id } }), 0);
});

test("patrimônio individual exige unidade disponível durante todo o intervalo", async () => {
  const prefix = randomUUID();
  const item = await equipment({ trackingMode: "INDIVIDUAL", total: 3, maintenance: 1, units: [
    { assetNumber: `${prefix}-A`, status: "AVAILABLE" }, { assetNumber: `${prefix}-B`, status: "AVAILABLE" }, { assetNumber: `${prefix}-M`, status: "MAINTENANCE" },
  ] });
  const meeting = await event();
  const a = await pending(meeting.id, item.id, { endsAt: "2042-10-21T13:00:00Z", items: [{ equipmentId: item.id, quantity: 1, notes: "" }] });
  const approved = await decide(a.id, { action: "approve", version: a.version });
  assert.equal(approved.status, "APPROVED");
  const res = (await listReservations(new URLSearchParams({ equipmentId: item.id }))).items[0];
  assert.equal(res.assets.length, 1);
  assert.ok(!res.assets[0].endsWith("-M"));
  const b = await pending(meeting.id, item.id, { startsAt: "2042-10-21T13:00:00Z", items: [{ equipmentId: item.id, quantity: 1, notes: "" }] });
  await decide(b.id, { action: "approve", version: b.version });
  const whole = (await requestAvailability({ startsAt, endsAt, items: [{ equipmentId: item.id, quantity: 2 }] })).items[0];
  assert.equal(whole.available, 1, "Uma mesma unidade livre em todo o período é necessária.");
  assert.equal(whole.sufficient, false);
  const c = await pending(meeting.id, item.id, { items: [{ equipmentId: item.id, quantity: 2, notes: "" }] });
  await assert.rejects(decide(c.id, { action: "approve", version: c.version }), statusError(409));
});

test("cancelar libera o intervalo, preserva histórico e protege estoque/evento com reserva ativa", async () => {
  const item = await equipment({ total: 2 }), meeting = await event();
  const row = await pending(meeting.id, item.id);
  const approved = await decide(row.id, { action: "approve", version: row.version });
  assert.equal((await requestAvailability({ startsAt, endsAt, items: [{ equipmentId: item.id, quantity: 1 }] })).items[0].available, 0);
  await assert.rejects(deleteEquipment(item.id, item.version), statusError(409));
  await assert.rejects(archiveEvent(meeting.id, meeting.version, "Tentativa sem cancelar reserva"), statusError(409));
  await assert.rejects(updateEvent(meeting.id, eventEdit(meeting, { status: "CANCELLED" })), statusError(409));
  const cancelled = await decide(row.id, { action: "cancel", version: approved.version, reason: "Evento reagendado pela organização" });
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal((await requestAvailability({ startsAt, endsAt, items: [{ equipmentId: item.id, quantity: 1 }] })).items[0].available, 2);
  const detail = await getRequestDetail(row.id);
  assert.equal(detail.reservations[0].status, "CANCELLED");
  assert.ok(detail.history.some((entry) => entry.actorUserId === actorUserId && /reagendado/.test(entry.description)));
  assert.equal((await listReservations(new URLSearchParams({ eventId: meeting.id }))).items[0].requestId, row.id);
  await deleteEquipment(item.id, item.version);
  assert.equal((await getRequestDetail(row.id)).request.id, row.id, "Histórico continua consultável após arquivar equipamento.");
});

test("recusa exige justificativa e não compromete estoque", async () => {
  const item = await equipment(), meeting = await event();
  const row = await pending(meeting.id, item.id);
  await assert.rejects(decide(row.id, { action: "refuse", version: row.version, reason: "" }), statusError(422));
  const refused = await decide(row.id, { action: "refuse", version: row.version, reason: "Recurso incompatível com a instalação prevista" });
  assert.equal(refused.status, "REFUSED");
  assert.equal(await db.reservation.count({ where: { equipmentId: item.id } }), 0);
  assert.ok((await getRequestDetail(row.id)).history.some((entry) => /incompatível/.test(entry.description)));
});

test("sem autenticação todas as decisões são negadas; permissão de aprovação não autoriza cancelamento", async () => {
  const item = await equipment(), meeting = await event();
  const row = await pending(meeting.id, item.id);
  for (const action of ["approve", "refuse", "cancel"] as const) await withSessionToken("invalid", () => assert.rejects(decideRequest(row.id, { action, version: row.version, reason: "Setor declarado não autoriza ação" }), statusError(401)));
  const limited = createRequestDecisionService(async () => ({ actorUserId, permissions: ["REQUEST_APPROVE"] }));
  await assert.rejects(limited(row.id, { action: "refuse", version: row.version, reason: "Sem permissão" }), statusError(403));
  const approved = await limited(row.id, { action: "approve", version: row.version });
  await assert.rejects(limited(row.id, { action: "cancel", version: approved.version, reason: "Sem permissão" }), statusError(403));
  const detail = await getRequestDetail(row.id);
  assert.deepEqual([detail.permissions.approve, detail.permissions.refuse, detail.permissions.cancel], [false, false, true]);
});

test("busca e filtros persistidos, paginação e indicadores utilizam solicitações reais", async () => {
  const item = await equipment(), meeting = await event({ department: "Marketing" });
  const row = await pending(meeting.id, item.id, { notes: `Pesquisa exclusiva ${randomUUID()}` });
  const list = await listRequests(new URLSearchParams({ eventId: meeting.id, status: "PENDING", department: "Marketing", from: "2042-10-21", to: "2042-10-21", pageSize: "6" }));
  assert.equal(list.items.length, 1); assert.equal(list.items[0].id, row.id);
  assert.equal(list.pagination.total, 1);
  assert.equal((await listRequests(new URLSearchParams({ eventId: meeting.id, status: "DRAFT" }))).items.length, 0);
  assert.ok((await overviewRequests()).summary.pending >= 1);
  await assert.rejects(listRequests(new URLSearchParams({ status: "fake" })), statusError(400));
});

test("evento cancelado e equipamento arquivado não recebem novas solicitações válidas", async () => {
  const item = await equipment(), cancelled = await event({ status: "CANCELLED" });
  await assert.rejects(createRequest(input(cancelled.id, item.id)), statusError(409));
  const meeting = await event(); await deleteEquipment(item.id, item.version);
  await assert.rejects(createRequest(input(meeting.id, item.id)), statusError(409));
});

test("aprovações concorrentes para um único patrimônio não reservam a mesma unidade duas vezes", async () => {
  const item = await equipment({ trackingMode: "INDIVIDUAL", total: 1, units: [{ assetNumber: `UNI-CONC-${randomUUID()}`, status: "AVAILABLE" }] });
  const aEvent = await event(), bEvent = await event();
  const a = await pending(aEvent.id, item.id, { items: [{ equipmentId: item.id, quantity: 1, notes: "" }] });
  const b = await pending(bEvent.id, item.id, { items: [{ equipmentId: item.id, quantity: 1, notes: "" }] });
  const results = await Promise.allSettled([decide(a.id, { action: "approve", version: a.version }), decide(b.id, { action: "approve", version: b.version })]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await db.reservationUnit.count({ where: { unitId: item.units[0].id } }), 1);
});

test("patrimônios livres em partes diferentes não substituem uma unidade livre em todo o intervalo", async () => {
  const prefix = randomUUID();
  const item = await equipment({ trackingMode: "INDIVIDUAL", total: 2, units: [{ assetNumber: `${prefix}-A`, status: "AVAILABLE" }, { assetNumber: `${prefix}-B`, status: "AVAILABLE" }] });
  await db.reservation.create({ data: { equipmentId: item.id, quantity: 1, startsAt: new Date(startsAt), endsAt: new Date("2042-10-21T13:00:00Z"), units: { create: [{ unitId: item.units[0].id }] } } });
  await db.reservation.create({ data: { equipmentId: item.id, quantity: 1, startsAt: new Date("2042-10-21T13:00:00Z"), endsAt: new Date(endsAt), units: { create: [{ unitId: item.units[1].id }] } } });
  assert.equal((await requestAvailability({ startsAt, endsAt, items: [{ equipmentId: item.id, quantity: 1 }] })).items[0].available, 0);
});

test("retirada ativa impede cancelar a reserva e unidade retirada fica indisponível no futuro", async () => {
  const item = await equipment({ trackingMode: "INDIVIDUAL", total: 1, units: [{ assetNumber: `UNI-WITH-${randomUUID()}`, status: "AVAILABLE" }] }), meeting = await event();
  const row = await pending(meeting.id, item.id, { items: [{ equipmentId: item.id, quantity: 1, notes: "" }] });
  const approved = await decide(row.id, { action: "approve", version: row.version });
  const reservation = (await listReservations(new URLSearchParams({ equipmentId: item.id }))).items[0];
  await db.withdrawal.create({ data: { equipmentId: item.id, reservationId: reservation.id, quantity: 1, units: { create: [{ unitId: item.units[0].id }] } } });
  await assert.rejects(decide(row.id, { action: "cancel", version: approved.version, reason: "Tentativa com unidade em uso" }), statusError(409));
  assert.equal((await getRequestDetail(row.id)).request.status, "APPROVED");
  assert.equal((await requestAvailability({ startsAt: "2042-11-21T12:00:00Z", endsAt: "2042-11-21T14:00:00Z", items: [{ equipmentId: item.id, quantity: 1 }] })).items[0].available, 0);
});

test("autorizadores sem identidade válida ou sem permissões não executam decisões", async () => {
  const item = await equipment(), meeting = await event(), row = await pending(meeting.id, item.id);
  for (const authorizer of [async () => ({ actorUserId: "declarado", permissions: ["REQUEST_APPROVE"] as const }), async () => ({ actorUserId, permissions: [] })]) {
    const unauthorized = createRequestDecisionService(authorizer);
    await assert.rejects(unauthorized(row.id, { action: "approve", version: row.version }), statusError(403));
  }
  assert.equal((await getRequestDetail(row.id)).request.status, "PENDING");
});

test("constraints do PostgreSQL rejeitam quantidade negativa e intervalo inválido nas solicitações", async () => {
  const item = await equipment(), meeting = await event(), row = await createRequest(input(meeting.id, item.id));
  await assert.rejects(db.equipmentRequestItem.update({ where: { id: row.items[0].id }, data: { quantity: -1 } }));
  await assert.rejects(db.equipmentRequest.update({ where: { id: row.id }, data: { endsAt: new Date(startsAt) } }));
  const persisted = (await getRequestDetail(row.id)).request;
  assert.equal(persisted.items[0].quantity, 2);
  assert.equal(persisted.endsAt, new Date(endsAt).toISOString());
});
