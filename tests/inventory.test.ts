import "dotenv/config";
import assert from "node:assert/strict";
import { after } from "node:test";
import { test, cleanupAuthentication } from "./helpers/integration-auth";
import { randomUUID } from "node:crypto";
import { getPrisma } from "@/server/prisma";
import { createEquipment, deleteEquipment, getEquipmentDetail, listEquipment, updateEquipment } from "@/server/inventory-service";
import { validateEquipment } from "@/lib/inventory-validation";
import { InventoryError } from "@/server/inventory-error";
import type { EquipmentInput, InventoryEquipment } from "@/types/inventory";

const connection = process.env.DATABASE_URL;
assert.ok(connection && new URL(connection).pathname === "/unieventos_test", "Estes testes só podem rodar no banco unieventos_test.");
const db = getPrisma();
const created: string[] = [];

function input(overrides: Partial<EquipmentInput> = {}): EquipmentInput {
  return { name: `Integração ${randomUUID()}`, category: "Teste isolado", description: "Registro criado apenas por teste automatizado.", location: "Laboratório de teste", trackingMode: "QUANTITY", total: 10, maintenance: 0, units: [], ...overrides };
}
async function create(overrides: Partial<EquipmentInput> = {}) {
  const item = await createEquipment(input(overrides));
  created.push(item.id);
  return item;
}
function edit(item: InventoryEquipment, overrides: Partial<EquipmentInput> = {}): EquipmentInput {
  return { name: item.name, category: item.category, description: item.description, location: item.location, trackingMode: item.trackingMode, total: item.total, maintenance: item.maintenance, units: item.units, version: item.version, reason: "Conferência automatizada", ...overrides };
}
function conflict(error: unknown) { return error instanceof InventoryError && error.status === 409; }

after(async () => {
  // Only IDs created by this test process are removed, exclusively in the test database.
  await db.withdrawalUnit.deleteMany({ where: { withdrawal: { equipmentId: { in: created } } } });
  await db.reservationUnit.deleteMany({ where: { reservation: { equipmentId: { in: created } } } });
  await db.withdrawal.deleteMany({ where: { equipmentId: { in: created } } });
  await db.reservation.deleteMany({ where: { equipmentId: { in: created } } });
  await db.stockHistory.deleteMany({ where: { equipmentId: { in: created } } });
  await db.equipmentUnit.deleteMany({ where: { equipmentId: { in: created } } });
  await db.equipment.deleteMany({ where: { id: { in: created } } });
  await cleanupAuthentication();
  await db.$disconnect();
});

test("validação rejeita negativos, frações, patrimônio repetido e alteração sem motivo", () => {
  assert.equal(validateEquipment(input({ total: -1 })).success, false);
  assert.equal(validateEquipment(input({ total: 1.5 })).success, false);
  assert.equal(validateEquipment(input({ total: 2, maintenance: 3 })).success, false);
  assert.equal(validateEquipment(input({ trackingMode: "INDIVIDUAL", total: 2, units: [{ assetNumber: " uni-1 ", status: "AVAILABLE" }, { assetNumber: "UNI-1", status: "AVAILABLE" }] })).success, false);
  assert.equal(validateEquipment(input({ version: 1 }), true).success, false);
});

test("cadastro e edição são persistidos com histórico; banco rejeita saldo negativo", async () => {
  const item = await create();
  const updated = await updateEquipment(item.id, edit(item, { total: 12, maintenance: 2 }));
  assert.equal(updated.available, 10);
  assert.equal(updated.version, 2);
  const detail = await getEquipmentDetail(item.id);
  assert.equal(detail.historyPagination.total, 2);
  assert.match(detail.history[0].description, /Conferência automatizada/);
  await assert.rejects(db.equipment.update({ where: { id: item.id }, data: { total: -1 } }));
  assert.equal((await getEquipmentDetail(item.id)).equipment.total, 12);
});

test("retirada reduz a reserva sem dupla contagem, devolução parcial libera o saldo correto", async () => {
  const item = await create();
  const now = Date.now();
  const reservation = await db.reservation.create({ data: { equipmentId: item.id, quantity: 4, startsAt: new Date(now - 60_000), endsAt: new Date(now + 3_600_000) } });
  const withdrawal = await db.withdrawal.create({ data: { equipmentId: item.id, reservationId: reservation.id, quantity: 2 } });
  let detail = await getEquipmentDetail(item.id);
  assert.deepEqual([detail.equipment.available, detail.equipment.reserved, detail.equipment.inUse], [6, 2, 2]);
  await db.withdrawal.update({ where: { id: withdrawal.id }, data: { returnedQuantity: 1 } });
  detail = await getEquipmentDetail(item.id);
  assert.deepEqual([detail.equipment.available, detail.equipment.reserved, detail.equipment.inUse], [7, 2, 1]);
  assert.equal(detail.canDelete, false);
  await assert.rejects(deleteEquipment(item.id, item.version), conflict);
  await assert.rejects(updateEquipment(item.id, edit(detail.equipment, { total: 2 })), conflict);
});

test("reservas futuras bloqueiam exclusão sem subtrair do disponível atual; adjacência permite ajuste", async () => {
  const item = await create();
  const now = Date.now();
  await db.reservation.createMany({ data: [
    { equipmentId: item.id, quantity: 4, startsAt: new Date(now + 3_600_000), endsAt: new Date(now + 7_200_000) },
    { equipmentId: item.id, quantity: 4, startsAt: new Date(now + 7_200_000), endsAt: new Date(now + 10_800_000) },
  ] });
  const detail = await getEquipmentDetail(item.id);
  assert.equal(detail.equipment.available, 10);
  assert.equal(detail.equipment.reserved, 0);
  await assert.rejects(deleteEquipment(item.id, item.version), conflict);
  const reduced = await updateEquipment(item.id, edit(detail.equipment, { total: 4 }));
  assert.equal(reduced.total, 4);
  await assert.rejects(updateEquipment(item.id, edit(reduced, { total: 3 })), conflict);
});

test("reservas sobrepostas exigem capacidade no pico do intervalo", async () => {
  const item = await create();
  const now = Date.now();
  await db.reservation.createMany({ data: [
    { equipmentId: item.id, quantity: 4, startsAt: new Date(now + 60_000), endsAt: new Date(now + 180_000) },
    { equipmentId: item.id, quantity: 3, startsAt: new Date(now + 120_000), endsAt: new Date(now + 240_000) },
  ] });
  await assert.rejects(updateEquipment(item.id, edit(item, { total: 6 })), conflict);
  assert.equal((await updateEquipment(item.id, edit(item, { total: 7 }))).total, 7);
});

test("unidades patrimoniais têm unicidade global e vínculos impedem remoção ou mudança de estado", async () => {
  const asset = `TEST-${randomUUID()}`;
  const item = await create({ trackingMode: "INDIVIDUAL", total: 2, units: [{ assetNumber: asset, status: "AVAILABLE" }, { assetNumber: `${asset}-B`, status: "AVAILABLE" }] });
  await assert.rejects(create({ trackingMode: "INDIVIDUAL", total: 1, units: [{ assetNumber: asset, status: "AVAILABLE" }] }));
  const target = item.units.find((unit) => unit.assetNumber === asset)!;
  const now = Date.now();
  await db.reservation.create({ data: { equipmentId: item.id, quantity: 1, startsAt: new Date(now + 60_000), endsAt: new Date(now + 120_000), units: { create: { unitId: target.id } } } });
  await assert.rejects(updateEquipment(item.id, edit(item, { units: item.units.filter((unit) => unit.id !== target.id), total: 1 })), conflict);
  await assert.rejects(updateEquipment(item.id, edit(item, { units: item.units.map((unit) => unit.id === target.id ? { ...unit, status: "MAINTENANCE" } : unit), maintenance: 1 })), conflict);
});

test("edições concorrentes não sobrescrevem dados; alteração rejeitada não deixa histórico", async () => {
  const item = await create();
  const result = await Promise.allSettled([
    updateEquipment(item.id, edit(item, { location: "Sala A" })),
    updateEquipment(item.id, edit(item, { location: "Sala B" })),
  ]);
  assert.equal(result.filter((entry) => entry.status === "fulfilled").length, 1);
  const failed = result.find((entry) => entry.status === "rejected");
  assert.ok(failed?.status === "rejected" && conflict(failed.reason));
  const detail = await getEquipmentDetail(item.id);
  assert.equal(detail.equipment.version, 2);
  assert.equal(detail.historyPagination.total, 2);
});

test("arquivamento preserva histórico e remove da listagem ativa", async () => {
  const item = await create();
  await deleteEquipment(item.id, item.version);
  const detail = await getEquipmentDetail(item.id);
  assert.ok(detail.equipment.archivedAt);
  assert.equal(detail.historyPagination.total, 2);
  const active = await listEquipment(new URLSearchParams({ q: item.name }));
  const archived = await listEquipment(new URLSearchParams({ q: item.name, status: "archived" }));
  assert.equal(active.items.length, 0);
  assert.equal(archived.items[0].id, item.id);
  await assert.rejects(updateEquipment(item.id, edit(detail.equipment)), conflict);
});

test("troca de patrimônios preserva unidades, versão e histórico sem valores temporários", async () => {
  const asset = `SWAP-${randomUUID()}`;
  const item = await create({ trackingMode: "INDIVIDUAL", total: 2, units: [{ assetNumber: `${asset}-A`, status: "AVAILABLE" }, { assetNumber: `${asset}-B`, status: "AVAILABLE" }] });
  const [first, second] = item.units;
  const updated = await updateEquipment(item.id, edit(item, {
    units: [{ ...first, assetNumber: second.assetNumber }, { ...second, assetNumber: first.assetNumber }],
    reason: "Correção dos patrimônios entre unidades",
  }));
  assert.equal(updated.version, item.version + 1);
  assert.equal(updated.units.find((unit) => unit.id === first.id)?.assetNumber, second.assetNumber);
  assert.equal(updated.units.find((unit) => unit.id === second.id)?.assetNumber, first.assetNumber);
  const detail = await getEquipmentDetail(item.id);
  assert.deepEqual(detail.equipment.units, updated.units);
  assert.equal(detail.historyPagination.total, 2);
  const change = await db.stockHistory.findFirstOrThrow({ where: { equipmentId: item.id, action: "ALTERACAO" } });
  const before = change.before as unknown as InventoryEquipment;
  const after = change.after as unknown as InventoryEquipment;
  assert.deepEqual(before.units, item.units);
  assert.deepEqual(after.units, updated.units);
  assert.equal(JSON.stringify(change).includes("__UNIEVENTOS_SWAP_"), false);
  assert.equal((await db.equipmentUnit.findMany({ where: { equipmentId: item.id, assetNumber: { startsWith: "__UNIEVENTOS_SWAP_" } } })).length, 0);
});
