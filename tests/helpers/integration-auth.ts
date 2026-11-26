import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test as nodeTest, type TestContext } from "node:test";
import { getPrisma } from "@/server/prisma";
import { authenticateCredentials, hashPassword } from "@/server/auth-core";
import { withSessionToken } from "@/server/auth-context";

assert.ok(process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === "/unieventos_test");
export const integrationUserId = randomUUID();
let session: Promise<string> | undefined;
async function token() {
  if (!session) session = (async () => {
    const password = randomBytes(24).toString("base64url");
    const email = `integration-${integrationUserId}@unisalesiano.com.br`;
    await getPrisma().user.create({ data: { id: integrationUserId, name: "Administrador de teste isolado", email, passwordHash: await hashPassword(password), role: "ADMIN", department: null, active: true, permissions: [] } });
    const authenticated = await authenticateCredentials(email, password);
    assert.ok(authenticated); return authenticated.sessionToken;
  })();
  return session;
}
export function test(name: string, body: (context: TestContext) => unknown | Promise<unknown>) {
  return nodeTest(name, async (context) => { await withSessionToken(await token(), () => body(context)); });
}
export async function cleanupAuthentication() {
  if (!session) return;
  await session;
  const db = getPrisma();
  await db.auditLog.deleteMany({ where: { actorUserId: integrationUserId } });
  await db.appSession.deleteMany({ where: { userId: integrationUserId } });
  await db.user.delete({ where: { id: integrationUserId } });
}
