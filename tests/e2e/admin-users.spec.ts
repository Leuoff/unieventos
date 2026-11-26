import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { expect, isolatedConnection, loginApi, removeAccount, test, type TestAccount } from "./fixtures";
import type { ManagedUser } from "../../src/types/auth";

test("administrador cadastra, altera permissões e desativa conta revogando sessões reais", async ({ page, playwright, browser }) => {
  test.setTimeout(120_000);
  isolatedConnection();
  const suffix = randomUUID();
  const target: TestAccount = { id: "", name: `Gestão de contas ${suffix.slice(0, 8)}`, email: `e2e-admin-ui-${suffix}@unisalesiano.com.br`, password: randomBytes(24).toString("base64url"), role: "MARKETING" };
  let previousSession: APIRequestContext | undefined;
  let freshSession: APIRequestContext | undefined;
  let userContext: BrowserContext | undefined;
  let equipmentId: string | undefined;
  const equipmentInput = { name: `Equipamento acesso concedido ${suffix}`, category: "Permissões E2E", description: "Recurso criado apenas no banco de testes isolado.", location: "Sala de testes", trackingMode: "QUANTITY", total: 1, maintenance: 0, units: [] };

  try {
    await page.goto("/usuarios");
    await expect(page.getByRole("heading", { name: "Usuários e permissões", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Novo usuário", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nome completo", { exact: true }).fill(target.name);
    await dialog.getByLabel("E-mail institucional", { exact: true }).fill(target.email);
    await dialog.getByLabel("Perfil e setor", { exact: true }).selectOption("MARKETING");
    await dialog.getByLabel("Senha inicial", { exact: true }).fill(target.password);
    const createdResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/users" && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Salvar usuário", exact: true }).click();
    const created = await createdResponse;
    const createdBody = await created.json() as { user?: ManagedUser };
    target.id = createdBody.user?.id ?? "";
    expect(created.status()).toBe(201);
    expect(target.id).not.toBe("");
    await expect(dialog).not.toBeVisible();

    previousSession = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
    await loginApi(previousSession, target);
    expect((await previousSession.get("/api/equipment/overview")).status()).toBe(200);
    expect((await previousSession.post("/api/equipment", { data: equipmentInput })).status()).toBe(403);
    expect((await previousSession.get("/api/users")).status()).toBe(403);

    await page.getByPlaceholder("Buscar usuário por nome ou e-mail...", { exact: true }).fill(target.email);
    const row = page.getByRole("row").filter({ hasText: target.email });
    await row.getByRole("button", { name: `Editar usuário ${target.name}`, exact: true }).click();
    await dialog.getByLabel("Nome completo", { exact: true }).fill(`${target.name} atualizado`);
    await dialog.getByRole("checkbox", { name: "Alterar estoque", exact: true }).check();
    const grantResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/users/${target.id}` && response.request().method() === "PATCH");
    await dialog.getByRole("button", { name: "Salvar usuário", exact: true }).click();
    expect((await grantResponse).status()).toBe(200);
    await expect(dialog).not.toBeVisible();
    await expect(row.getByText(`${target.name} atualizado`, { exact: true })).toBeVisible();
    expect((await (await previousSession.get("/api/auth/me")).json()).user).toBeNull();
    expect((await previousSession.post("/api/equipment", { data: equipmentInput })).status()).toBe(401);

    freshSession = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
    await loginApi(freshSession, target);
    const me = await (await freshSession.get("/api/auth/me")).json() as { user: { permissions: string[] } };
    expect(me.user.permissions).toContain("INVENTORY_WRITE");
    expect(me.user.permissions).not.toContain("USERS_MANAGE");
    const equipmentResponse = await freshSession.post("/api/equipment", { data: equipmentInput });
    const equipmentBody = await equipmentResponse.json() as { equipment?: { id: string } };
    equipmentId = equipmentBody.equipment?.id;
    expect(equipmentResponse.status()).toBe(201);
    expect(equipmentId).toBeTruthy();
    expect((await freshSession.get("/api/users")).status()).toBe(403);

    userContext = await browser.newContext({ storageState: await freshSession.storageState() });
    const userPage = await userContext.newPage();
    await userPage.goto("http://127.0.0.1:3100/estoque");
    await expect(userPage.getByRole("button", { name: "Novo equipamento", exact: true }).first()).toBeVisible();
    await expect(userPage.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Usuários e permissões", exact: true })).toHaveCount(0);

    await row.getByRole("button", { name: `Editar usuário ${target.name} atualizado`, exact: true }).click();
    await dialog.getByLabel("Status da conta", { exact: true }).selectOption("inactive");
    const deactivateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/users/${target.id}` && response.request().method() === "PATCH");
    await dialog.getByRole("button", { name: "Salvar usuário", exact: true }).click();
    expect((await deactivateResponse).status()).toBe(200);
    await expect(dialog).not.toBeVisible();
    await expect(row.getByText("Inativo", { exact: true })).toBeVisible();
    expect((await (await freshSession.get("/api/auth/me")).json()).user).toBeNull();
    expect((await freshSession.get("/api/equipment/overview")).status()).toBe(401);
    await userPage.reload();
    await expect(userPage).toHaveURL(/\/login\?/);
    await expect(userPage.getByRole("heading", { name: "Acesse sua conta", exact: true })).toBeVisible();
  } finally {
    await userContext?.close();
    await previousSession?.dispose();
    await freshSession?.dispose();
    if (equipmentId) {
      const db = new Client({ connectionString: isolatedConnection() });
      await db.connect();
      try {
        await db.query('DELETE FROM "StockHistory" WHERE "equipmentId"=$1', [equipmentId]);
        await db.query('DELETE FROM "Equipment" WHERE id=$1', [equipmentId]);
      } finally { await db.end(); }
    }
    if (target.id) await removeAccount(target);
  }
});
