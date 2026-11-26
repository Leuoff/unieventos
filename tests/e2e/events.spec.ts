import { randomUUID } from "node:crypto";
import { type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { addDays, instantToInstitutionalInput, institutionalDayRange, institutionalToInstant, monthRange, todayInstitutional } from "../../src/lib/event-time";
import type { CalendarEvent, EventDetail, EventInput, EventList, EventMutation, EventOverview } from "../../src/types/events";
import type { EquipmentDetail, InventoryEquipment } from "../../src/types/inventory";

function requireTestDatabase() {
  const connection = process.env.TEST_DATABASE_URL;
  if (!connection || new URL(connection).pathname !== "/unieventos_test" || connection === process.env.DATABASE_URL) {
    throw new Error("Os testes de eventos exigem TEST_DATABASE_URL exclusivo para unieventos_test, separado do banco de uso.");
  }
}

function eventInput(title: string, overrides: Partial<EventInput> = {}): EventInput {
  const date = todayInstitutional();
  return {
    title, description: "Encontro institucional para planejamento integrado dos setores.",
    department: "Multimeios", responsibleName: "Responsável declarado E2E", contact: "eventos.e2e@unisalesiano.edu.br",
    location: `Sala E2E ${randomUUID().slice(0, 8)}`, kind: "INTERNAL", status: "PLANNED",
    startsAt: institutionalToInstant(`${date}T13:00`), endsAt: institutionalToInstant(`${date}T15:00`),
    equipmentNeeds: [], ...overrides,
  };
}

async function createEvent(request: APIRequestContext, input: EventInput): Promise<CalendarEvent> {
  requireTestDatabase();
  const response = await request.post("/api/events", { data: input });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as EventMutation).event;
}

async function eventDetail(request: APIRequestContext, id: string): Promise<EventDetail> {
  const response = await request.get(`/api/events/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as EventDetail;
}

async function archiveEvent(request: APIRequestContext, id: string) {
  const { event } = await eventDetail(request, id);
  if (!event.archivedAt) {
    const response = await request.delete(`/api/events/${id}`, { data: { version: event.version, reason: "Encerramento do cenário automatizado isolado." } });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

async function createEquipment(request: APIRequestContext, name: string): Promise<InventoryEquipment> {
  requireTestDatabase();
  const response = await request.post("/api/equipment", { data: {
    name, category: "Audiovisual E2E eventos", description: "Equipamento real no banco isolado de testes.",
    location: "Depósito de testes E2E", trackingMode: "QUANTITY", total: 3, maintenance: 0, units: [],
  } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as { equipment: InventoryEquipment }).equipment;
}

async function equipmentDetail(request: APIRequestContext, id: string): Promise<EquipmentDetail> {
  const response = await request.get(`/api/equipment/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as EquipmentDetail;
}

async function archiveEquipment(request: APIRequestContext, id: string) {
  const { equipment } = await equipmentDetail(request, id);
  if (!equipment.archivedAt) {
    const response = await request.delete(`/api/equipment/${id}`, { data: { version: equipment.version } });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

async function fillEvent(dialog: Locator, input: EventInput) {
  await dialog.getByLabel("Título do evento", { exact: true }).fill(input.title);
  await dialog.getByLabel("Descrição", { exact: true }).fill(input.description);
  await dialog.getByLabel("Setor organizador", { exact: true }).selectOption(input.department);
  await dialog.getByLabel("Responsável declarado", { exact: true }).fill(input.responsibleName);
  await dialog.getByLabel("Contato (e-mail ou telefone)", { exact: true }).fill(input.contact);
  await dialog.getByLabel("Local", { exact: true }).fill(input.location);
  await dialog.getByLabel("Tipo de evento", { exact: true }).selectOption(input.kind);
  await dialog.getByLabel("Status", { exact: true }).selectOption(input.status);
  await dialog.getByLabel("Início", { exact: true }).fill(instantToInstitutionalInput(input.startsAt));
  await dialog.getByLabel("Término", { exact: true }).fill(instantToInstitutionalInput(input.endsAt));
}

async function showList(page: Page) {
  await page.getByRole("button", { name: "Lista", exact: true }).click();
}

test("cadastro valida dados, persiste necessidades preliminares, edita, cancela e arquiva com histórico", async ({ page, request }) => {
  test.setTimeout(90_000);
  requireTestDatabase();
  const token = randomUUID().slice(0, 8);
  const input = eventInput(`E2E encontro integrado ${token}`);
  const equipment = await createEquipment(request, `Projetor para evento E2E ${token}`);
  let eventId: string | undefined;
  const before = (await equipmentDetail(request, equipment.id)).equipment;
  try {
    await page.goto("/eventos");
    await page.getByRole("button", { name: "Novo evento", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await fillEvent(dialog, input);
    await expect(dialog).toContainText(/America\/Sao_Paulo/);
    await dialog.getByLabel("Término", { exact: true }).fill(instantToInstitutionalInput(input.startsAt));
    await dialog.getByRole("button", { name: "Criar evento", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(/posterior|revise/i);
    await expect(dialog.getByLabel("Término", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await dialog.getByLabel("Término", { exact: true }).fill(instantToInstitutionalInput(input.endsAt));
    await dialog.getByLabel("Contato (e-mail ou telefone)", { exact: true }).fill("inválido");
    await dialog.getByRole("button", { name: "Criar evento", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(/contato|revise/i);
    await expect(dialog.getByLabel("Contato (e-mail ou telefone)", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await dialog.getByLabel("Contato (e-mail ou telefone)", { exact: true }).fill(input.contact);
    await dialog.getByRole("button", { name: "Adicionar equipamento", exact: true }).click();
    await dialog.getByLabel("Equipamento 1", { exact: true }).selectOption(equipment.id);
    await dialog.getByLabel("Quantidade 1", { exact: true }).fill("-1");
    await dialog.getByRole("button", { name: "Criar evento", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(/quantidade|revise/i);
    await dialog.getByLabel("Quantidade 1", { exact: true }).fill("12");
    await dialog.getByLabel("Observações 1", { exact: true }).fill("Avaliar empréstimo complementar; pedido preliminar acima do saldo atual.");
    await expect(dialog).toContainText(/preliminar/i);
    await expect(dialog).toContainText(/não.*reserv|sem.*reserv/i);
    const creation = page.waitForResponse((response) => response.url().endsWith("/api/events") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Criar evento", exact: true }).click();
    const response = await creation;
    expect(response.ok(), await response.text()).toBe(true);
    eventId = (await response.json() as EventMutation).event.id;
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /cadastrado|criado/i })).toBeVisible();

    await page.goto(`/eventos/${eventId}`);
    await expect(page.getByRole("heading", { name: input.title, exact: true })).toBeVisible();
    await expect(page.getByText(equipment.name, { exact: true })).toBeVisible();
    await expect(page.getByText(input.responsibleName, { exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText(/declarad/i);
    await expect(page.locator("main")).toContainText(/preliminar/i);
    await page.reload();
    const created = await eventDetail(request, eventId);
    expect(created.event.title).toBe(input.title);
    expect(new Date(created.event.startsAt).getTime()).toBe(new Date(input.startsAt).getTime());
    expect(new Date(created.event.endsAt).getTime()).toBe(new Date(input.endsAt).getTime());
    expect(created.event.equipmentNeeds).toEqual([expect.objectContaining({ equipmentId: equipment.id, quantity: 12 })]);
    expect((await equipmentDetail(request, equipment.id)).equipment).toMatchObject({ total: before.total, available: before.available, reserved: before.reserved, inUse: before.inUse, maintenance: before.maintenance, version: before.version });

    await page.getByRole("button", { name: "Editar evento", exact: true }).click();
    const newTitle = `${input.title} revisado`;
    await dialog.getByLabel("Título do evento", { exact: true }).fill(newTitle);
    await dialog.getByLabel("Responsável declarado", { exact: true }).fill("Coordenação declarada de Marketing");
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(/motivo|revise/i);
    const reason = "Ajuste de título e responsável após planejamento conjunto.";
    await dialog.getByLabel("Motivo da alteração", { exact: true }).fill(reason);
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("heading", { name: newTitle, exact: true })).toBeVisible();
    await expect(page.getByText(reason, { exact: false })).toBeVisible();
    await page.reload();
    expect((await eventDetail(request, eventId)).event.title).toBe(newTitle);

    await page.getByRole("button", { name: "Cancelar evento", exact: true }).click();
    const cancellation = "Atividade remarcada por solicitação da coordenação.";
    await dialog.getByLabel("Motivo do cancelamento", { exact: true }).fill(cancellation);
    await dialog.getByRole("button", { name: "Confirmar cancelamento", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    const cancelled = await eventDetail(request, eventId);
    expect(cancelled.event).toMatchObject({ status: "CANCELLED", archivedAt: null });
    expect(cancelled.history.some((entry) => entry.description.includes(cancellation))).toBe(true);
    expect(cancelled.history.some((entry) => entry.description.includes(reason))).toBe(true);
    await expect(page.getByText("Cancelado", { exact: true })).toBeVisible();
    expect((await equipmentDetail(request, equipment.id)).equipment).toMatchObject({ total: 3, available: 3, reserved: 0, inUse: 0, maintenance: 0, version: before.version });

    await page.getByRole("button", { name: "Arquivar evento", exact: true }).click();
    await dialog.getByLabel("Motivo do arquivamento", { exact: true }).fill("Registro encerrado após cancelamento, com histórico preservado.");
    await dialog.getByRole("button", { name: "Confirmar arquivamento", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const archived = await eventDetail(request, eventId);
    expect(archived.event.archivedAt).not.toBeNull();
    expect(archived.history.some((entry) => entry.description.includes(cancellation))).toBe(true);
    const list = await request.get("/api/events", { params: { q: token } });
    expect((await list.json() as EventList).items).toHaveLength(0);
    await page.goto("/eventos");
    await showList(page);
    await page.getByRole("textbox", { name: /Buscar evento/ }).fill(token);
    await expect(page.getByRole("heading", { name: newTitle, exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Situação do cadastro", exact: true }).selectOption("1");
    await expect(page.getByRole("heading", { name: newTitle, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    if (eventId) await archiveEvent(request, eventId);
    await archiveEquipment(request, equipment.id);
  }
});

test("agenda compartilhada combina busca, setor, período, tipo, status e local nas três visualizações", async ({ page, request }) => {
  test.setTimeout(90_000);
  const token = `E2E agenda ${randomUUID().slice(0, 8)}`;
  const date = todayInstitutional();
  const fixtures: CalendarEvent[] = [];
  try {
    fixtures.push(await createEvent(request, eventInput(`${token} Multimeios`, { location: `Auditório ${token}`, status: "CONFIRMED" })));
    fixtures.push(await createEvent(request, eventInput(`${token} Marketing`, { department: "Marketing", location: `Praça ${token}`, kind: "EXTERNAL" })));
    fixtures.push(await createEvent(request, eventInput(`${token} Extensão`, { department: "Projeto de Extensão", location: `Clínica ${token}`, kind: "EXTERNAL", status: "CANCELLED" })));
    fixtures.push(await createEvent(request, eventInput(`${token} futuro`, { department: "Marketing", startsAt: institutionalToInstant(`${addDays(date, 50)}T13:00`), endsAt: institutionalToInstant(`${addDays(date, 50)}T15:00`) })));
    fixtures.push(await createEvent(request, eventInput(`${token} atravessa meia-noite`, { startsAt: institutionalToInstant(`${addDays(date, -1)}T23:30`), endsAt: institutionalToInstant(`${date}T00:30`) })));
    await page.goto("/eventos");
    await showList(page);
    const search = page.getByRole("textbox", { name: /Buscar evento/ });
    await search.fill(token);
    await page.getByLabel("Período inicial", { exact: true }).fill(date);
    await page.getByLabel("Período final", { exact: true }).fill(addDays(date, 60));
    for (const event of fixtures) await expect(page.getByRole("heading", { name: event.title, exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Setor do evento", exact: true }).selectOption("Marketing");
    await expect(page.getByRole("heading", { name: fixtures[1].title, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: fixtures[0].title, exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Tipo do evento", exact: true }).selectOption("EXTERNAL");
    await expect(page.getByRole("heading", { name: fixtures[3].title, exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Status do evento", exact: true }).selectOption("PLANNED");
    await page.getByRole("combobox", { name: "Local do evento", exact: true }).selectOption(fixtures[1].location);
    await expect(page.getByRole("heading", { name: fixtures[1].title, exact: true })).toBeVisible();
    await page.getByLabel("Período inicial", { exact: true }).fill(addDays(date, 1));
    await expect(page.getByRole("heading", { name: "Nenhum evento encontrado", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();
    await search.fill(token);
    await page.getByRole("button", { name: "Mês", exact: true }).click();
    await page.getByRole("button", { name: "Hoje", exact: true }).click();
    await expect(page.getByRole("link").filter({ hasText: fixtures[0].title }).first()).toBeVisible();
    await expect(page.getByRole("link").filter({ hasText: fixtures[1].title }).first()).toBeVisible();
    await page.getByRole("button", { name: "Semana", exact: true }).click();
    await expect(page.getByRole("link").filter({ hasText: fixtures[0].title }).first()).toBeVisible();
    await expect(page.getByRole("link").filter({ hasText: fixtures[2].title }).first()).toBeVisible();
    await expect(page.getByRole("link").filter({ hasText: fixtures[4].title }).first()).toBeVisible();
    await showList(page);
    await search.fill(`${token} termo ausente`);
    await expect(page.getByRole("heading", { name: "Nenhum evento encontrado", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    for (const event of fixtures) await archiveEvent(request, event.id);
  }
});

test("sobreposição no mesmo local informa sem bloquear e ignora outros locais e eventos cancelados", async ({ page, request }) => {
  test.setTimeout(90_000);
  const token = randomUUID().slice(0, 8);
  const sameLocation = `Auditório de conflitos E2E ${token}`;
  const base = await createEvent(request, eventInput(`E2E base conflito ${token}`, { location: sameLocation, status: "CONFIRMED" }));
  const cancelled = await createEvent(request, eventInput(`E2E cancelado conflito ${token}`, { location: sameLocation, status: "CANCELLED" }));
  let created: CalendarEvent | undefined;
  try {
    await page.goto("/eventos");
    await page.getByRole("button", { name: "Novo evento", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    const input = eventInput(`E2E simultâneo ${token}`, { location: sameLocation });
    await fillEvent(dialog, input);
    await expect(dialog).toContainText(base.title);
    await expect(dialog).toContainText(/sobreposi|mesmo local/i);
    await expect(dialog).not.toContainText(cancelled.title);
    await dialog.getByLabel("Local", { exact: true }).fill(`Outro local E2E ${token}`);
    await expect(dialog).not.toContainText(base.title);
    await dialog.getByLabel("Local", { exact: true }).fill(sameLocation);
    await expect(dialog).toContainText(base.title);
    const creation = page.waitForResponse((response) => response.url().endsWith("/api/events") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Criar evento", exact: true }).click();
    const response = await creation;
    expect(response.ok(), await response.text()).toBe(true);
    const result = await response.json() as EventMutation;
    created = result.event;
    expect(result.conflicts.map((event) => event.id)).toEqual([base.id]);
    await expect(dialog).not.toBeVisible();
    await page.goto(`/eventos/${created.id}`);
    await expect(page.locator("main")).toContainText(base.title);
    await expect(page.locator("main")).not.toContainText(cancelled.title);
    await page.reload();
    expect((await eventDetail(request, created.id)).conflicts.map((event) => event.id)).toEqual([base.id]);
    await page.getByRole("button", { name: "Editar evento", exact: true }).click();
    const otherLocation = `Outro local E2E ${token}`;
    await dialog.getByLabel("Local", { exact: true }).fill(otherLocation);
    await dialog.getByLabel("Motivo da alteração", { exact: true }).fill("Transferência para outro local, mantendo o horário simultâneo.");
    await expect(dialog).not.toContainText(base.title);
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    const moved = await eventDetail(request, created.id);
    expect(moved.event.location).toBe(otherLocation);
    expect(moved.conflicts).toHaveLength(0);
  } finally {
    if (created) await archiveEvent(request, created.id);
    await archiveEvent(request, base.id);
    await archiveEvent(request, cancelled.id);
  }
});

test("Dashboard e busca global consultam o evento persistido e mantêm o estoque real", async ({ page, request }) => {
  const title = `E2E agenda compartilhada ${randomUUID().slice(0, 8)}`;
  const event = await createEvent(request, eventInput(title, { status: "CONFIRMED" }));
  try {
    const overview = await request.get("/api/events/overview");
    expect(overview.ok(), await overview.text()).toBe(true);
    const real = await overview.json() as EventOverview;
    expect(real.timeZone).toBe("America/Sao_Paulo");
    expect(real.summary.total).toBeGreaterThan(0);
    const overviewResponse = page.waitForResponse((response) => response.url().endsWith("/api/events/overview") && response.ok());
    await page.goto("/");
    const shown = await (await overviewResponse).json() as EventOverview;
    await expect(page.getByText("Eventos no mês", { exact: true })).toBeVisible();
    const civilRange = monthRange(shown.today);
    const range = institutionalDayRange(civilRange.from, civilRange.to);
    const expectedMonthTotal = shown.items.filter((item) => new Date(item.startsAt).getTime() < new Date(range.endsAt).getTime() && new Date(item.endsAt).getTime() > new Date(range.startsAt).getTime()).length;
    const eventIndicator = page.getByText("Eventos no mês", { exact: true }).locator("../..");
    await expect(eventIndicator.locator("span").filter({ hasText: new RegExp(`^${expectedMonthTotal.toLocaleString("pt-BR")}$`) }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver equipamentos disponíveis", exact: true })).toBeVisible();
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Buscar eventos e equipamentos", exact: true }).fill(title);
    await dialog.getByRole("link").filter({ hasText: title }).click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${event.id}$`));
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    await archiveEvent(request, event.id);
  }
});

test("falha de consulta permite recuperação sem substituir eventos por demonstração", async ({ page }) => {
  let fail = true;
  await page.route("**/api/events?*", (route) => fail ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Agenda temporariamente indisponível." }) }) : route.continue());
  await page.goto("/eventos");
  await showList(page);
  await expect(page.getByRole("alert").filter({ hasText: /indisponível|carregar|consultar/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Semana Acadêmica de Engenharia", exact: true })).toHaveCount(0);
  fail = false;
  const recovery = page.waitForResponse((response) => response.url().includes("/api/events?") && response.ok());
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await recovery;
  await expect(page.getByRole("alert").filter({ hasText: /indisponível|carregar|consultar/i })).toHaveCount(0);
  fail = true;
  await page.route("**/api/events/overview", (route) => fail ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Eventos temporariamente indisponíveis." }) }) : route.continue());
  await page.goto("/");
  const eventIndicator = page.getByText("Eventos no período", { exact: true }).locator("../..");
  await expect(eventIndicator).toContainText("Eventos indisponíveis");
  await expect(eventIndicator.locator("span").filter({ hasText: /^0$/ })).toHaveCount(0);
  fail = false;
  await eventIndicator.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.getByText("Eventos no mês", { exact: true })).toBeVisible();
});

test("agenda vazia apresenta estado válido sem eventos e indicadores fictícios", async ({ page }) => {
  const summary = { total: 0, confirmed: 0, external: 0, cancelled: 0, today: 0, upcoming: 0 };
  await page.route("**/api/events?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], summary, locations: [], pagination: { page: 1, pageSize: 6, total: 0, totalPages: 1 } }) }));
  await page.route("**/api/events/calendar?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], limitReached: false }) }));
  await page.route("**/api/events/overview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], summary, today: todayInstitutional(), timeZone: "America/Sao_Paulo" }) }));
  await page.goto("/eventos");
  await showList(page);
  await expect(page.getByRole("heading", { name: "Sua agenda começa aqui", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo evento", exact: true }).first()).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Eventos no mês", { exact: true }).locator("../..")).toContainText("0");
  await expect(page.locator("body")).not.toContainText("NaN");
  await expect(page.locator("body")).not.toContainText("Infinity");
  await expect(page.getByText("Semana Acadêmica de Engenharia", { exact: true })).toHaveCount(0);
});
