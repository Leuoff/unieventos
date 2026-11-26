import "dotenv/config";
import assert from "node:assert/strict";
import { after } from "node:test";
import { test, cleanupAuthentication, integrationUserId } from "./helpers/integration-auth";
import { randomUUID } from "node:crypto";
import { getPrisma } from "@/server/prisma";
import { createEvent, updateEvent, archiveEvent, getEventDetail, listEvents, calendarEvents, eventConflicts } from "@/server/events-service";
import { validateEvent } from "@/lib/events-validation";
import { institutionalToInstant, instantToInstitutionalInput, institutionalDate, institutionalDayRange, eventOverlapsDay } from "@/lib/event-time";
import { createEquipment, deleteEquipment } from "@/server/inventory-service";
import { InventoryError } from "@/server/inventory-error";
import type { CalendarEvent, EventInput } from "@/types/events";

assert.ok(process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === "/unieventos_test", "Use exclusivamente unieventos_test.");
const db = getPrisma();
const eventIds: string[] = [];
const stockIds: string[] = [];
const token = randomUUID();

function input(overrides: Partial<EventInput> = {}): EventInput {
  return { title: `Evento integração ${token} ${randomUUID()}`, description: "Registro de evento exclusivo do banco de testes.", department: "Multimeios", responsibleName: "Responsável declarado de teste", contact: "teste@example.org", location: `Auditório ${token}`, kind: "INTERNAL", status: "CONFIRMED", startsAt: "2040-10-21T11:00:00Z", endsAt: "2040-10-21T13:00:00Z", equipmentNeeds: [], ...overrides };
}
async function create(overrides: Partial<EventInput> = {}) {
  const result = await createEvent(input(overrides));
  eventIds.push(result.event.id);
  return result;
}
function edit(event: CalendarEvent, overrides: Partial<EventInput> = {}): EventInput {
  return { title: event.title, description: event.description, department: event.department, responsibleName: event.responsibleName, contact: event.contact, location: event.location, kind: event.kind, status: event.status, startsAt: event.startsAt, endsAt: event.endsAt, equipmentNeeds: event.equipmentNeeds.map(({ equipmentId, quantity, notes }) => ({ equipmentId, quantity, notes })), version: event.version, reason: "Revisão de planejamento", ...overrides };
}
const conflict = (error: unknown) => error instanceof InventoryError && error.status === 409;

after(async () => {
  await db.eventEquipmentNeed.deleteMany({ where: { eventId: { in: eventIds } } });
  await db.eventHistory.deleteMany({ where: { eventId: { in: eventIds } } });
  await db.calendarEvent.deleteMany({ where: { id: { in: eventIds } } });
  await db.stockHistory.deleteMany({ where: { equipmentId: { in: stockIds } } });
  await db.equipment.deleteMany({ where: { id: { in: stockIds } } });
  await cleanupAuthentication();
  await db.$disconnect();
});

test("fuso institucional independe do dispositivo e respeita meia-noite e mudanças históricas", () => {
  assert.equal(institutionalToInstant("2026-10-21T23:30"), "2026-10-22T02:30:00Z");
  assert.equal(instantToInstitutionalInput("2026-10-22T02:30:00Z"), "2026-10-21T23:30");
  assert.equal(institutionalDate("2026-10-22T02:30:00Z"), "2026-10-21");
  assert.throws(() => institutionalToInstant("2018-11-04T00:30"));
  const range = institutionalDayRange("2018-11-04", "2018-11-04");
  assert.equal((new Date(range.endsAt).getTime() - new Date(range.startsAt).getTime()) / 3_600_000, 23);
  assert.equal(eventOverlapsDay("2026-10-22T02:30:00Z", "2026-10-22T03:00:00Z", "2026-10-22"), false);
});

test("validação rejeita término inválido, data sem offset, identidade injetada e necessidade duplicada", () => {
  assert.equal(validateEvent(input({ endsAt: "2040-10-21T10:00:00Z" })).success, false);
  assert.equal(validateEvent(input({ startsAt: "2040-10-21T08:00" })).success, false);
  assert.equal(validateEvent(input({ contact: "contato inválido" })).success, false);
  assert.equal(validateEvent({ ...input(), createdByUserId: randomUUID() }).success, false);
  const equipmentId = randomUUID();
  assert.equal(validateEvent(input({ equipmentNeeds: [{ equipmentId, quantity: -1, notes: "" }] })).success, false);
  assert.equal(validateEvent(input({ equipmentNeeds: [{ equipmentId, quantity: 1, notes: "" }, { equipmentId, quantity: 2, notes: "" }] })).success, false);
});

test("CRUD persiste, registra histórico e cancelamento/arquivamento preservam o registro", async () => {
  const { event } = await create();
  const updated = await updateEvent(event.id, edit(event, { responsibleName: "Outro responsável declarado", contact: "+55 (18) 99999-0000" }));
  const cancelled = await updateEvent(event.id, edit(updated.event, { status: "CANCELLED", reason: "Organização cancelou o encontro" }));
  let detail = await getEventDetail(event.id);
  assert.equal(detail.event.status, "CANCELLED");
  assert.equal(detail.historyPagination.total, 3);
  assert.equal(detail.history[0].action, "CANCELAMENTO");
  assert.equal((await db.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).createdByUserId, integrationUserId);
  assert.equal(await db.eventHistory.count({ where: { eventId: event.id, actorUserId: integrationUserId } }), 3);
  await archiveEvent(event.id, cancelled.event.version, "Preservar registro cancelado");
  detail = await getEventDetail(event.id);
  assert.ok(detail.event.archivedAt);
  assert.equal(detail.historyPagination.total, 4);
  await assert.rejects(updateEvent(event.id, edit(detail.event)), conflict);
});

test("conflitos de local e intervalo são avisos; fronteiras adjacentes e locais diferentes são permitidos", async () => {
  const location = `Sala Única ${randomUUID()}`;
  const first = await create({ location });
  const same = await create({ location: `  ${location.toUpperCase().replace("Ú", "U")}  `, startsAt: "2040-10-21T12:00:00Z", endsAt: "2040-10-21T14:00:00Z" });
  assert.ok(same.conflicts.some((item) => item.id === first.event.id));
  assert.ok((await getEventDetail(same.event.id)).event.id);
  const different = await create({ location: `${location} outro` });
  assert.equal(different.conflicts.length, 0);
  const adjacent = await create({ location, startsAt: "2040-10-21T14:00:00Z", endsAt: "2040-10-21T15:00:00Z" });
  assert.equal(adjacent.conflicts.length, 0);
  const cancelled = await updateEvent(same.event.id, edit(same.event, { status: "CANCELLED" }));
  assert.equal(cancelled.conflicts.length, 0);
  const result = await eventConflicts(new URLSearchParams({ location, startsAt: "2040-10-21T13:00:00Z", endsAt: "2040-10-21T14:00:00Z" }));
  assert.equal(result.items.length, 0);
  const annotated = await eventConflicts(new URLSearchParams({ location, startsAt: "2040-10-21T13:00:00Z[UTC]", endsAt: "2040-10-21T14:00:00Z[UTC]" }));
  assert.equal(annotated.items.length, 0);
  await assert.rejects(eventConflicts(new URLSearchParams({ location, startsAt: "inválido", endsAt: "inválido" })), (error) => error instanceof InventoryError && error.status === 400);
});

test("necessidades podem superar saldo sem reservar, retirar ou alterar inventário", async () => {
  const equipment = await createEquipment({ name: `Necessidade teste ${token}`, category: "Teste", description: "Equipamento isolado", location: "Laboratório de teste", trackingMode: "QUANTITY", total: 3, maintenance: 0, units: [] });
  stockIds.push(equipment.id);
  const before = await db.equipment.findUniqueOrThrow({ where: { id: equipment.id } });
  const result = await create({ equipmentNeeds: [{ equipmentId: equipment.id, quantity: 50, notes: "Necessidade a avaliar posteriormente" }] });
  const needId = result.event.equipmentNeeds[0].id;
  const changed = await updateEvent(result.event.id, edit(result.event, { equipmentNeeds: [{ equipmentId: equipment.id, quantity: 60, notes: "Estimativa preliminar revisada" }] }));
  assert.equal(changed.event.equipmentNeeds[0].id, needId);
  await updateEvent(result.event.id, edit(changed.event, { status: "CANCELLED" }));
  assert.deepEqual(await db.equipment.findUniqueOrThrow({ where: { id: equipment.id } }), before);
  assert.equal(await db.reservation.count({ where: { equipmentId: equipment.id } }), 0);
  assert.equal(await db.withdrawal.count({ where: { equipmentId: equipment.id } }), 0);
  assert.equal(await db.stockHistory.count({ where: { equipmentId: equipment.id } }), 1);
  await deleteEquipment(equipment.id, equipment.version);
  assert.equal((await getEventDetail(result.event.id)).event.equipmentNeeds[0].equipmentArchived, true);
  await assert.rejects(create({ equipmentNeeds: [{ equipmentId: equipment.id, quantity: 1, notes: "" }] }), conflict);
});

test("filtros, paginação e calendário incluem eventos multidiários no período correto", async () => {
  const title = `Virada ${randomUUID()}`;
  const created = await create({ title, department: "Projeto de Extensão", kind: "EXTERNAL", location: `Local externo ${token}`, startsAt: "2040-10-22T02:30:00Z", endsAt: "2040-10-22T04:00:00Z" });
  const params = new URLSearchParams({ q: title.toUpperCase(), department: "Projeto de Extensão", kind: "EXTERNAL", status: "CONFIRMED", location: created.event.location, from: "2040-10-22", to: "2040-10-22", pageSize: "6" });
  const list = await listEvents(params);
  assert.equal(list.pagination.total, 1);
  assert.equal(list.items[0].id, created.event.id);
  assert.equal((await calendarEvents(params)).items[0].id, created.event.id);
  params.set("from", "2040-10-21"); params.set("to", "2040-10-21");
  assert.equal((await calendarEvents(params)).items[0].id, created.event.id);
  params.set("to", "2040-10-20");
  await assert.rejects(listEvents(params), (error) => error instanceof InventoryError && error.status === 400);
});

test("edições simultâneas não sobrescrevem dados e o PostgreSQL protege o intervalo", async () => {
  const { event } = await create();
  const results = await Promise.allSettled([updateEvent(event.id, edit(event, { title: "Primeira alteração concorrente" })), updateEvent(event.id, edit(event, { title: "Segunda alteração concorrente" }))]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  const detail = await getEventDetail(event.id);
  assert.equal(detail.event.version, 2);
  assert.equal(detail.historyPagination.total, 2);
  await assert.rejects(db.calendarEvent.update({ where: { id: event.id }, data: { endsAt: new Date(event.startsAt) } }));
  assert.equal((await getEventDetail(event.id)).event.endsAt, event.endsAt);
});
