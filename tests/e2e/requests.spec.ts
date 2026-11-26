import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { type APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";
import { addDays, institutionalToInstant, instantToInstitutionalInput, todayInstitutional } from "../../src/lib/event-time";
import type { CalendarEvent, EventInput, EventMutation } from "../../src/types/events";
import type { EquipmentDetail, InventoryEquipment } from "../../src/types/inventory";
import type { EquipmentRequest, RequestDetail, RequestList } from "../../src/types/requests";

function testConnection() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value || new URL(value).pathname !== "/unieventos_test" || value === process.env.DATABASE_URL) throw new Error("Os testes de solicitações exigem banco unieventos_test isolado do banco de uso.");
  return value;
}

async function equipmentFixture(api: APIRequestContext, token: string): Promise<InventoryEquipment> {
  testConnection();
  const response = await api.post("/api/equipment", { data: { name: `Projetor pedidos E2E ${token}`, category: "Audiovisual E2E pedidos", description: "Equipamento criado exclusivamente no banco isolado.", location: "Depósito de testes", trackingMode: "QUANTITY", total: 3, maintenance: 1, units: [] } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as { equipment: InventoryEquipment }).equipment;
}

async function eventFixture(api: APIRequestContext, token: string, needs: EventInput["equipmentNeeds"] = []): Promise<CalendarEvent> {
  testConnection();
  const day = addDays(todayInstitutional(), 7);
  const input: EventInput = { title: `Evento pedidos E2E ${token}`, description: "Planejamento institucional isolado para testes de solicitações.", department: "Marketing", responsibleName: "Equipe declarada E2E", contact: "pedidos.e2e@unisalesiano.edu.br", location: `Sala pedidos E2E ${token}`, kind: "EXTERNAL", status: "PLANNED", startsAt: institutionalToInstant(`${day}T09:00`), endsAt: institutionalToInstant(`${day}T11:00`), equipmentNeeds: needs };
  const response = await api.post("/api/events", { data: input });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as EventMutation).event;
}

async function detail(api: APIRequestContext, id: string): Promise<RequestDetail> {
  const response = await api.get(`/api/requests/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as RequestDetail;
}

async function cleanup(eventId: string | undefined, equipmentId: string) {
  const client = new Client({ connectionString: testConnection() });
  await client.connect();
  try {
    await client.query("BEGIN");
    if (eventId) {
      const items = 'SELECT i.id FROM "EquipmentRequestItem" i JOIN "EquipmentRequest" r ON r.id = i."requestId" WHERE r."eventId" = $1';
      await client.query(`DELETE FROM "ReservationUnit" WHERE "reservationId" IN (SELECT id FROM "Reservation" WHERE "requestItemId" IN (${items}))`, [eventId]);
      await client.query(`DELETE FROM "Reservation" WHERE "requestItemId" IN (${items})`, [eventId]);
      await client.query('DELETE FROM "RequestHistory" WHERE "requestId" IN (SELECT id FROM "EquipmentRequest" WHERE "eventId" = $1)', [eventId]);
      await client.query('DELETE FROM "EquipmentRequestItem" WHERE "requestId" IN (SELECT id FROM "EquipmentRequest" WHERE "eventId" = $1)', [eventId]);
      await client.query('DELETE FROM "EquipmentRequest" WHERE "eventId" = $1', [eventId]);
      await client.query('DELETE FROM "EventEquipmentNeed" WHERE "eventId" = $1', [eventId]);
      await client.query('DELETE FROM "EventHistory" WHERE "eventId" = $1', [eventId]);
      await client.query('DELETE FROM "CalendarEvent" WHERE id = $1', [eventId]);
    }
    await client.query('DELETE FROM "StockHistory" WHERE "equipmentId" = $1', [equipmentId]);
    await client.query('DELETE FROM "EquipmentUnit" WHERE "equipmentId" = $1', [equipmentId]);
    await client.query('DELETE FROM "Equipment" WHERE id = $1', [equipmentId]);
    await client.query("COMMIT");
  } catch (failure) { await client.query("ROLLBACK"); throw failure; }
  finally { await client.end(); }
}

test("rascunho, edição, disponibilidade, envio e persistência sem reservar automaticamente", async ({ page, request: api, playwright }) => {
  test.setTimeout(120_000);
  const token = randomUUID().slice(0, 8);
  const equipment = await equipmentFixture(api, token);
  let event: CalendarEvent | undefined;
  try {
    event = await eventFixture(api, token);
    await page.goto(`/solicitacoes?eventId=${event.id}`);
    await page.getByRole("button", { name: "Nova solicitação", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Evento", { exact: true })).toHaveValue(event.id);
    await expect(dialog.getByLabel("Responsável declarado", { exact: true })).toHaveValue(event.responsibleName);
    await expect(dialog.getByLabel("Início necessário", { exact: true })).toHaveValue(instantToInstitutionalInput(event.startsAt));
    await dialog.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
    await expect(dialog.getByText("Adicione pelo menos um equipamento real do estoque.", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Adicionar equipamento", exact: true }).click();
    await dialog.getByLabel("Equipamento 1", { exact: true }).selectOption(equipment.id);
    await dialog.getByLabel("Quantidade 1", { exact: true }).fill("0");
    await dialog.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
    await expect(dialog.getByLabel("Quantidade 1", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await dialog.getByLabel("Quantidade 1", { exact: true }).fill("3");
    await dialog.getByRole("button", { name: "Consultar disponibilidade", exact: true }).click();
    await expect(dialog.getByRole("region", { name: "Disponibilidade no período", exact: true })).toContainText("3 solicitadas · 2 disponíveis");
    await dialog.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/solicitacoes\/[a-f0-9-]+$/);
    const id = page.url().split("/").at(-1)!;
    await page.reload();
    await expect(page.getByRole("heading", { name: `Pedido para ${event.title}`, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Reservas da solicitação", exact: true })).toContainText("Nenhuma reserva criada");
    await page.getByRole("button", { name: "Editar rascunho", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Quantidade 1", { exact: true }).fill("2");
    await dialog.getByLabel("Observações gerais", { exact: true }).fill("Separar também cabos compatíveis para montagem.");
    await dialog.getByRole("button", { name: "Consultar disponibilidade", exact: true }).click();
    await expect(dialog.getByRole("region", { name: "Disponibilidade no período", exact: true })).toContainText("2 solicitadas · 2 disponíveis");
    await dialog.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    let saved = await detail(api, id);
    expect(saved.request.items[0].quantity).toBe(2);
    expect(saved.request.notes).toContain("cabos compatíveis");
    expect(saved.request.status).toBe("DRAFT");
    await page.getByRole("button", { name: "Enviar para análise", exact: true }).click();
    await expect(page.getByRole("region", { name: "Informações da solicitação", exact: true })).toContainText("Pendente");
    await page.reload();
    await expect(page.getByRole("button", { name: "Aprovar solicitação", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Recusar com justificativa", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Cancelar solicitação/ })).toBeEnabled();
    saved = await detail(api, id);
    expect(saved.request.status).toBe("PENDING");
    expect(saved.reservations).toHaveLength(0);
    expect(saved.permissions.approve).toBe(true);
    expect(saved.history.length).toBeGreaterThanOrEqual(3);
    expect(saved.history.every((entry) => entry.actorUserId !== null)).toBe(true);
    const anonymous = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100", storageState: { cookies: [], origins: [] } });
    try { for (const action of ["approve", "refuse", "cancel"]) {
      const denied = await anonymous.post(`/api/requests/${id}/decision`, { headers: { "x-role": "admin", "x-user-id": randomUUID(), "x-department": "Multimeios" }, data: { action, version: saved.request.version, reason: "Tentativa por identidade declarada no cliente.", actorUserId: randomUUID(), department: "Multimeios", permissions: ["APPROVE_REQUESTS"] } });
      expect(denied.status(), await denied.text()).toBe(401);
    } } finally { await anonymous.dispose(); }
    expect((await detail(api, id)).request.status).toBe("PENDING");
    const stock = await (await api.get(`/api/equipment/${equipment.id}`)).json() as EquipmentDetail;
    expect(stock.equipment.reserved).toBe(0); expect(stock.equipment.inUse).toBe(0); expect(stock.equipment.available).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally { await cleanup(event?.id, equipment.id); }
});

test("importação preliminar é idempotente e a listagem filtra registros persistidos", async ({ page, request: api }) => {
  test.setTimeout(100_000);
  const token = randomUUID().slice(0, 8);
  const equipment = await equipmentFixture(api, token);
  let event: CalendarEvent | undefined;
  try {
    event = await eventFixture(api, token, [{ equipmentId: equipment.id, quantity: 2, notes: "Montagem antecipada da projeção." }]);
    await page.goto(`/solicitacoes?eventId=${event.id}`);
    await page.getByRole("button", { name: "Nova solicitação", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Importar necessidades do evento", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/solicitacoes\/[a-f0-9-]+$/);
    const id = page.url().split("/").at(-1)!;
    const again = await api.post("/api/requests/import-needs", { data: { eventId: event.id } });
    expect(again.ok(), await again.text()).toBe(true);
    expect((await again.json() as EquipmentRequest).id).toBe(id);
    const saved = await detail(api, id);
    expect(saved.request.importedFromNeeds).toBe(true); expect(saved.request.items).toHaveLength(1); expect(saved.reservations).toHaveLength(0);
    expect(saved.request.items[0].notes).toBe("Montagem antecipada da projeção.");
    const actualEvent = await (await api.get(`/api/events/${event.id}`)).json() as { event: CalendarEvent };
    expect(actualEvent.event.equipmentNeeds).toHaveLength(1);
    const all = await (await api.get(`/api/requests?eventId=${event.id}`)).json() as RequestList;
    expect(all.items).toHaveLength(1);
    await page.goto("/solicitacoes");
    const search = page.getByRole("textbox", { name: "Buscar solicitação, evento ou responsável...", exact: true });
    await search.fill(token);
    await expect(page.getByRole("link", { name: event.title, exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Setor solicitante", exact: true }).selectOption("Multimeios");
    await expect(page.getByRole("heading", { name: "Nenhuma solicitação encontrada", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Setor solicitante", exact: true }).selectOption("Marketing");
    await page.getByRole("combobox", { name: "Status da solicitação", exact: true }).selectOption("DRAFT");
    await page.getByLabel("Período inicial", { exact: true }).fill(instantToInstitutionalInput(event.startsAt).slice(0, 10));
    await page.getByLabel("Período final", { exact: true }).fill(instantToInstitutionalInput(event.endsAt).slice(0, 10));
    await expect(page.getByRole("link", { name: event.title, exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Status da solicitação", exact: true }).selectOption("PENDING");
    await expect(page.getByRole("heading", { name: "Nenhuma solicitação encontrada", exact: true })).toBeVisible();
    await page.goto("/solicitacoes?status=PENDING");
    await expect(page.getByRole("combobox", { name: "Status da solicitação", exact: true })).toHaveValue("PENDING");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally { await cleanup(event?.id, equipment.id); }
});

test("falha de consulta exibe erro recuperável sem usar solicitações fictícias", async ({ page }) => {
  let fail = true;
  await page.route("**/api/requests?*", (route) => fail ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Solicitações temporariamente indisponíveis." }) }) : route.continue());
  await page.goto("/solicitacoes");
  await expect(page.getByRole("alert").filter({ hasText: "Solicitações temporariamente indisponíveis." })).toBeVisible();
  fail = false;
  const recovered = page.waitForResponse((response) => response.url().includes("/api/requests?") && response.ok());
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await recovered;
  await expect(page.getByRole("alert").filter({ hasText: "Solicitações temporariamente indisponíveis." })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Solicitações", exact: true })).toBeVisible();
});
