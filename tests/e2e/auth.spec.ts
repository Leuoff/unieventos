import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, createAccount, removeAccount, loginApi, isolatedConnection } from "./fixtures";
import { addDays, institutionalToInstant, todayInstitutional } from "../../src/lib/event-time";
import type { CalendarEvent, EventInput, EventMutation } from "../../src/types/events";
import type { EquipmentRequest, RequestDetail } from "../../src/types/requests";

function eventInput(department: EventInput["department"]): EventInput {
  const day = addDays(todayInstitutional(), 14);
  return { title: `Acesso evento ${randomUUID()}`, description: "Registro exclusivo do teste de autorização.", department, responsibleName: "Contato operacional declarado", contact: "teste@unisalesiano.com.br", location: `Sala ${randomUUID()}`, kind: "INTERNAL", status: "CONFIRMED", startsAt: institutionalToInstant(`${day}T09:00`), endsAt: institutionalToInstant(`${day}T11:00`), equipmentNeeds: [] };
}
async function createEvent(api: APIRequestContext, input: EventInput): Promise<CalendarEvent> {
  const response = await api.post("/api/events", { data: input });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as EventMutation).event;
}
async function createStock(api: APIRequestContext, total = 3): Promise<string> {
  const response = await api.post("/api/equipment", { data: { name: `Acesso estoque ${randomUUID()}`, category: "Teste acesso", description: "Apenas banco isolado", location: "Depósito de testes", trackingMode: "QUANTITY", total, maintenance: 0, units: [] } });
  expect(response.ok(), await response.text()).toBe(true); return (await response.json()).equipment.id;
}
async function createPending(api: APIRequestContext, event: CalendarEvent, equipmentId: string): Promise<EquipmentRequest> {
  const creation = await api.post("/api/requests", { data: { eventId: event.id, responsibleName: "Contato operacional", startsAt: event.startsAt, endsAt: event.endsAt, notes: "Teste isolado de autorização", items: [{ equipmentId, quantity: 1, notes: "" }] } });
  expect(creation.ok(), await creation.text()).toBe(true);
  const draft = await creation.json() as EquipmentRequest;
  const submission = await api.post(`/api/requests/${draft.id}/submit`, { data: { version: draft.version } });
  expect(submission.ok(), await submission.text()).toBe(true); return await submission.json() as EquipmentRequest;
}
async function cleanRecords(eventIds: string[], equipmentIds: string[]) {
  const db = new Client({ connectionString: isolatedConnection() }); await db.connect();
  try {
    await db.query("BEGIN");
    const reservations = 'SELECT r.id FROM "Reservation" r JOIN "EquipmentRequestItem" i ON i.id=r."requestItemId" JOIN "EquipmentRequest" q ON q.id=i."requestId" WHERE q."eventId"=ANY($1::uuid[])';
    await db.query(`DELETE FROM "ReservationUnit" WHERE "reservationId" IN (${reservations})`, [eventIds]);
    await db.query(`DELETE FROM "Reservation" WHERE id IN (${reservations})`, [eventIds]);
    await db.query('DELETE FROM "RequestHistory" WHERE "requestId" IN (SELECT id FROM "EquipmentRequest" WHERE "eventId"=ANY($1::uuid[]))', [eventIds]);
    await db.query('DELETE FROM "EquipmentRequestItem" WHERE "requestId" IN (SELECT id FROM "EquipmentRequest" WHERE "eventId"=ANY($1::uuid[]))', [eventIds]);
    await db.query('DELETE FROM "EquipmentRequest" WHERE "eventId"=ANY($1::uuid[])', [eventIds]);
    await db.query('DELETE FROM "EventEquipmentNeed" WHERE "eventId"=ANY($1::uuid[])', [eventIds]);
    await db.query('DELETE FROM "EventHistory" WHERE "eventId"=ANY($1::uuid[])', [eventIds]);
    await db.query('DELETE FROM "CalendarEvent" WHERE id=ANY($1::uuid[])', [eventIds]);
    await db.query('DELETE FROM "StockHistory" WHERE "equipmentId"=ANY($1::uuid[])', [equipmentIds]);
    await db.query('DELETE FROM "Equipment" WHERE id=ANY($1::uuid[])', [equipmentIds]);
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { await db.end(); }
}

test("acesso anônimo e e-mail institucional sem conta não autorizam uso nem cadastro público", async ({ browser, playwright, request }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const anonymous = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100", storageState: { cookies: [], origins: [] } });
  try {
    for (const route of ["/api/equipment", "/api/events", "/api/requests", "/api/reservations?equipmentId=" + randomUUID(), "/api/users"]) expect((await anonymous.get(route)).status()).toBe(401);
    const forged = await anonymous.post("/api/equipment", { headers: { "x-role": "ADMIN", "x-user-id": randomUUID() }, data: {} });
    expect(forged.status()).toBe(401);
    const registration = await anonymous.post("/api/auth/signup", { data: { email: `nao-cadastrado-${randomUUID()}@unisalesiano.com.br`, role: "ADMIN" } });
    expect(registration.ok()).toBe(false);
    const page = await context.newPage(); await page.goto("/eventos");
    await expect(page).toHaveURL(/\/login\?/);
    const email = `nao-cadastrado-${randomUUID()}@unisalesiano.com.br`;
    await page.getByLabel("E-mail institucional", { exact: true }).fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(randomBytes(24).toString("base64url"));
    await page.getByRole("button", { name: /Entrar/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: /credenciais|conta/ })).toBeVisible();
    const crossSite = await request.post("/api/equipment", { headers: { origin: "https://externo.example", "sec-fetch-site": "cross-site" }, data: {} });
    expect(crossSite.status()).toBe(403);
  } finally { await anonymous.dispose(); await context.close(); }
});

test("login real, cookie protegido e logout revogam inclusive a cópia anterior da sessão", async ({ browser, playwright }) => {
  const account = await createAccount("MARKETING");
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage(); await page.goto("/login?next=%2Festoque");
    await page.getByLabel("E-mail institucional", { exact: true }).fill(account.email);
    await page.getByLabel("Senha", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: /Entrar/ }).click();
    await expect(page).toHaveURL(/\/estoque$/);
    await expect(page.getByRole("heading", { name: "Estoque", exact: true })).toBeVisible();
    const cookie = (await context.cookies()).find((entry) => entry.name.endsWith("session-token"));
    expect(!!cookie && cookie.httpOnly && cookie.sameSite === "Lax").toBe(true);
    const publicSession = JSON.stringify(await (await context.request.get("/api/auth/session")).json());
    expect(/appSessionToken|passwordHash|tokenHash/.test(publicSession)).toBe(false);
    const previous = await context.storageState();
    await page.getByRole("button", { name: "Sair do UniEventos", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    const replay = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100", storageState: previous });
    try { expect((await replay.get("/api/equipment")).status()).toBe(401); } finally { await replay.dispose(); }
  } finally { await context.close(); await removeAccount(account); }
});

for (const [role, department] of [["MULTIMEIOS", "Multimeios"], ["MARKETING", "Marketing"], ["EXTENSAO", "Projeto de Extensão"]] as const) {
  test(`${role} consulta estoque, gerencia os próprios registros e não eleva privilégios`, async ({ browser, request, playwright }) => {
    const account = await createAccount(role);
    const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
    const events: string[] = [], stock: string[] = [];
    try {
      await loginApi(api, account);
      const { csrfToken } = await (await api.get("/api/auth/csrf")).json();
      await api.post("/api/auth/session", { data: { csrfToken, data: { user: { id: randomUUID(), role: "ADMIN", permissions: ["USERS_MANAGE", "INVENTORY_WRITE"] } } } });
      const currentIdentity = await (await api.get("/api/auth/me")).json();
      expect(currentIdentity.user.id).toBe(account.id); expect(currentIdentity.user.role).toBe(role);
      const equipmentId = await createStock(request); stock.push(equipmentId);
      expect((await api.get(`/api/equipment/${equipmentId}`)).ok()).toBe(true);
      const forbidden = await api.post("/api/equipment", { headers: { "x-role": "ADMIN", "x-user-id": randomUUID() }, data: {} }); expect(forbidden.status()).toBe(403);
      expect((await api.post("/api/users", { data: { role: "ADMIN", userId: account.id } })).status()).toBe(403);
      const ownInput = eventInput(department), own = await createEvent(api, ownInput); events.push(own.id);
      const otherInput = eventInput("Multimeios"), other = await createEvent(request, otherInput); events.push(other.id);
      expect((await api.get(`/api/events/${other.id}`)).ok()).toBe(true);
      expect((await api.patch(`/api/events/${other.id}`, { data: { ...otherInput, version: other.version, reason: "Tentativa alheia" } })).status()).toBe(403);
      const changed = await api.patch(`/api/events/${own.id}`, { data: { ...ownInput, version: own.version, reason: "Atualização própria", description: "Atualização legítima do próprio evento." } }); expect(changed.ok(), await changed.text()).toBe(true);
      const pending = await createPending(api, own, equipmentId);
      const cancel = await api.post(`/api/requests/${pending.id}/decision`, { data: { action: "cancel", version: pending.version, reason: "Desistência do próprio pedido" } }); expect(cancel.ok(), await cancel.text()).toBe(true);
      const second = await createPending(api, own, equipmentId);
      expect((await api.post(`/api/requests/${second.id}/decision`, { data: { action: "approve", version: second.version } })).status()).toBe(403);
      const approval = await request.post(`/api/requests/${second.id}/decision`, { data: { action: "approve", version: second.version } }); expect(approval.ok(), await approval.text()).toBe(true);
      const approved = await approval.json() as EquipmentRequest;
      expect((await api.post(`/api/requests/${second.id}/decision`, { data: { action: "cancel", version: approved.version, reason: "Não possui a permissão específica" } })).status()).toBe(403);
      const foreign = await createPending(request, other, equipmentId);
      expect((await api.get(`/api/requests/${foreign.id}`)).status()).toBe(403);
      const context = await browser.newContext({ storageState: await api.storageState() });
      try {
        const page = await context.newPage(); await page.goto("/estoque");
        await expect(page.getByRole("heading", { name: "Estoque", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Novo equipamento", exact: true })).toHaveCount(0);
        await page.goto("/usuarios"); await expect(page).toHaveURL(/\/acesso-negado$/);
        await expect(page.getByRole("heading", { name: /Acesso negado/ })).toBeVisible();
      } finally { await context.close(); }
    } finally { await cleanRecords(events, stock); await api.dispose(); await removeAccount(account); }
  });
}

test("ADMIN aprova, recusa e cancela reservas na interface com histórico autenticado", async ({ page, request, account }) => {
  const events: string[] = [], stock: string[] = [];
  try {
    const event = await createEvent(request, eventInput("Multimeios")); events.push(event.id);
    const equipment = await createStock(request); stock.push(equipment);
    let pending = await createPending(request, event, equipment);
    await page.goto(`/solicitacoes/${pending.id}`);
    await page.getByRole("button", { name: "Aprovar solicitação", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Justificativa da decisão", { exact: true }).fill("Capacidade conferida pelo administrador autenticado.");
    await dialog.getByRole("button", { name: "Aprovar solicitação", exact: true }).click();
    await expect(page.getByRole("region", { name: "Informações da solicitação" })).toContainText("Aprovada");
    await expect(page.getByRole("region", { name: "Reservas da solicitação" })).toContainText("Reservada");
    await page.getByRole("button", { name: "Cancelar reserva aprovada", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Justificativa da decisão", { exact: true }).fill("Organização autorizou cancelamento do compromisso futuro.");
    await dialog.getByRole("button", { name: "Cancelar reserva aprovada", exact: true }).click();
    await expect(page.getByRole("region", { name: "Informações da solicitação" })).toContainText("Cancelada");
    const cancelled = await (await request.get(`/api/requests/${pending.id}`)).json() as RequestDetail;
    expect(cancelled.reservations[0].status).toBe("CANCELLED");
    expect(cancelled.history.every((entry) => entry.actorUserId === account.id)).toBe(true);
    pending = await createPending(request, event, equipment);
    await page.goto(`/solicitacoes/${pending.id}`);
    await page.getByRole("button", { name: "Recusar com justificativa", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Justificativa da decisão", { exact: true }).fill("Pedido incompatível com a necessidade confirmada do evento.");
    await dialog.getByRole("button", { name: "Recusar solicitação", exact: true }).click();
    await expect(page.getByRole("region", { name: "Informações da solicitação" })).toContainText("Recusada");
  } finally { await cleanRecords(events, stock); }
});

test("aprovações HTTP concorrentes com sessão real não excedem o estoque", async ({ request }) => {
  const events: string[] = [], stock: string[] = [];
  try {
    const equipment = await createStock(request, 1); stock.push(equipment);
    const first = await createEvent(request, eventInput("Multimeios")), second = await createEvent(request, eventInput("Marketing")); events.push(first.id, second.id);
    const a = await createPending(request, first, equipment), b = await createPending(request, second, equipment);
    const responses = await Promise.all([request.post(`/api/requests/${a.id}/decision`, { data: { action: "approve", version: a.version } }), request.post(`/api/requests/${b.id}/decision`, { data: { action: "approve", version: b.version } })]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
    const reservations = await (await request.get(`/api/reservations?equipmentId=${equipment}`)).json();
    expect(reservations.items.filter((item: { status: string }) => item.status === "ACTIVE")).toHaveLength(1);
  } finally { await cleanRecords(events, stock); }
});
