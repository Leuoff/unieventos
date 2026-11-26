import "dotenv/config";
import assert from "node:assert/strict";
import { after } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { test, cleanupAuthentication, integrationUserId } from "./helpers/integration-auth";
import { getPrisma } from "@/server/prisma";
import { createEquipment, deleteEquipment, getEquipmentDetail } from "@/server/inventory-service";
import { createEvent, updateEvent, archiveEvent } from "@/server/events-service";
import { createRequest, submitRequest, decideRequest, getRequestDetail, requestAvailability } from "@/server/requests-service";
import { createWithdrawal, settleWithdrawal, extendWithdrawal, getMovementDetail, listMovements, overviewMovements, withdrawalOptions, assetMovementHistory } from "@/server/movements-service";
import { createUser, updateUser } from "@/server/users-service";
import { authenticateCredentials } from "@/server/auth-core";
import { withSessionToken } from "@/server/auth-context";
import { InventoryError } from "@/server/inventory-error";
import type { EquipmentInput } from "@/types/inventory";
import type { EventInput } from "@/types/events";
import type { SettlementInput, WithdrawalInput } from "@/types/movements";

assert.ok(process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === "/unieventos_test", "Use exclusivamente o banco isolado.");
const db = getPrisma(), equipmentIds: string[] = [], eventIds: string[] = [], userIds: string[] = [];
const checklist = { quantityChecked: true, conditionChecked: true, accessoriesChecked: true };
const status = (...values: number[]) => (error: unknown) => error instanceof InventoryError && values.includes(error.status);
const instant = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

async function equipment(overrides: Partial<EquipmentInput> = {}) {
  const row = await createEquipment({ name: `Movimentação teste ${randomUUID()}`, category: "Teste físico isolado", description: "Registro exclusivo do banco de testes.", location: "Depósito de testes", trackingMode: "QUANTITY", total: 5, maintenance: 0, units: [], ...overrides }); equipmentIds.push(row.id); return row;
}
async function approved(equipmentId: string, quantity: number, period = { startsAt: instant(-0.5), endsAt: instant(1) }) {
  const eventInput: EventInput = { title: `Evento físico ${randomUUID()}`, description: "Teste de retirada e retorno real no banco isolado.", department: "Multimeios", responsibleName: "Contato operacional", contact: "teste@unisalesiano.com.br", location: "Auditório de teste", kind: "INTERNAL", status: "CONFIRMED", ...period, equipmentNeeds: [] };
  const { event } = await createEvent(eventInput); eventIds.push(event.id);
  const draft = await createRequest({ eventId: event.id, responsibleName: "Contato operacional", ...period, notes: "Teste isolado", items: [{ equipmentId, quantity, notes: "" }] });
  const pending = await submitRequest(draft.id, draft.version);
  const request = await decideRequest(draft.id, { action: "approve", version: pending.version });
  const reservation = (await getRequestDetail(request.id)).reservations[0];
  return { event, eventInput, request, reservation };
}
function withdrawal(reservationId: string, quantity = 1, overrides: Partial<WithdrawalInput> = {}): WithdrawalInput {
  return { reservationId, quantity, unitIds: [], responsibleName: "Responsável pela retirada", destination: "Auditório Bloco A", notes: "Cabos conferidos na entrega", checklist, ...overrides };
}
function settlement(version: number, overrides: Partial<SettlementInput> = {}): SettlementInput {
  return { version, goodQuantity: 1, damagedQuantity: 0, lostQuantity: 0, units: [], notes: "Retorno conferido", checklist, ...overrides };
}

after(async () => {
  await db.movementHistory.deleteMany({ where: { withdrawal: { equipmentId: { in: equipmentIds } } } });
  await db.withdrawalSettlementUnit.deleteMany({ where: { settlement: { withdrawal: { equipmentId: { in: equipmentIds } } } } });
  await db.withdrawalSettlement.deleteMany({ where: { withdrawal: { equipmentId: { in: equipmentIds } } } });
  await db.withdrawalUnit.deleteMany({ where: { withdrawal: { equipmentId: { in: equipmentIds } } } });
  await db.withdrawal.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
  await db.reservationUnit.deleteMany({ where: { reservation: { equipmentId: { in: equipmentIds } } } });
  await db.reservation.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
  await db.requestHistory.deleteMany({ where: { request: { eventId: { in: eventIds } } } });
  await db.equipmentRequestItem.deleteMany({ where: { request: { eventId: { in: eventIds } } } });
  await db.equipmentRequest.deleteMany({ where: { eventId: { in: eventIds } } });
  await db.eventEquipmentNeed.deleteMany({ where: { eventId: { in: eventIds } } });
  await db.eventHistory.deleteMany({ where: { eventId: { in: eventIds } } });
  await db.calendarEvent.deleteMany({ where: { id: { in: eventIds } } });
  await db.stockHistory.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
  await db.equipmentUnit.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
  await db.equipment.deleteMany({ where: { id: { in: equipmentIds } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await db.appSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await cleanupAuthentication(); await db.$disconnect();
});

test("retiradas parciais consomem a aprovação uma vez; devolução, avaria e extravio mantêm saldos separados", async () => {
  const item = await equipment(), { reservation } = await approved(item.id, 3);
  const a = await createWithdrawal(withdrawal(reservation.id, 2)), b = await createWithdrawal(withdrawal(reservation.id, 1));
  let stock = (await getEquipmentDetail(item.id)).equipment;
  assert.deepEqual([stock.available, stock.reserved, stock.inUse], [2, 0, 3]);
  await assert.rejects(createWithdrawal(withdrawal(reservation.id)), status(409));
  const partial = await settleWithdrawal(a.id, settlement(a.version));
  assert.equal(partial.pendingQuantity, 1); assert.equal(partial.returnedQuantity, 1);
  const conference = await getMovementDetail(a.id);
  assert.deepEqual(conference.movement.checklist, checklist);
  assert.deepEqual(conference.settlements[0].checklist, checklist);
  assert.equal(conference.settlements[0].actorUserId, integrationUserId);
  assert.equal(await db.auditLog.count({ where: { entityType: "Withdrawal", entityId: a.id, actorUserId: integrationUserId } }), 2);
  await assert.rejects(settleWithdrawal(a.id, settlement(a.version)), status(409));
  await settleWithdrawal(a.id, settlement(partial.version, { goodQuantity: 0, damagedQuantity: 1, notes: "Conector danificado no retorno" }));
  await settleWithdrawal(b.id, settlement(b.version, { goodQuantity: 0, lostQuantity: 1, notes: "Extravio constatado e registrado" }));
  stock = (await getEquipmentDetail(item.id)).equipment;
  assert.deepEqual([stock.total, stock.available, stock.reserved, stock.inUse, stock.maintenance, stock.lost], [5, 3, 0, 0, 1, 1]);
  const lost = await getMovementDetail(b.id);
  assert.equal(lost.movement.returnedQuantity, 0); assert.equal(lost.movement.lostQuantity, 1);
  assert.equal(lost.movement.pendingQuantity, 0); assert.equal(lost.movement.status, "LOST");
  assert.equal(lost.settlements[0].lostQuantity, 1);
  assert.ok(lost.history.every((entry) => entry.actorUserId === integrationUserId));
  const future = await requestAvailability({ startsAt: instant(2), endsAt: instant(3), items: [{ equipmentId: item.id, quantity: 4 }] });
  assert.equal(future.items[0].available, 3); assert.equal(future.items[0].sufficient, false);
  await assert.rejects(createWithdrawal(withdrawal(reservation.id)), status(409));
});

test("formulários rejeitam quantidades inválidas, conferência incompleta e autoria ou data fabricada", async () => {
  const item = await equipment(), { reservation } = await approved(item.id, 2);
  for (const invalid of [withdrawal(reservation.id, 0), withdrawal(reservation.id, -1), withdrawal(reservation.id, 1, { checklist: { ...checklist, conditionChecked: false } }), { ...withdrawal(reservation.id), actorUserId: randomUUID() }, { ...withdrawal(reservation.id), createdAt: instant(-24) }]) await assert.rejects(createWithdrawal(invalid as WithdrawalInput), status(422));
  const row = await createWithdrawal(withdrawal(reservation.id));
  await assert.rejects(settleWithdrawal(row.id, settlement(row.version, { goodQuantity: 2 })), status(409, 422));
  await assert.rejects(settleWithdrawal(row.id, settlement(row.version, { goodQuantity: 0, damagedQuantity: 1, notes: "" })), status(422));
  await assert.rejects(settleWithdrawal(row.id, settlement(row.version, { goodQuantity: 0 })), status(422));
  assert.equal((await getMovementDetail(row.id)).movement.pendingQuantity, 1);
});

test("retirada antecipada, prazo além da aprovação e retirada após o término são bloqueados", async () => {
  const item = await equipment();
  const future = await approved(item.id, 1, { startsAt: instant(2), endsAt: instant(3) });
  await assert.rejects(createWithdrawal(withdrawal(future.reservation.id)), status(409));
  const current = await approved(item.id, 1);
  await assert.rejects(createWithdrawal(withdrawal(current.reservation.id, 1, { expectedReturnAt: instant(2) })), status(409, 422));
  await db.reservation.update({ where: { id: current.reservation.id }, data: { startsAt: new Date(instant(-3)), endsAt: new Date(instant(-2)) } });
  await assert.rejects(createWithdrawal(withdrawal(current.reservation.id)), status(409));
});

test("somente reserva ativa de solicitação aprovada permite retirada; cancelamentos não são ignorados", async () => {
  const item = await equipment();
  const legacy = await db.reservation.create({ data: { equipmentId: item.id, quantity: 1, startsAt: new Date(instant(-0.5)), endsAt: new Date(instant(1)) } });
  await assert.rejects(createWithdrawal(withdrawal(legacy.id)), status(409, 422));
  const { request, reservation } = await approved(item.id, 1);
  await decideRequest(request.id, { action: "cancel", version: request.version, reason: "Cancelamento antes da retirada" });
  await assert.rejects(createWithdrawal(withdrawal(reservation.id)), status(409));
});

test("patrimônios retirados são exclusivos e retornos individuais exigem identificação correta", async () => {
  const prefix = randomUUID();
  const item = await equipment({ trackingMode: "INDIVIDUAL", total: 3, maintenance: 1, units: [{ assetNumber: `${prefix}-A`, status: "AVAILABLE" }, { assetNumber: `${prefix}-B`, status: "AVAILABLE" }, { assetNumber: `${prefix}-M`, status: "MAINTENANCE" }] });
  const { reservation } = await approved(item.id, 2);
  const options = (await withdrawalOptions(new URLSearchParams({ equipmentId: item.id }))).items.find((row) => row.reservationId === reservation.id)!;
  const eligible = options.units.filter((unit) => unit.available);
  assert.equal(eligible.length, 2);
  const a = await createWithdrawal(withdrawal(reservation.id, 1, { unitIds: [eligible[0].id] }));
  await assert.rejects(createWithdrawal(withdrawal(reservation.id, 1, { unitIds: [eligible[0].id] })), status(409, 422));
  await assert.rejects(createWithdrawal(withdrawal(reservation.id, 1, { unitIds: [item.units.find((unit) => unit.status === "MAINTENANCE")!.id] })), status(409, 422));
  const b = await createWithdrawal(withdrawal(reservation.id, 1, { unitIds: [eligible[1].id] }));
  await assert.rejects(settleWithdrawal(a.id, settlement(a.version, { units: [{ unitId: eligible[1].id, condition: "GOOD" }] })), status(409, 422));
  await settleWithdrawal(a.id, settlement(a.version, { goodQuantity: 0, damagedQuantity: 1, units: [{ unitId: eligible[0].id, condition: "DAMAGED" }], notes: "Patrimônio com avaria" }));
  await settleWithdrawal(b.id, settlement(b.version, { goodQuantity: 0, lostQuantity: 1, units: [{ unitId: eligible[1].id, condition: "LOST" }], notes: "Patrimônio extraviado" }));
  const stock = (await getEquipmentDetail(item.id)).equipment;
  assert.deepEqual([stock.available, stock.inUse, stock.maintenance, stock.lost], [0, 0, 2, 1]);
  assert.equal(stock.units.find((unit) => unit.id === eligible[1].id)?.status, "LOST");
  const history = await assetMovementHistory(eligible[0].id);
  assert.equal(history.items[0].movement.destination, "Auditório Bloco A");
  assert.equal(history.items[0].settlements[0].units[0].condition, "DAMAGED");
});

test("duas retiradas concorrentes e duas devoluções concorrentes não duplicam unidades nem saldos", async () => {
  const item = await equipment({ trackingMode: "INDIVIDUAL", total: 1, units: [{ assetNumber: `CONC-${randomUUID()}`, status: "AVAILABLE" }] });
  const { reservation } = await approved(item.id, 1);
  const input = withdrawal(reservation.id, 1, { unitIds: [item.units[0].id] });
  const withdrawals = await Promise.allSettled([createWithdrawal(input), createWithdrawal(input)]);
  const successful = withdrawals.filter((result) => result.status === "fulfilled"); assert.equal(successful.length, 1);
  const row = successful[0].status === "fulfilled" ? successful[0].value : null; assert.ok(row);
  const returns = await Promise.allSettled([settleWithdrawal(row.id, settlement(row.version, { units: [{ unitId: item.units[0].id, condition: "GOOD" }] })), settleWithdrawal(row.id, settlement(row.version, { units: [{ unitId: item.units[0].id, condition: "GOOD" }] }))]);
  assert.equal(returns.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await db.withdrawalSettlement.count({ where: { withdrawalId: row.id } }), 1);
  assert.equal((await getEquipmentDetail(item.id)).equipment.available, 1);
});

test("extensão exige nova análise de conflitos e não reescreve o período original da reserva", async () => {
  const item = await equipment({ total: 1 }), current = await approved(item.id, 1);
  await approved(item.id, 1, { startsAt: instant(2), endsAt: instant(4) });
  const row = await createWithdrawal(withdrawal(current.reservation.id));
  await assert.rejects(extendWithdrawal(row.id, { version: row.version, expectedReturnAt: instant(3), reason: "Conflito com evento futuro" }), status(409));
  const extended = await extendWithdrawal(row.id, { version: row.version, expectedReturnAt: instant(1.5), reason: "Uso adicional sem sobreposição futura" });
  assert.ok(new Date(extended.expectedReturnAt!) > new Date(row.expectedReturnAt!));
  assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: current.reservation.id } })).endsAt.toISOString(), current.reservation.endsAt);
  assert.ok((await getMovementDetail(row.id)).history.length >= 2);
});

test("extensão preserva capacidade ainda não retirada da própria reserva sem contar emissões duas vezes", async () => {
  const item = await equipment({ total: 3 }), { reservation } = await approved(item.id, 3);
  const target = await createWithdrawal(withdrawal(reservation.id));
  const damaged = await createWithdrawal(withdrawal(reservation.id));
  await settleWithdrawal(damaged.id, settlement(damaged.version, { goodQuantity: 0, damagedQuantity: 1, notes: "Avaria registrada antes da extensão" }));
  const extended = await extendWithdrawal(target.id, { version: target.version, expectedReturnAt: instant(2), reason: "Capacidade preservada para a unidade ainda não retirada" });
  assert.equal(extended.pendingQuantity, 1);
  assert.equal((await getEquipmentDetail(item.id)).equipment.reserved, 1);
  const flagged = await listMovements(new URLSearchParams({ reservationId: reservation.id, status: "DAMAGED" }));
  assert.equal(flagged.items[0].id, damaged.id);
});

test("filtros de ocorrências incluem movimentações parciais e vínculo de solicitação é validado", async () => {
  const item = await equipment(), { reservation, request } = await approved(item.id, 3);
  const row = await createWithdrawal(withdrawal(reservation.id, 3));
  await settleWithdrawal(row.id, settlement(row.version, { goodQuantity: 0, damagedQuantity: 1, lostQuantity: 1, notes: "Uma avaria e um extravio; uma unidade permanece em uso" }));
  for (const incident of ["DAMAGED", "LOST"]) {
    const list = await listMovements(new URLSearchParams({ requestId: request.id, status: incident }));
    assert.equal(list.items[0].id, row.id); assert.equal(list.items[0].status, "PARTIAL");
  }
  await assert.rejects(listMovements(new URLSearchParams({ requestId: "invalid" })), status(400));
});

test("atrasos mantêm pendências e bloqueiam cancelamento de evento ou reserva até a regularização", async () => {
  const item = await equipment(), record = await approved(item.id, 1);
  const row = await createWithdrawal(withdrawal(record.reservation.id));
  await db.withdrawal.update({ where: { id: row.id }, data: { createdAt: new Date(instant(-3)), expectedReturnAt: new Date(instant(-1)) } });
  await db.reservation.update({ where: { id: record.reservation.id }, data: { startsAt: new Date(instant(-3)), endsAt: new Date(instant(-1)) } });
  assert.equal((await getMovementDetail(row.id)).movement.status, "OVERDUE");
  assert.equal((await listMovements(new URLSearchParams({ eventId: record.event.id, status: "OVERDUE" }))).items.length, 1);
  await assert.rejects(decideRequest(record.request.id, { action: "cancel", version: record.request.version, reason: "Ainda em utilização" }), status(409));
  await assert.rejects(updateEvent(record.event.id, { ...record.eventInput, status: "CANCELLED", version: record.event.version, reason: "Há retirada pendente" }), status(409));
  await assert.rejects(archiveEvent(record.event.id, record.event.version, "Há retirada pendente"), status(409));
  await assert.rejects(deleteEquipment(item.id, (await getEquipmentDetail(item.id)).equipment.version), status(409));
  const returned = await settleWithdrawal(row.id, settlement(row.version));
  await decideRequest(record.request.id, { action: "cancel", version: record.request.version, reason: "Retorno regularizado" });
  await archiveEvent(record.event.id, record.event.version, "Histórico preservado após devolução");
  await deleteEquipment(item.id, (await getEquipmentDetail(item.id)).equipment.version);
  assert.equal((await getMovementDetail(returned.id)).movement.eventTitle, record.event.title);
});

test("permissão específica é obrigatória e sua revogação impede novas conferências", async () => {
  const item = await equipment(), { reservation } = await approved(item.id, 2);
  const secret = randomBytes(24).toString("base64url");
  let user = await createUser({ name: "Operador de movimentação", email: `physical-${randomUUID()}@unisalesiano.com.br`, role: "MULTIMEIOS", active: true, permissions: [], password: secret }); userIds.push(user.id);
  let login = await authenticateCredentials(user.email, secret); assert.ok(login);
  await withSessionToken(login.sessionToken, () => assert.rejects(createWithdrawal(withdrawal(reservation.id)), status(403)));
  user = await updateUser(user.id, { name: user.name, email: user.email, role: user.role, active: true, permissions: ["MOVEMENTS_WRITE"], version: user.version });
  login = await authenticateCredentials(user.email, secret); assert.ok(login);
  const row = await withSessionToken(login.sessionToken, () => createWithdrawal(withdrawal(reservation.id)));
  await withSessionToken(login.sessionToken, () => assert.rejects(extendWithdrawal(row.id, { version: row.version, expectedReturnAt: instant(2), reason: "Falta permissão de análise" }), status(403)));
  await updateUser(user.id, { name: user.name, email: user.email, role: user.role, active: false, permissions: ["MOVEMENTS_WRITE"], version: user.version });
  await withSessionToken(login.sessionToken, () => assert.rejects(settleWithdrawal(row.id, settlement(row.version)), status(401)));
  await withSessionToken("invalid", () => assert.rejects(getMovementDetail(row.id), status(401)));
  assert.equal((await getMovementDetail(row.id)).movement.pendingQuantity, 1);
});

test("busca, filtros, indicadores e histórico são persistidos e consultas não inventam movimentações", async () => {
  const item = await equipment(), { reservation, event } = await approved(item.id, 1);
  assert.equal((await listMovements(new URLSearchParams({ equipmentId: item.id }))).pagination.total, 0);
  assert.equal((await withdrawalOptions(new URLSearchParams({ q: item.name, eventId: event.id }))).items[0].reservationId, reservation.id);
  assert.equal((await withdrawalOptions(new URLSearchParams({ q: randomUUID(), eventId: event.id }))).items.length, 0);
  const row = await createWithdrawal(withdrawal(reservation.id));
  const list = await listMovements(new URLSearchParams({ equipmentId: item.id, eventId: event.id, responsible: "Responsável pela retirada", q: "Auditório", pageSize: "6" }));
  assert.equal(list.items[0].id, row.id); assert.equal(list.pagination.total, 1);
  assert.equal((await getMovementDetail(row.id)).movement.actorUserId, integrationUserId);
  assert.ok((await overviewMovements()).summary.inUse >= 1);
  await assert.rejects(listMovements(new URLSearchParams({ status: "fake" })), status(400));
  await assert.rejects(db.withdrawal.update({ where: { id: row.id }, data: { returnedQuantity: 2 } }));
});
