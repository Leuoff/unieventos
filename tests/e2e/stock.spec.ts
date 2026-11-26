import { randomUUID } from "node:crypto";
import { type APIRequestContext, type Locator } from "@playwright/test";
import { expect, test } from "./fixtures";
import type { EquipmentDetail, EquipmentInput, EquipmentList, InventoryEquipment } from "../../src/types/inventory";

test.beforeEach(() => {
  const connection = process.env.TEST_DATABASE_URL;
  if (!connection || new URL(connection).pathname !== "/unieventos_test") {
    throw new Error("Estes testes exigem TEST_DATABASE_URL apontando exclusivamente para unieventos_test. Não execute contra o estoque de uso real.");
  }
});

function equipmentInput(name: string, overrides: Partial<EquipmentInput> = {}): EquipmentInput {
  return {
    name, category: "E2E — equipamentos", description: "Registro exclusivo do banco isolado de testes.",
    location: "Sala de testes", trackingMode: "QUANTITY", total: 5, maintenance: 0, units: [],
    ...overrides,
  };
}

async function createEquipment(request: APIRequestContext, input: EquipmentInput) {
  const response = await request.post("/api/equipment", { data: input });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as { equipment: InventoryEquipment }).equipment;
}

async function detailEquipment(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/equipment/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as EquipmentDetail;
}

async function archiveEquipment(request: APIRequestContext, id: string) {
  let { equipment } = await detailEquipment(request, id);
  if (!equipment.archivedAt) {
    if (equipment.maintenance > 0) {
      const maintenance = await request.patch(`/api/equipment/${id}`, { data: {
        name: equipment.name, category: equipment.category, description: equipment.description, location: equipment.location,
        trackingMode: equipment.trackingMode, total: equipment.total, maintenance: 0,
        units: equipment.units.map((unit) => ({ id: unit.id, assetNumber: unit.assetNumber, status: unit.status === "MAINTENANCE" ? "AVAILABLE" : unit.status })),
        reason: "Limpeza do cenário isolado de testes: manutenção finalizada.", version: equipment.version,
      } });
      expect(maintenance.ok(), await maintenance.text()).toBe(true);
      equipment = (await maintenance.json() as { equipment: InventoryEquipment }).equipment;
    }
    const response = await request.delete(`/api/equipment/${id}`, { data: { version: equipment.version } });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

async function fillBasicFields(dialog: Locator, input: EquipmentInput) {
  await dialog.getByLabel("Nome do equipamento", { exact: true }).fill(input.name);
  await dialog.getByLabel("Categoria", { exact: true }).fill(input.category);
  await dialog.getByLabel("Descrição", { exact: true }).fill(input.description);
  await dialog.getByLabel("Local de armazenamento", { exact: true }).fill(input.location);
}

test("cadastro por quantidade valida saldos, persiste, edita com histórico e arquiva", async ({ page, request }) => {
  test.setTimeout(60_000);
  const input = equipmentInput(`E2E quantidade ${randomUUID().slice(0, 8)}`);
  let equipmentId: string | undefined;
  try {
    await page.goto("/estoque");
    await page.getByRole("button", { name: "Novo equipamento", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await fillBasicFields(dialog, input);
    await dialog.getByLabel("Quantidade total", { exact: true }).fill("-1");
    await dialog.getByRole("button", { name: "Cadastrar equipamento", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(/revise|quantidade|negativ|zero/i);
    await expect(dialog.getByLabel("Quantidade total", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await dialog.getByLabel("Quantidade total", { exact: true }).fill("8");
    await dialog.getByLabel("Em manutenção", { exact: true }).fill("9");
    await dialog.getByRole("button", { name: "Cadastrar equipamento", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(/revise|manutenção|total/i);
    await expect(dialog.getByLabel("Quantidade total", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await dialog.getByLabel("Em manutenção", { exact: true }).fill("2");
    const creation = page.waitForResponse((response) => response.url().endsWith("/api/equipment") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Cadastrar equipamento", exact: true }).click();
    const response = await creation;
    expect(response.ok(), await response.text()).toBe(true);
    equipmentId = (await response.json() as { equipment: InventoryEquipment }).equipment.id;
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /cadastrado|criado/i })).toBeVisible();

    await page.goto(`/estoque/${equipmentId}`);
    await expect(page.getByRole("heading", { name: input.name, exact: true })).toBeVisible();
    await expect(page.getByText(input.description, { exact: true })).toBeVisible();
    await expect(page.getByText(/^Reservad[ao]s$/)).toBeVisible();
    await expect(page.getByText("Em uso", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: input.name, exact: true })).toBeVisible();
    expect((await detailEquipment(request, equipmentId)).equipment).toMatchObject({ total: 8, available: 6, reserved: 0, inUse: 0, maintenance: 2 });

    await page.getByRole("button", { name: "Editar equipamento", exact: true }).click();
    await dialog.getByLabel("Quantidade total", { exact: true }).fill("10");
    await dialog.getByLabel("Local de armazenamento", { exact: true }).fill("Multimeios — depósito B");
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(/revise|motivo/i);
    await expect(dialog.getByLabel("Motivo da alteração", { exact: true })).toHaveAttribute("aria-invalid", "true");
    const reason = "Conferência física: duas unidades localizadas no depósito B.";
    await dialog.getByLabel("Motivo da alteração", { exact: true }).fill(reason);
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /atualizado|alterações salvas/i })).toBeVisible();
    await expect(page.getByText("Multimeios — depósito B", { exact: true })).toBeVisible();
    await expect(page.getByText(reason, { exact: false })).toBeVisible();
    await page.reload();
    const edited = await detailEquipment(request, equipmentId);
    expect(edited.equipment).toMatchObject({ total: 10, available: 8, maintenance: 2, location: "Multimeios — depósito B" });
    expect(edited.history.some((entry) => entry.description.includes(reason))).toBe(true);

    await expect(page.getByRole("button", { name: "Excluir equipamento", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Editar equipamento", exact: true }).click();
    await dialog.getByLabel("Em manutenção", { exact: true }).fill("0");
    await dialog.getByLabel("Motivo da alteração", { exact: true }).fill("Manutenção finalizada e todas as unidades conferidas.");
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect((await detailEquipment(request, equipmentId)).equipment).toMatchObject({ total: 10, available: 10, maintenance: 0 });
    await page.getByRole("button", { name: "Excluir equipamento", exact: true }).click();
    await expect(dialog).toContainText(/histórico|arquivad/i);
    await dialog.getByRole("button", { name: "Confirmar exclusão", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const archived = await detailEquipment(request, equipmentId);
    expect(archived.equipment.archivedAt).not.toBeNull();
    expect(archived.history.some((entry) => entry.description.includes(reason))).toBe(true);
    await page.goto("/estoque");
    await page.getByRole("textbox", { name: "Buscar equipamento, patrimônio ou localização...", exact: true }).fill(input.name);
    await expect(page.getByRole("heading", { name: input.name, exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Situação do equipamento", exact: true }).selectOption("archived");
    await expect(page.getByRole("heading", { name: input.name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    if (equipmentId) await archiveEquipment(request, equipmentId);
  }
});

test("patrimônios duplicados são rejeitados e unidades mantêm estados separados", async ({ page, request }) => {
  test.setTimeout(60_000);
  const token = randomUUID().slice(0, 8).toUpperCase();
  const occupiedAsset = `E2E-${token}-EXISTENTE`;
  const fixture = await createEquipment(request, equipmentInput(`E2E patrimônio base ${token}`, {
    trackingMode: "INDIVIDUAL", total: 1, units: [{ assetNumber: occupiedAsset, status: "AVAILABLE" }],
  }));
  let equipmentId: string | undefined;
  try {
    const input = equipmentInput(`E2E patrimônio novo ${token}`);
    await page.goto("/estoque");
    await page.getByRole("button", { name: "Novo equipamento", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await fillBasicFields(dialog, input);
    await dialog.getByLabel("Modo de controle", { exact: true }).selectOption("INDIVIDUAL");
    await dialog.getByLabel("Número de patrimônio 1", { exact: true }).fill(occupiedAsset.toLowerCase());
    await dialog.getByRole("button", { name: "Cadastrar equipamento", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(/patrimônio.*(cadastrado|uso|existe|duplicado)|duplicado/i);
    const duplicateSearch = await request.get("/api/equipment", { params: { q: input.name } });
    expect((await duplicateSearch.json() as EquipmentList).items).toHaveLength(0);

    const firstAsset = `E2E-${token}-001`;
    const secondAsset = `E2E-${token}-002`;
    await dialog.getByLabel("Número de patrimônio 1", { exact: true }).fill(firstAsset);
    await dialog.getByRole("button", { name: "Adicionar unidade", exact: true }).click();
    await dialog.getByLabel("Número de patrimônio 2", { exact: true }).fill(secondAsset);
    await dialog.getByLabel("Estado da unidade 2", { exact: true }).selectOption("MAINTENANCE");
    const creation = page.waitForResponse((response) => response.url().endsWith("/api/equipment") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Cadastrar equipamento", exact: true }).click();
    const response = await creation;
    expect(response.ok(), await response.text()).toBe(true);
    equipmentId = (await response.json() as { equipment: InventoryEquipment }).equipment.id;
    await expect(dialog).not.toBeVisible();
    await page.goto(`/estoque/${equipmentId}`);
    await expect(page.getByText(firstAsset, { exact: true })).toBeVisible();
    await expect(page.getByText(secondAsset, { exact: true })).toBeVisible();
    await page.reload();
    const saved = (await detailEquipment(request, equipmentId)).equipment;
    expect(saved).toMatchObject({ trackingMode: "INDIVIDUAL", total: 2, available: 1, reserved: 0, inUse: 0, maintenance: 1 });
    expect(saved.units.map((unit) => ({ assetNumber: unit.assetNumber, status: unit.status }))).toEqual(expect.arrayContaining([
      { assetNumber: firstAsset, status: "AVAILABLE" }, { assetNumber: secondAsset, status: "MAINTENANCE" },
    ]));
    await page.getByRole("button", { name: "Editar equipamento", exact: true }).click();
    await expect(dialog.getByLabel("Modo de controle", { exact: true })).toBeDisabled();
    await dialog.getByLabel("Estado da unidade 2", { exact: true }).selectOption("AVAILABLE");
    await dialog.getByLabel("Motivo da alteração", { exact: true }).fill("Manutenção concluída e unidade conferida.");
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect((await detailEquipment(request, equipmentId)).equipment).toMatchObject({ total: 2, available: 2, maintenance: 0 });
    await page.goto("/estoque");
    await page.getByRole("textbox", { name: "Buscar equipamento, patrimônio ou localização...", exact: true }).fill(secondAsset);
    await expect(page.getByRole("heading", { name: input.name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    if (equipmentId) await archiveEquipment(request, equipmentId);
    await archiveEquipment(request, fixture.id);
  }
});

test("busca, filtros e paginação combinam registros reais e retornam à primeira página", async ({ page, request }) => {
  test.setTimeout(60_000);
  const token = `E2E-${randomUUID().slice(0, 8)}`;
  const fixtures: InventoryEquipment[] = [];
  try {
    for (let index = 0; index < 8; index++) {
      fixtures.push(await createEquipment(request, equipmentInput(`${token} equipamento ${index + 1}`, {
        category: `${token} ${index < 4 ? "Audiovisual" : "Informática"}`,
        trackingMode: index < 2 ? "INDIVIDUAL" : "QUANTITY",
        total: index >= 6 ? 0 : index < 2 ? 1 : 3,
        units: index < 2 ? [{ assetNumber: `${token}-PAT-${index}`, status: "AVAILABLE" }] : [],
      })));
    }
    await page.goto("/estoque");
    const inventory = page.getByRole("region", { name: "Inventário de equipamentos", exact: true });
    const search = page.getByRole("textbox", { name: "Buscar equipamento, patrimônio ou localização...", exact: true });
    await search.fill(token);
    await expect(page.getByRole("heading", { name: fixtures[0].name, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: fixtures[5].name, exact: true })).toBeVisible();
    await expect(inventory.getByRole("article")).toHaveCount(6);
    const next = page.getByRole("button", { name: "Próxima página de equipamentos", exact: true });
    await next.click();
    await expect(inventory.getByRole("article")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: fixtures[6].name, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: fixtures[0].name, exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Categoria do equipamento", exact: true }).selectOption(`${token} Audiovisual`);
    await expect(inventory.getByRole("article")).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Página anterior de equipamentos", exact: true })).toBeDisabled();
    await page.getByRole("combobox", { name: "Modo de controle do equipamento", exact: true }).selectOption("INDIVIDUAL");
    await expect(inventory.getByRole("article")).toHaveCount(2);
    await page.getByRole("combobox", { name: "Categoria do equipamento", exact: true }).selectOption("");
    await page.getByRole("combobox", { name: "Modo de controle do equipamento", exact: true }).selectOption("");
    await page.getByRole("combobox", { name: "Disponibilidade do equipamento", exact: true }).selectOption("unavailable");
    await expect(inventory.getByRole("article")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: fixtures[7].name, exact: true })).toBeVisible();
    await search.fill(`${token} termo inexistente`);
    await expect(page.getByRole("heading", { name: "Nenhum equipamento encontrado", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    for (const fixture of fixtures) await archiveEquipment(request, fixture.id);
  }
});

test("falha de consulta mostra erro e permite tentar novamente sem exibir demonstração", async ({ page }) => {
  let fail = true;
  await page.route("**/api/equipment?*", async (route) => {
    if (fail) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Estoque temporariamente indisponível." }) });
    } else {
      await route.continue();
    }
  });
  await page.goto("/estoque");
  const inventory = page.getByRole("region", { name: "Inventário de equipamentos", exact: true });
  await expect(inventory.getByRole("alert")).toContainText(/indisponível|carregar|consultar/i);
  await expect(page.getByRole("heading", { name: "Projetor multimídia", exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(inventory.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Inventário de equipamentos", exact: true })).toBeVisible();
});

test("estoque vazio apresenta primeiro cadastro e indicadores válidos", async ({ page }) => {
  const summary = { totalTypes: 0, total: 0, available: 0, reserved: 0, inUse: 0, maintenance: 0 };
  await page.route("**/api/equipment?*", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ items: [], categories: [], summary, pagination: { page: 1, pageSize: 6, total: 0, totalPages: 1 } }),
  }));
  await page.route("**/api/equipment/overview", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ items: [], summary }),
  }));
  await page.goto("/estoque");
  await expect(page.getByRole("button", { name: "Novo equipamento", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Inventário de equipamentos", exact: true }).getByRole("article")).toHaveCount(0);
  await expect(page.getByText(/cadastre|primeiro equipamento/i)).toBeVisible();
  await page.goto("/");
  const stockIndicator = page.getByRole("link", { name: "Ver equipamentos disponíveis", exact: true }).locator("../..");
  await expect(stockIndicator).toContainText("0");
  await expect(page.locator("body")).not.toContainText("NaN");
  await expect(page.locator("body")).not.toContainText("Infinity");
});
