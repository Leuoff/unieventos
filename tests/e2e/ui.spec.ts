import { randomUUID } from "node:crypto";
import { type APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";
import type { EquipmentDetail, InventoryEquipment } from "../../src/types/inventory";
import { addDays, institutionalToInstant, todayInstitutional } from "../../src/lib/event-time";

function requireTestDatabase() {
  const connection = process.env.TEST_DATABASE_URL;
  if (!connection || new URL(connection).pathname !== "/unieventos_test") {
    throw new Error("Os testes que gravam estoque exigem TEST_DATABASE_URL apontando exclusivamente para unieventos_test.");
  }
}

async function createSearchEquipment(request: APIRequestContext, name: string, category: string) {
  requireTestDatabase();
  const response = await request.post("/api/equipment", { data: {
    name, category, description: "Cadastro isolado para regressão de busca do estoque.",
    location: "Laboratório de testes E2E", trackingMode: "QUANTITY", total: 3, maintenance: 0, units: [],
  } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as { equipment: InventoryEquipment }).equipment;
}

async function archiveSearchEquipment(request: APIRequestContext, id: string) {
  const detail = await request.get(`/api/equipment/${id}`);
  expect(detail.ok(), await detail.text()).toBe(true);
  const { equipment } = await detail.json() as EquipmentDetail;
  if (!equipment.archivedAt) {
    const response = await request.delete(`/api/equipment/${id}`, { data: { version: equipment.version } });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

test("dashboard e navegação apresentam dados sem erros de execução", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("Eventos no mês", { exact: true })).toBeVisible();
  const stockIndicator = page.getByRole("link", { name: "Ver equipamentos disponíveis", exact: true }).locator("../..");
  await expect(stockIndicator).toContainText(/\d/);
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: true });
  for (const [route, title] of [["/eventos", "Eventos"], ["/estoque", "Estoque"], ["/solicitacoes", "Solicitações"], ["/movimentacoes", "Movimentações"]]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("calendário e busca global respondem às interações com estoque persistido", async ({ page, request }) => {
  const name = `Projetor E2E ${randomUUID().slice(0, 8)}`;
  const equipment = await createSearchEquipment(request, name, "Audiovisual");
  try {
    await page.goto("/");
    const today = todayInstitutional();
    const formatMonth = (date: string) => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(institutionalToInstant(`${date}T12:00`)));
    const nextMonth = addDays(`${today.slice(0, 7)}-01`, 32).slice(0, 7) + "-01";
    await page.getByRole("button", { name: "Próximo mês", exact: true }).click();
    await expect(page.getByText(formatMonth(nextMonth), { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Voltar para hoje", exact: true }).click();
    await expect(page.getByText(formatMonth(today), { exact: true })).toBeVisible();
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Buscar eventos e equipamentos", exact: true }).fill(name);
    await dialog.getByRole("link").filter({ hasText: name }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/estoque/${equipment.id}$`));
  } finally {
    await archiveSearchEquipment(request, equipment.id);
  }
});

test("busca global abre o equipamento mesmo com outro filtro ativo e permite reabrir", async ({ page, request }) => {
  const token = randomUUID().slice(0, 8);
  const name = `Notebook E2E ${token}`;
  const equipment = await createSearchEquipment(request, name, "Informática");
  let other: InventoryEquipment | undefined;
  try {
    other = await createSearchEquipment(request, `Caixa E2E ${token}`, `Audiovisual E2E ${token}`);
    await page.goto("/estoque");
    await page.getByRole("combobox", { name: "Categoria do equipamento", exact: true }).selectOption(`Audiovisual E2E ${token}`);
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").getByRole("textbox", { name: "Buscar eventos e equipamentos" }).fill(name);
    await page.getByRole("dialog").getByRole("link").filter({ hasText: name }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/estoque/${equipment.id}$`));
    await page.goto("/estoque");
    // A navegação completa recria o layout; aguardar o inventário confirma que
    // o cliente já montou antes de enviar um atalho de teclado sem autoespera.
    await expect(page.getByRole("region", { name: "Inventário de equipamentos", exact: true }).getByText(/tipos de equipamentos encontrados$/)).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").getByRole("textbox", { name: "Buscar eventos e equipamentos" }).fill(name);
    await page.getByRole("dialog").getByRole("link").filter({ hasText: name }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  } finally {
    await archiveSearchEquipment(request, equipment.id);
    if (other) await archiveSearchEquipment(request, other.id);
  }
});

test("notificações devolvem o foco ao botão e o menu móvel fecha com Escape", async ({ page, isMobile }) => {
  await page.goto("/");
  const notifications = page.getByRole("button", { name: /Notificações:/ });
  await notifications.click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Central de notificações" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(notifications).toBeFocused();
  if (isMobile) {
    const menu = page.getByRole("button", { name: "Abrir menu", exact: true });
    await menu.click();
    await expect(page.getByRole("dialog").getByRole("navigation")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
  }
});
