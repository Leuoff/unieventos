import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, createAccount, removeAccount, loginApi, isolatedConnection } from "./fixtures";
import type { CalendarEvent, EventMutation } from "../../src/types/events";
import type { EquipmentDetail, InventoryEquipment } from "../../src/types/inventory";
import type { EquipmentRequest, RequestDetail } from "../../src/types/requests";
import type { MovementDetail, MovementList, PhysicalMovement, WithdrawalInput } from "../../src/types/movements";
import { instantToInstitutionalInput, institutionalToInstant } from "../../src/lib/event-time";

interface OwnedRecords { equipmentIds: string[]; eventIds: string[] }
interface Fixture { equipment: InventoryEquipment; event: CalendarEvent; reservationId: string; requestId: string }
interface FixtureOptions { equipment?: InventoryEquipment; total?: number; quantity?: number; startsAt?: string; endsAt?: string }
const checked = { quantityChecked: true, conditionChecked: true, accessoriesChecked: true };

async function fixture(api: APIRequestContext, owned: OwnedRecords, individual = false, options: FixtureOptions = {}): Promise<Fixture> {
  isolatedConnection();
  const token = randomUUID().slice(0, 8);
  let equipment = options.equipment;
  if (!equipment) {
    const response = await api.post("/api/equipment", { data: { name: `Movimento E2E ${token}`, category: "Conferência E2E", description: "Registro exclusivo do banco de testes isolado.", location: "Depósito de teste", trackingMode: individual ? "INDIVIDUAL" : "QUANTITY", total: options.total ?? (individual ? 2 : 5), maintenance: 0, units: individual ? [{ assetNumber: `MOV-${token}-A`, status: "AVAILABLE" }, { assetNumber: `MOV-${token}-B`, status: "AVAILABLE" }] : [] } });
    expect(response.ok(), await response.text()).toBe(true);
    equipment = (await response.json() as { equipment: InventoryEquipment }).equipment; owned.equipmentIds.push(equipment.id);
  }
  const now = Date.now();
  const creation = await api.post("/api/events", { data: { title: `Evento físico E2E ${token}`, description: "Evento real apenas no banco isolado para testar movimentações.", department: "Multimeios", responsibleName: "Contato operacional E2E", contact: "conferencia@unisalesiano.com.br", location: `Sala de conferência ${token}`, kind: "INTERNAL", status: "CONFIRMED", startsAt: options.startsAt ?? new Date(now - 1_800_000).toISOString(), endsAt: options.endsAt ?? new Date(now + 7_200_000).toISOString(), equipmentNeeds: [] } });
  expect(creation.ok(), await creation.text()).toBe(true);
  const { event } = await creation.json() as EventMutation; owned.eventIds.push(event.id);
  const draftResponse = await api.post("/api/requests", { data: { eventId: event.id, responsibleName: event.responsibleName, startsAt: event.startsAt, endsAt: event.endsAt, notes: "Solicitação de teste isolado", items: [{ equipmentId: equipment.id, quantity: options.quantity ?? (individual ? 2 : 4), notes: "Conferir acessórios" }] } });
  expect(draftResponse.ok(), await draftResponse.text()).toBe(true);
  const draft = await draftResponse.json() as EquipmentRequest;
  const submission = await api.post(`/api/requests/${draft.id}/submit`, { data: { version: draft.version } });
  expect(submission.ok(), await submission.text()).toBe(true);
  const pending = await submission.json() as EquipmentRequest;
  const approval = await api.post(`/api/requests/${draft.id}/decision`, { data: { action: "approve", version: pending.version } });
  expect(approval.ok(), await approval.text()).toBe(true);
  const details = await api.get(`/api/requests/${draft.id}`);
  expect(details.ok(), await details.text()).toBe(true);
  const request = await details.json() as RequestDetail;
  expect(request.reservations).toHaveLength(1);
  return { equipment, event, reservationId: request.reservations[0].id, requestId: draft.id };
}

async function cleanup(owned: OwnedRecords) {
  const db = new Client({ connectionString: isolatedConnection() }); await db.connect();
  try {
    await db.query("BEGIN");
    const withdrawals = 'SELECT id FROM "Withdrawal" WHERE "equipmentId"=ANY($1::uuid[])';
    const settlements = `SELECT id FROM "WithdrawalSettlement" WHERE "withdrawalId" IN (${withdrawals})`;
    await db.query(`DELETE FROM "WithdrawalSettlementUnit" WHERE "settlementId" IN (${settlements})`, [owned.equipmentIds]);
    await db.query(`DELETE FROM "WithdrawalSettlement" WHERE "withdrawalId" IN (${withdrawals})`, [owned.equipmentIds]);
    await db.query(`DELETE FROM "MovementHistory" WHERE "withdrawalId" IN (${withdrawals})`, [owned.equipmentIds]);
    await db.query(`DELETE FROM "AuditLog" WHERE "entityType"='Withdrawal' AND "entityId" IN (${withdrawals})`, [owned.equipmentIds]);
    await db.query(`DELETE FROM "WithdrawalUnit" WHERE "withdrawalId" IN (${withdrawals})`, [owned.equipmentIds]);
    await db.query('DELETE FROM "Withdrawal" WHERE "equipmentId"=ANY($1::uuid[])', [owned.equipmentIds]);
    await db.query('DELETE FROM "ReservationUnit" WHERE "reservationId" IN (SELECT id FROM "Reservation" WHERE "equipmentId"=ANY($1::uuid[]))', [owned.equipmentIds]);
    await db.query('DELETE FROM "Reservation" WHERE "equipmentId"=ANY($1::uuid[])', [owned.equipmentIds]);
    await db.query('DELETE FROM "RequestHistory" WHERE "requestId" IN (SELECT id FROM "EquipmentRequest" WHERE "eventId"=ANY($1::uuid[]))', [owned.eventIds]);
    await db.query('DELETE FROM "EquipmentRequestItem" WHERE "requestId" IN (SELECT id FROM "EquipmentRequest" WHERE "eventId"=ANY($1::uuid[]))', [owned.eventIds]);
    await db.query('DELETE FROM "EquipmentRequest" WHERE "eventId"=ANY($1::uuid[])', [owned.eventIds]);
    await db.query('DELETE FROM "EventEquipmentNeed" WHERE "eventId"=ANY($1::uuid[])', [owned.eventIds]);
    await db.query('DELETE FROM "EventHistory" WHERE "eventId"=ANY($1::uuid[])', [owned.eventIds]);
    await db.query('DELETE FROM "CalendarEvent" WHERE id=ANY($1::uuid[])', [owned.eventIds]);
    await db.query('DELETE FROM "StockHistory" WHERE "equipmentId"=ANY($1::uuid[])', [owned.equipmentIds]);
    await db.query('DELETE FROM "EquipmentUnit" WHERE "equipmentId"=ANY($1::uuid[])', [owned.equipmentIds]);
    await db.query('DELETE FROM "Equipment" WHERE id=ANY($1::uuid[])', [owned.equipmentIds]);
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { await db.end(); }
}
async function checklist(dialog: Locator) {
  await dialog.getByRole("checkbox", { name: "Conferi as quantidades e os patrimônios selecionados", exact: true }).check();
  await dialog.getByRole("checkbox", { name: "Conferi as condições físicas dos equipamentos", exact: true }).check();
  await dialog.getByRole("checkbox", { name: "Conferi cabos, acessórios e demais componentes", exact: true }).check();
}
async function beginWithdrawal(page: Page, data: Fixture) {
  await page.goto("/movimentacoes");
  await page.getByRole("button", { name: "Registrar retirada", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Reserva aprovada", { exact: true })).toBeEnabled();
  await dialog.getByLabel("Reserva aprovada", { exact: true }).selectOption(data.reservationId);
  await dialog.getByLabel("Responsável pela retirada", { exact: true }).fill("Equipe operacional E2E");
  await dialog.getByLabel("Local de destino", { exact: true }).fill("Auditório de teste E2E");
  return dialog;
}
async function confirmWithdrawal(page: Page, dialog: Locator) {
  await checklist(dialog);
  await dialog.getByRole("button", { name: "Confirmar retirada", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/movimentacoes\/[a-f0-9-]+$/);
  return page.url().split("/").at(-1)!;
}
async function movement(api: APIRequestContext, id: string) {
  const response = await api.get(`/api/movements/${id}`);
  expect(response.ok(), await response.text()).toBe(true); return await response.json() as MovementDetail;
}
async function stock(api: APIRequestContext, id: string) {
  const response = await api.get(`/api/equipment/${id}`);
  expect(response.ok(), await response.text()).toBe(true); return (await response.json() as EquipmentDetail).equipment;
}
async function apiWithdrawal(api: APIRequestContext, data: Fixture, quantity: number, unitIds: string[] = []) {
  const input: WithdrawalInput = { reservationId: data.reservationId, quantity, unitIds, responsibleName: "Responsável E2E conferido", destination: "Destino de teste isolado", notes: "Conferência completa de teste", checklist: checked };
  const response = await api.post("/api/movements", { data: input });
  expect(response.ok(), await response.text()).toBe(true); return await response.json() as PhysicalMovement;
}

test("retiradas parciais exigem checklist e persistem sem duplicar reserva e utilização", async ({ page, request: api, account }) => {
  test.setTimeout(120_000); const owned: OwnedRecords = { equipmentIds: [], eventIds: [] };
  try {
    const data = await fixture(api, owned);
    let dialog = await beginWithdrawal(page, data);
    await dialog.getByLabel("Quantidade a retirar", { exact: true }).fill("2");
    await dialog.getByRole("button", { name: "Confirmar retirada", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("checklist");
    const first = await confirmWithdrawal(page, dialog);
    await page.reload();
    await expect(page.getByRole("region", { name: "Informações da movimentação", exact: true })).toContainText("Equipe operacional E2E");
    await page.screenshot({ path: test.info().outputPath("movement-detail.png"), fullPage: true });
    const saved = await movement(api, first);
    expect(saved.movement.actorUserId).toBe(account.id); expect(saved.movement.quantity).toBe(2); expect(saved.movement.checklist).toEqual(checked);
    dialog = await beginWithdrawal(page, data);
    await dialog.getByLabel("Quantidade a retirar", { exact: true }).fill("1");
    const second = await confirmWithdrawal(page, dialog);
    expect(second).not.toBe(first);
    const equipment = await stock(api, data.equipment.id);
    expect([equipment.available, equipment.reserved, equipment.inUse]).toEqual([1, 1, 3]);
    const list = await (await api.get(`/api/movements?eventId=${data.event.id}`)).json() as MovementList;
    expect(list.items).toHaveLength(2); expect(list.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally { await cleanup(owned); }
});

test("devoluções parciais, avarias e extravios preservam saldos físicos distintos e filtros", async ({ page, request: api }) => {
  test.setTimeout(120_000); const owned: OwnedRecords = { equipmentIds: [], eventIds: [] };
  try {
    const data = await fixture(api, owned); const issued = await apiWithdrawal(api, data, 4);
    await page.goto(`/movimentacoes/${issued.id}`);
    await page.getByRole("button", { name: "Registrar devolução / ocorrência", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Em boas condições", { exact: true }).fill("1");
    await dialog.getByLabel("Com avaria", { exact: true }).fill("1");
    await dialog.getByRole("button", { name: "Confirmar conferência", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Descreva a avaria ou o extravio");
    await dialog.getByLabel("Observações da conferência e ocorrências", { exact: true }).fill("Uma unidade retornou com avaria no conector.");
    await checklist(dialog); await dialog.getByRole("button", { name: "Confirmar conferência", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("region", { name: "Informações da movimentação", exact: true })).toContainText("Devolução parcial");
    let equipment = await stock(api, data.equipment.id);
    expect([equipment.available, equipment.inUse, equipment.maintenance, equipment.lost]).toEqual([2, 2, 1, 0]);
    await page.getByRole("button", { name: "Registrar devolução / ocorrência", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Extraviadas", { exact: true }).fill("1");
    await dialog.getByLabel("Observações da conferência e ocorrências", { exact: true }).fill("Uma unidade não foi localizada após conferência.");
    await checklist(dialog); await dialog.getByRole("button", { name: "Confirmar conferência", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(async () => (await movement(api, issued.id)).movement.pendingQuantity).toBe(1);
    equipment = await stock(api, data.equipment.id);
    expect([equipment.available, equipment.inUse, equipment.maintenance, equipment.lost]).toEqual([2, 1, 1, 1]);
    await page.getByRole("button", { name: "Registrar devolução / ocorrência", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Em boas condições", { exact: true }).fill("1");
    await checklist(dialog); await dialog.getByRole("button", { name: "Confirmar conferência", exact: true }).click();
    await expect(dialog).not.toBeVisible(); await page.reload();
    await expect(page.getByRole("region", { name: "Informações da movimentação", exact: true })).toContainText("Com extravio");
    const saved = await movement(api, issued.id);
    expect([saved.movement.returnedQuantity, saved.movement.lostQuantity, saved.movement.pendingQuantity]).toEqual([3, 1, 0]);
    expect(saved.settlements).toHaveLength(3); expect(saved.settlements.every((item) => item.checklist.quantityChecked && item.actorUserId)).toBe(true);
    equipment = await stock(api, data.equipment.id);
    expect([equipment.available, equipment.inUse, equipment.maintenance, equipment.lost]).toEqual([3, 0, 1, 1]);
    await page.goto("/movimentacoes");
    await page.getByRole("textbox", { name: "Buscar equipamento, evento, destino ou patrimônio...", exact: true }).fill(data.equipment.name);
    await page.getByRole("combobox", { name: "Status da movimentação", exact: true }).selectOption("LOST");
    await expect(page.getByRole("link", { name: data.equipment.name, exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Status da movimentação", exact: true }).selectOption("COMPLETED");
    await expect(page.getByRole("heading", { name: "Nenhuma movimentação encontrada", exact: true })).toBeVisible();
  } finally { await cleanup(owned); }
});

test("patrimônios selecionados mantêm histórico e vínculos com evento e equipamento", async ({ page, request: api }) => {
  test.setTimeout(120_000); const owned: OwnedRecords = { equipmentIds: [], eventIds: [] };
  try {
    const data = await fixture(api, owned, true);
    let dialog = await beginWithdrawal(page, data);
    for (const unit of data.equipment.units) await dialog.getByRole("checkbox", { name: unit.assetNumber, exact: true }).check();
    const id = await confirmWithdrawal(page, dialog);
    await page.getByRole("button", { name: "Registrar devolução / ocorrência", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel(`Patrimônio ${data.equipment.units[0].assetNumber}`, { exact: true }).selectOption("GOOD");
    await dialog.getByLabel(`Patrimônio ${data.equipment.units[1].assetNumber}`, { exact: true }).selectOption("LOST");
    await dialog.getByLabel("Observações da conferência e ocorrências", { exact: true }).fill("Segundo patrimônio extraviado durante a utilização.");
    await checklist(dialog); await dialog.getByRole("button", { name: "Confirmar conferência", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const lostUnit = data.equipment.units[1];
    await page.getByRole("link", { name: `Patrimônio ${lostUnit.assetNumber}`, exact: true }).click();
    await expect(page.getByRole("heading", { name: `Patrimônio ${lostUnit.assetNumber}`, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Histórico da movimentação", exact: true })).toContainText("Segundo patrimônio extraviado");
    const info = page.getByRole("region", { name: "Informações da movimentação", exact: true });
    await expect(info).toContainText("Local de destino");
    await info.getByRole("link", { name: data.event.title, exact: true }).click();
    await expect(page.getByRole("region", { name: "Movimentações físicas vinculadas", exact: true })).toContainText(data.equipment.name);
    await page.goto(`/estoque/${data.equipment.id}`);
    const linked = page.getByRole("region", { name: "Movimentações físicas vinculadas", exact: true });
    await expect(linked).toContainText(data.event.title);
    await linked.getByRole("link", { name: data.equipment.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/movimentacoes/${id}$`));
    const equipment = await stock(api, data.equipment.id);
    expect(equipment.units.find((unit) => unit.id === lostUnit.id)?.status).toBe("LOST");
    expect([equipment.available, equipment.lost, equipment.inUse]).toEqual([1, 1, 0]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally { await cleanup(owned); }
});

test("extensão pela interface verifica reserva futura, preserva histórico e atraso exige regularização", async ({ page, request: api }) => {
  test.setTimeout(120_000); const owned: OwnedRecords = { equipmentIds: [], eventIds: [] };
  try {
    const now = Date.now();
    const current = await fixture(api, owned, false, { total: 1, quantity: 1 });
    // Os dois compromissos são aprovados antes de existir uma retirada física.
    await fixture(api, owned, false, { equipment: current.equipment, quantity: 1, startsAt: new Date(now + 4 * 3_600_000).toISOString(), endsAt: new Date(now + 6 * 3_600_000).toISOString() });
    const issued = await apiWithdrawal(api, current, 1);
    await page.goto(`/movimentacoes/${issued.id}`);
    await page.getByRole("button", { name: "Estender utilização", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Novo prazo de devolução (Brasília)", { exact: true }).fill(instantToInstitutionalInput(new Date(now + 5 * 3_600_000).toISOString()));
    await dialog.getByLabel("Justificativa da extensão", { exact: true }).fill("Tentativa com reserva futura conflitante");
    const failed = page.waitForResponse((response) => response.url().endsWith(`/api/movements/${issued.id}/extend`) && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Confirmar extensão", exact: true }).click();
    expect((await failed).status()).toBe(409);
    await expect(dialog.getByRole("alert")).toContainText("conflita com reservas futuras");
    expect((await movement(api, issued.id)).movement.expectedReturnAt).toBe(issued.expectedReturnAt);

    const validInput = instantToInstitutionalInput(new Date(now + 3 * 3_600_000).toISOString());
    await dialog.getByLabel("Novo prazo de devolução (Brasília)", { exact: true }).fill(validInput);
    await dialog.getByLabel("Justificativa da extensão", { exact: true }).fill("Utilização adicional sem conflito com o próximo evento");
    const accepted = page.waitForResponse((response) => response.url().endsWith(`/api/movements/${issued.id}/extend`) && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Confirmar extensão", exact: true }).click();
    expect((await accepted).ok()).toBe(true); await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("region", { name: "Histórico da movimentação", exact: true })).toContainText("Utilização adicional sem conflito com o próximo evento");
    await page.reload();
    expect((await movement(api, issued.id)).movement.expectedReturnAt).toBe(new Date(institutionalToInstant(validInput)).toISOString());
    const approvedRequest = await (await api.get(`/api/requests/${current.requestId}`)).json() as RequestDetail;
    expect(approvedRequest.reservations[0].endsAt).toBe(current.event.endsAt);

    // Somente a fixture isolada é deslocada para o passado, mantendo fim > criação.
    const db = new Client({ connectionString: isolatedConnection() }); await db.connect();
    try { await db.query('UPDATE "Withdrawal" SET "createdAt"=$2, "expectedReturnAt"=$3 WHERE id=$1', [issued.id, new Date(now - 3 * 3_600_000), new Date(now - 3_600_000)]); }
    finally { await db.end(); }
    await page.reload();
    await expect(page.getByRole("region", { name: "Informações da movimentação", exact: true })).toContainText("Em atraso");
    const cancellation = { action: "cancel", version: approvedRequest.request.version, reason: "Cancelamento exige devolução antes da liberação" };
    expect((await api.post(`/api/requests/${current.requestId}/decision`, { data: cancellation })).status()).toBe(409);
    await page.getByRole("button", { name: /^Notificações:/ }).click();
    await page.getByRole("dialog").getByRole("link", { name: /retiradas? em atraso/ }).click();
    await expect(page).toHaveURL(/\/movimentacoes\?status=OVERDUE$/);
    await page.getByRole("textbox", { name: "Buscar equipamento, evento, destino ou patrimônio...", exact: true }).fill(current.equipment.name);
    await expect(page.getByRole("link", { name: current.equipment.name, exact: true })).toBeVisible();
    const overdue = await movement(api, issued.id);
    const returned = await api.post(`/api/movements/${issued.id}/settlements`, { data: { version: overdue.movement.version, goodQuantity: 1, damagedQuantity: 0, lostQuantity: 0, units: [], notes: "Devolução conferida após atraso", checklist: checked } });
    expect(returned.ok(), await returned.text()).toBe(true);
    const cancelled = await api.post(`/api/requests/${current.requestId}/decision`, { data: cancellation });
    expect(cancelled.ok(), await cancelled.text()).toBe(true);
    expect((await movement(api, issued.id)).movement.pendingQuantity).toBe(0);
  } finally { await cleanup(owned); }
});

test("permissão real de movimentação é obrigatória e não concede extensão nem análise de reservas", async ({ browser, request: api, playwright }) => {
  test.setTimeout(120_000); const owned: OwnedRecords = { equipmentIds: [], eventIds: [] };
  const sector = await createAccount("MARKETING"); const operator = await createAccount("MULTIMEIOS", ["MOVEMENTS_WRITE"]);
  const anonymous = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100", storageState: { cookies: [], origins: [] } });
  const sectorApi = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100", storageState: { cookies: [], origins: [] } });
  const operatorApi = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100", storageState: { cookies: [], origins: [] } });
  try {
    const data = await fixture(api, owned);
    await loginApi(sectorApi, sector); await loginApi(operatorApi, operator);
    expect((await anonymous.get("/api/movements")).status()).toBe(401);
    expect((await anonymous.post("/api/movements", { headers: { "x-role": "ADMIN" }, data: { reservationId: data.reservationId } })).status()).toBe(401);
    expect((await sectorApi.get("/api/movements")).ok()).toBe(true);
    const denied = await sectorApi.post("/api/movements", { headers: { "x-role": "ADMIN", "x-user-id": operator.id }, data: { reservationId: data.reservationId, permissions: ["MOVEMENTS_WRITE"] } });
    expect(denied.status()).toBe(403);
    const issued = await apiWithdrawal(operatorApi, data, 1);
    expect(issued.actorUserId).toBe(operator.id);
    expect((await sectorApi.post(`/api/movements/${issued.id}/settlements`, { data: {} })).status()).toBe(403);
    expect((await operatorApi.post(`/api/movements/${issued.id}/extend`, { data: { version: issued.version, expectedReturnAt: new Date(Date.now() + 10_800_000).toISOString(), reason: "Movimentar não autoriza extensão" } })).status()).toBe(403);
    const context = await browser.newContext({ storageState: await sectorApi.storageState() });
    try {
      const page = await context.newPage(); await page.goto("/movimentacoes");
      await expect(page.getByRole("heading", { name: "Movimentações", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Registrar retirada", exact: true })).toHaveCount(0);
      await page.goto(`/movimentacoes/${issued.id}`);
      await expect(page.getByRole("region", { name: "Informações da movimentação", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Registrar devolução / ocorrência", exact: true })).toHaveCount(0);
    } finally { await context.close(); }
  } finally {
    await cleanup(owned); await anonymous.dispose(); await sectorApi.dispose(); await operatorApi.dispose();
    await removeAccount(sector); await removeAccount(operator);
  }
});
