import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { Client } from "pg";
import { test as base, request as playwrightRequest, expect, type APIRequestContext } from "@playwright/test";

export interface TestAccount { id: string; name: string; email: string; password: string; role: string }
export function isolatedConnection() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || new URL(url).pathname !== "/unieventos_test" || url === process.env.DATABASE_URL) throw new Error("Use exclusivamente unieventos_test para criar identidades de teste.");
  return url;
}
export async function createAccount(role = "ADMIN", permissions: string[] = []): Promise<TestAccount> {
  const id = randomUUID(), password = randomBytes(24).toString("base64url"), salt = randomBytes(16);
  const key = await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, value) => error ? reject(error) : resolve(value)));
  const passwordHash = `scrypt$32768$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
  const account = { id, name: `Usuário E2E ${role}`, email: `e2e-${id}@unisalesiano.com.br`, password, role };
  const db = new Client({ connectionString: isolatedConnection() }); await db.connect();
  try {
    const department = ({ MULTIMEIOS: "Multimeios", MARKETING: "Marketing", EXTENSAO: "Projeto de Extensão" } as Record<string, string>)[role] ?? null;
    await db.query('INSERT INTO "User" (id,name,email,"passwordHash",role,department,permissions,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())', [id, account.name, account.email, passwordHash, role, department, permissions]);
  } finally { await db.end(); }
  return account;
}
export async function removeAccount(account: TestAccount) {
  const db = new Client({ connectionString: isolatedConnection() }); await db.connect();
  try {
    await db.query('DELETE FROM "AuditLog" WHERE "actorUserId"=$1', [account.id]);
    await db.query('DELETE FROM "AppSession" WHERE "userId"=$1', [account.id]);
    await db.query('DELETE FROM "User" WHERE id=$1', [account.id]);
  } finally { await db.end(); }
}
export async function loginApi(api: APIRequestContext, account: TestAccount) {
  const csrf = await api.get("/api/auth/csrf");
  expect(csrf.ok()).toBe(true);
  const { csrfToken } = await csrf.json() as { csrfToken: string };
  const login = await api.post("/api/auth/callback/credentials", { headers: { "X-Auth-Return-Redirect": "1" }, form: { csrfToken, email: account.email, password: account.password, callbackUrl: "http://127.0.0.1:3100/" } });
  expect(login.ok(), await login.text()).toBe(true);
  const me = await api.get("/api/auth/me");
  expect(me.ok(), await me.text()).toBe(true);
  expect((await me.json()).user?.id).toBe(account.id);
}
export const test = base.extend<object, { account: TestAccount }>({
  account: [async ({}, provide) => {
    const account = await createAccount();
    try { await provide(account); } finally { await removeAccount(account); }
  }, { scope: "worker" }],
  storageState: async ({ account }, provide) => {
    const api = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:3100" });
    try { await loginApi(api, account); await provide(await api.storageState()); }
    finally { await api.dispose(); }
  },
});
export { expect };
