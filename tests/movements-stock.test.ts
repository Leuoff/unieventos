import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after } from "node:test";
import { test, cleanupAuthentication, integrationUserId } from "./helpers/integration-auth";
import { getPrisma } from "@/server/prisma";
import { createEquipment, deleteEquipment, getEquipmentDetail, updateEquipment } from "@/server/inventory-service";
import { availabilityInclude, calculateRequestAvailability } from "@/server/requests-availability";
import { createEvent, updateEvent, archiveEvent } from "@/server/events-service";
import { decideRequest } from "@/server/requests-service";
import { InventoryError } from "@/server/inventory-error";
import type { EquipmentInput, InventoryEquipment } from "@/types/inventory";
import type { CalendarEvent, EventInput } from "@/types/events";

assert.ok(process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === "/unieventos_test", "Use exclusivamente o banco isolado.");
const db = getPrisma();
const equipmentIds: string[] = [];
const eventIds: string[] = [];
const requestIds: string[] = [];
const conflict = (error: unknown) => error instanceof InventoryError && error.status === 409;

async function equipment(overrides: Partial<EquipmentInput> = {}) {
  const item = await createEquipment({ name: `Estoque físico ${randomUUID()}`, category: "Teste isolado", description: "Integração exclusiva de teste.", location: "Conferência de teste", trackingMode: "QUANTITY", total: 5, maintenance: 0, units: [], ...overrides });
  equipmentIds.push(item.id); return item;
}
function edit(item: InventoryEquipment, overrides: Partial<EquipmentInput> = {}): EquipmentInput {
  return { name: item.name, category: item.category, description: item.description, location: item.location, trackingMode: item.trackingMode, total: item.total, maintenance: item.maintenance, units: item.units, version: item.version, reason: "Conferência física automatizada", ...overrides };
}
function eventEdit(item: CalendarEvent, overrides: Partial<EventInput> = {}): EventInput {
  return { title: item.title, description: item.description, department: item.department, responsibleName: item.responsibleName, contact: item.contact, location: item.location, kind: item.kind, status: item.status, startsAt: item.startsAt, endsAt: item.endsAt, equipmentNeeds: [], version: item.version, reason: "Conferência física automatizada", ...overrides };
}
async function pastReservation(item: InventoryEquipment) {
  const now = Date.now();
  const { event } = await createEvent({ title: `Evento encerrado no tempo ${randomUUID()}`, description: "Fixture exclusiva de teste.", department: "Multimeios", responsibleName: "Responsável operacional informado", contact: "conferencia@unisalesiano.com.br", location: "Sala de teste isolada", kind: "INTERNAL", status: "CONFIRMED", startsAt: new Date(now - 7_200_000).toISOString(), endsAt: new Date(now - 3_600_000).toISOString(), equipmentNeeds: [] });
  eventIds.push(event.id);
  // Arrange only: legacy approved records with an expired interval. No production data.
  const request = await db.equipmentRequest.create({ data: { eventId: event.id, createdByUserId: integrationUserId, responsibleName: "Responsável de teste", startsAt: new Date(now - 7_200_000), endsAt: new Date(now - 3_600_000), status: "APPROVED", searchText: "movimentação isolada", items: { create: { equipmentId: item.id, quantity: 1 } } }, include: { items: true } });
  requestIds.push(request.id);
  const reservation = await db.reservation.create({ data: { equipmentId: item.id, requestItemId: request.items[0].id, quantity: 1, startsAt: request.startsAt, endsAt: request.endsAt } });
  return { event, request, reservation };
}

after(async () => {
  await db.withdrawalUnit.deleteMany({ where: { withdrawal: { equipmentId: { in: equipmentIds } } } });
  await db.reservationUnit.deleteMany({ where: { reservation: { equipmentId: { in: equipmentIds } } } });
  await db.withdrawal.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
  await db.reservation.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
  await db.requestHistory.deleteMany({ where: { requestId: { in: requestIds } } });
  await db.equipmentRequestItem.deleteMany({ where: { requestId: { in: requestIds } } });
  await db.equipmentRequest.deleteMany({ where: { id: { in: requestIds } } });
  await db.eventHistory.deleteMany({ where: { eventId: { in: eventIds } } });
  await db.calendarEvent.deleteMany({ where: { id: { in: eventIds } } });
  await db.stockHistory.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
  await db.equipmentUnit.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
  await db.equipment.deleteMany({ where: { id: { in: equipmentIds } } });
  await cleanupAuthentication(); await db.$disconnect();
});

test("extravios regularizam retirada sem voltar ao disponível nem duplicar o uso físico", async () => {
  const item = await equipment(); const now = Date.now();
  const reservation = await db.reservation.create({ data: { equipmentId: item.id, quantity: 3, startsAt: new Date(now - 60_000), endsAt: new Date(now + 3_600_000) } });
  await db.withdrawal.create({ data: { equipmentId: item.id, reservationId: reservation.id, quantity: 2, returnedQuantity: 1, lostQuantity: 1 } });
  await db.equipment.update({ where: { id: item.id }, data: { lost: 1 } });
  const detail = await getEquipmentDetail(item.id);
  assert.deepEqual([detail.equipment.available, detail.equipment.reserved, detail.equipment.inUse, detail.equipment.lost], [3, 1, 0, 1]);
  const row = await db.equipment.findUniqueOrThrow({ where: { id: item.id }, include: availabilityInclude });
  const result = calculateRequestAvailability(row, 4, new Date(now + 10_000), new Date(now + 20_000));
  assert.equal(result.item.available, 3); assert.equal(result.item.sufficient, false);
  await assert.rejects(updateEquipment(item.id, edit(detail.equipment, { total: 1 })), conflict);
});

test("atraso que compromete reserva atual apresenta conflito sem ocultar estoque", async () => {
  const item = await equipment({ total: 1 }); const now = Date.now();
  const expired = await db.reservation.create({ data: { equipmentId: item.id, quantity: 1, startsAt: new Date(now - 120_000), endsAt: new Date(now - 60_000) } });
  await db.withdrawal.create({ data: { equipmentId: item.id, reservationId: expired.id, quantity: 1 } });
  await db.reservation.create({ data: { equipmentId: item.id, quantity: 1, startsAt: new Date(now - 30_000), endsAt: new Date(now + 3_600_000) } });
  const detail = await getEquipmentDetail(item.id);
  assert.deepEqual([detail.equipment.available, detail.equipment.inUse, detail.equipment.reserved, detail.equipment.conflictQuantity], [0, 1, 1, 1]);
  assert.equal(detail.canDelete, false);
  const row = await db.equipment.findUniqueOrThrow({ where: { id: item.id }, include: availabilityInclude });
  assert.equal(calculateRequestAvailability(row, 1, new Date(now), new Date(now + 60_000)).item.available, 0);
});

test("patrimônio extraviado conserva identificação e não pode ser recuperado pelo CRUD", async () => {
  await assert.rejects(equipment({ trackingMode: "INDIVIDUAL", total: 1, units: [{ assetNumber: `FAKE-LOSS-${randomUUID()}`, status: "LOST" }] }), (error) => error instanceof InventoryError && error.status === 422);
  const item = await equipment({ trackingMode: "INDIVIDUAL", total: 2, units: [{ assetNumber: `LOST-${randomUUID()}`, status: "AVAILABLE" }, { assetNumber: `GOOD-${randomUUID()}`, status: "AVAILABLE" }] });
  const unit = item.units[0];
  await db.equipmentUnit.update({ where: { id: unit.id }, data: { state: "LOST" } });
  await db.equipment.update({ where: { id: item.id }, data: { lost: 1 } });
  let current = (await getEquipmentDetail(item.id)).equipment;
  assert.equal(current.units.find((row) => row.id === unit.id)?.status, "LOST");
  assert.deepEqual([current.available, current.lost, current.inUse], [1, 1, 0]);
  await assert.rejects(updateEquipment(item.id, edit(current, { units: current.units.map((row) => row.id === unit.id ? { ...row, status: "AVAILABLE" } : row) })), conflict);
  await assert.rejects(updateEquipment(item.id, edit(current, { units: current.units.map((row) => row.id === unit.id ? { ...row, assetNumber: "OUTRO-PATRIMONIO" } : row) })), conflict);
  await assert.rejects(updateEquipment(item.id, edit(current, { total: 1, units: current.units.filter((row) => row.id !== unit.id) })), conflict);
  current = await updateEquipment(item.id, edit(current, { description: "Descrição atualizada preservando extravio" }));
  assert.equal(current.units.find((row) => row.id === unit.id)?.status, "LOST");
  const record = await db.equipment.findUniqueOrThrow({ where: { id: item.id }, include: availabilityInclude });
  assert.deepEqual(calculateRequestAvailability(record, 1, new Date(), new Date(Date.now() + 60_000)).unitIds, current.units.filter((row) => row.status === "AVAILABLE").map((row) => row.id));
});

test("devolução consome reserva individual uma única vez e permite manutenção após conferência", async () => {
  const item = await equipment({ trackingMode: "INDIVIDUAL", total: 1, units: [{ assetNumber: `RETURN-${randomUUID()}`, status: "AVAILABLE" }] });
  const unit = item.units[0]; const now = Date.now();
  const reservation = await db.reservation.create({ data: { equipmentId: item.id, quantity: 1, startsAt: new Date(now - 60_000), endsAt: new Date(now + 3_600_000), units: { create: { unitId: unit.id } } } });
  await db.withdrawal.create({ data: { equipmentId: item.id, reservationId: reservation.id, quantity: 1, returnedQuantity: 1, units: { create: { unitId: unit.id, returnedAt: new Date() } } } });
  const current = (await getEquipmentDetail(item.id)).equipment;
  assert.deepEqual([current.available, current.reserved, current.inUse], [1, 0, 0]);
  const updated = await updateEquipment(item.id, edit(current, { maintenance: 1, units: [{ ...current.units[0], status: "MAINTENANCE" }] }));
  assert.deepEqual([updated.available, updated.maintenance, updated.reserved], [0, 1, 0]);
  const record = await db.equipment.findUniqueOrThrow({ where: { id: item.id }, include: availabilityInclude });
  assert.equal(calculateRequestAvailability(record, 1, new Date(), new Date(now + 60_000)).item.available, 0);
});

test("retirada em reserva vencida impede cancelamento e arquivamento até regularização", async () => {
  const item = await equipment(); const { event, request, reservation } = await pastReservation(item);
  const withdrawal = await db.withdrawal.create({ data: { equipmentId: item.id, reservationId: reservation.id, quantity: 1 } });
  await assert.rejects(updateEvent(event.id, eventEdit(event, { status: "CANCELLED" })), conflict);
  await assert.rejects(updateEvent(event.id, eventEdit(event, { status: "COMPLETED" })), conflict);
  await assert.rejects(archiveEvent(event.id, event.version, "Arquivamento não deve esconder retirada"), conflict);
  await assert.rejects(decideRequest(request.id, { action: "cancel", version: request.version, reason: "Cancelamento com retirada pendente" }), conflict);
  await assert.rejects(deleteEquipment(item.id, item.version), conflict);
  // Arrange a settled legacy outcome; physical-service tests cover its audited recording.
  await db.withdrawal.update({ where: { id: withdrawal.id }, data: { lostQuantity: 1 } });
  await db.equipment.update({ where: { id: item.id }, data: { lost: 1 } });
  assert.equal((await decideRequest(request.id, { action: "cancel", version: request.version, reason: "Extravio totalmente regularizado no teste" })).status, "CANCELLED");
  const cancelled = await updateEvent(event.id, eventEdit(event, { status: "CANCELLED" }));
  await archiveEvent(event.id, cancelled.event.version, "Preservar evento e ocorrência regularizada");
  assert.equal((await getEquipmentDetail(item.id)).equipment.available, item.total - 1);
  await deleteEquipment(item.id, item.version);
  assert.ok((await getEquipmentDetail(item.id)).equipment.archivedAt);
  assert.equal(await db.withdrawal.count({ where: { id: withdrawal.id } }), 1);
});
