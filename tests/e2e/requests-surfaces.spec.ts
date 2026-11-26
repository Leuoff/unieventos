import { randomUUID } from "node:crypto";
import { type APIRequestContext, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { addDays, institutionalToInstant, todayInstitutional } from "../../src/lib/event-time";
import { formatNumber } from "../../src/lib/format";
import type { CalendarEvent, EventDetail, EventMutation } from "../../src/types/events";
import type { EquipmentDetail, InventoryEquipment } from "../../src/types/inventory";
import type { EquipmentRequest, RequestOverview } from "../../src/types/requests";

function requireTestDatabase() {
  const connection = process.env.TEST_DATABASE_URL;
  if (!connection || new URL(connection).pathname !== "/unieventos_test" || connection === process.env.DATABASE_URL) {
    throw new Error("Os testes de solicitações exigem unieventos_test, separado do banco da aplicação.");
  }
}

async function createEquipment(request: APIRequestContext): Promise<InventoryEquipment> {
  requireTestDatabase();
  const response = await request.post("/api/equipment", { data: {
    name: `Equipamento E2E integração ${randomUUID().slice(0, 8)}`, category: "Testes de solicitações",
    description: "Registro isolado para verificar as integrações de solicitações.", location: "Depósito E2E",
    trackingMode: "QUANTITY", total: 3, maintenance: 0, units: [],
  } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as { equipment: InventoryEquipment }).equipment;
}

async function createEvent(request: APIRequestContext, equipment: InventoryEquipment): Promise<CalendarEvent> {
  requireTestDatabase();
  const day = addDays(todayInstitutional(), 5);
  const response = await request.post("/api/events", { data: {
    title: `Evento E2E solicitações ${randomUUID().slice(0, 8)}`, description: "Encontro para verificar vínculos no banco de testes.",
    department: "Multimeios", responsibleName: "Responsável declarado E2E", contact: "testes@unisalesiano.edu.br",
    location: `Local E2E ${randomUUID().slice(0, 8)}`, kind: "INTERNAL", status: "PLANNED",
    startsAt: institutionalToInstant(`${day}T13:00`), endsAt: institutionalToInstant(`${day}T15:00`),
    equipmentNeeds: [{ equipmentId: equipment.id, quantity: 2, notes: "Necessidade preliminar para verificar os vínculos." }],
  } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as EventMutation).event;
}

async function createDraft(request: APIRequestContext, event: CalendarEvent, equipment: InventoryEquipment): Promise<EquipmentRequest> {
  requireTestDatabase();
  const response = await request.post("/api/requests", { data: {
    eventId: event.id, responsibleName: "Responsável declarado do pedido E2E", startsAt: event.startsAt,
    endsAt: event.endsAt, notes: "Pedido isolado de integração visual, sem aprovação.",
    items: [{ equipmentId: equipment.id, quantity: 1, notes: "Somente solicitação, sem retirada." }],
  } });
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as EquipmentRequest;
}

async function archiveEvent(request: APIRequestContext, id: string) {
  const detail = await request.get(`/api/events/${id}`);
  expect(detail.ok(), await detail.text()).toBe(true);
  const { event } = await detail.json() as EventDetail;
  if (!event.archivedAt) {
    const response = await request.delete(`/api/events/${id}`, { data: { version: event.version, reason: "Encerramento do cenário de integração visual isolado." } });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

async function archiveEquipment(request: APIRequestContext, id: string) {
  const detail = await request.get(`/api/equipment/${id}`);
  expect(detail.ok(), await detail.text()).toBe(true);
  const { equipment } = await detail.json() as EquipmentDetail;
  if (!equipment.archivedAt) {
    const response = await request.delete(`/api/equipment/${id}`, { data: { version: equipment.version } });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

async function dashboardOverview(page: Page, reload = false): Promise<RequestOverview> {
  const query = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/requests/overview" && response.ok());
  if (reload) await page.reload();
  else await page.goto("/");
  return await (await query).json() as RequestOverview;
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test("indicadores, sidebar e notificações usam solicitações persistidas após recarregar", async ({ page, request, isMobile }) => {
  test.setTimeout(60_000);
  const equipment = await createEquipment(request);
  let event: CalendarEvent | undefined;
  try {
    event = await createEvent(request, equipment);
    const draft = await createDraft(request, event, equipment);
    const initial = await dashboardOverview(page);
    const indicators = page.getByRole("region", { name: "Indicadores de solicitações", exact: true });
    await expect(indicators.getByText("Rascunhos", { exact: true }).locator("..").locator("dd")).toHaveText(formatNumber(initial.summary.draft));
    await expect(page.getByText("Equipamentos disponíveis", { exact: true })).toBeVisible();
    await expect(page.getByText("Equipamentos em uso", { exact: true })).toBeVisible();
    await expect(page.getByText("Eventos confirmados", { exact: true })).toBeVisible();

    const submission = await request.post(`/api/requests/${draft.id}/submit`, { data: { version: draft.version } });
    expect(submission.ok(), await submission.text()).toBe(true);
    expect((await submission.json() as EquipmentRequest).status).toBe("PENDING");
    const reloaded = await dashboardOverview(page, true);
    expect(reloaded.summary.pending).toBeGreaterThan(0);
    await expect(indicators.getByText("Solicitações pendentes", { exact: true }).locator("..").locator("dd")).toHaveText(formatNumber(reloaded.summary.pending));
    await expectNoHorizontalOverflow(page);

    if (isMobile) await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
    const navigation = page.getByRole("navigation", { name: "Navegação principal", exact: true });
    await expect(navigation.getByLabel(`${reloaded.summary.pending} solicitações pendentes`, { exact: true })).toBeVisible();
    if (isMobile) await page.keyboard.press("Escape");

    const notifications = page.getByRole("button", { name: new RegExp(`^Notificações: ${reloaded.summary.pending} solicitações pendentes · \\d+ retiradas em atraso$`) });
    await notifications.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Central de notificações", exact: true })).toBeVisible();
    await expect(dialog).toContainText("Pedidos pendentes e devoluções em atraso do UniSALESIANO.");
    await expect(dialog).toContainText(/autorização|permiss|autenticad/);
    await expect(dialog).not.toContainText(/demonstração/);
    const pendingLink = dialog.getByRole("link", { name: /aguardando análise/ });
    await expect(pendingLink).toHaveAttribute("href", "/solicitacoes?status=PENDING");
    await pendingLink.click();
    await expect(page).toHaveURL(/\/solicitacoes\?status=PENDING$/);
    await expect(page.getByRole("heading", { name: "Solicitações", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } finally {
    if (event) await archiveEvent(request, event.id);
    await archiveEquipment(request, equipment.id);
  }
});

test("detalhes de evento e equipamento exibem reservas reais vazias e link de solicitações", async ({ page, request }) => {
  test.setTimeout(60_000);
  const equipment = await createEquipment(request);
  let event: CalendarEvent | undefined;
  try {
    event = await createEvent(request, equipment);
    await createDraft(request, event, equipment);
    await page.goto(`/eventos/${event.id}`);
    await expect(page.getByRole("heading", { name: event.title, exact: true })).toBeVisible();
    const eventReservations = page.getByRole("region", { name: "Reservas de equipamentos", exact: true });
    await expect(eventReservations).toContainText("Nenhuma reserva registrada para este evento.");
    await expect(eventReservations).toContainText("Necessidades preliminares e solicitações pendentes não bloqueiam estoque.");
    await expect(eventReservations).toContainText("A retirada física é registrada separadamente.");
    const eventLink = page.getByRole("link", { name: "Ver solicitações", exact: true });
    await expect(eventLink).toHaveAttribute("href", `/solicitacoes?eventId=${event.id}`);
    await expectNoHorizontalOverflow(page);
    await eventLink.click();
    await expect(page).toHaveURL(new RegExp(`/solicitacoes\\?eventId=${event.id}$`));
    await expect(page.getByRole("heading", { name: "Solicitações", exact: true })).toBeVisible();

    await page.goto(`/estoque/${equipment.id}`);
    await expect(page.getByRole("heading", { name: equipment.name, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Reservas de equipamentos", exact: true })).toContainText("Nenhuma reserva registrada para este equipamento.");
    const stock = page.getByRole("region", { name: "Posição do estoque", exact: true });
    await expect(stock.getByText("Reservados", { exact: true }).locator("..").locator("dd")).toHaveText("0");
    await expect(stock.getByText("Em uso", { exact: true }).locator("..").locator("dd")).toHaveText("0");
    await expectNoHorizontalOverflow(page);

    const persistedEvent = await request.get(`/eventos/${event.id}`);
    expect(persistedEvent.ok()).toBe(true);
    const eventReservationsApi = await request.get(`/api/reservations?eventId=${event.id}`);
    expect(eventReservationsApi.ok(), await eventReservationsApi.text()).toBe(true);
    expect(await eventReservationsApi.json()).toEqual({ items: [] });
    const equipmentReservationsApi = await request.get(`/api/reservations?equipmentId=${equipment.id}`);
    expect(equipmentReservationsApi.ok(), await equipmentReservationsApi.text()).toBe(true);
    expect(await equipmentReservationsApi.json()).toEqual({ items: [] });
  } finally {
    if (event) await archiveEvent(request, event.id);
    await archiveEquipment(request, equipment.id);
  }
});
