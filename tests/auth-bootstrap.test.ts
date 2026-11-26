import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { getPrisma } from "@/server/prisma";
import { bootstrapFirstAdmin } from "@/server/users-service";
import { authenticateCredentials } from "@/server/auth-core";
import { InventoryError } from "@/server/inventory-error";

assert.ok(process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === "/unieventos_test", "Use somente o banco isolado.");
test("bootstrap concorrente cria somente o primeiro ADMIN, com senha segura e auditoria", async (context) => {
  const db = getPrisma();
  if (await db.user.count()) { context.skip("Há contas pré-existentes no banco de testes; elas serão preservadas."); await db.$disconnect(); return; }
  const created: string[] = [];
  const inputs = [0, 1].map(() => ({ name: "Administrador de bootstrap de teste", email: `bootstrap-${randomUUID()}@unisalesiano.com.br`, password: randomBytes(24).toString("base64url") }));
  try {
    const results = await Promise.allSettled(inputs.map((input) => bootstrapFirstAdmin(input)));
    for (const result of results) if (result.status === "fulfilled") created.push(result.value.id);
    assert.equal(created.length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof InventoryError && rejected.reason.status === 409);
    const row = await db.user.findUniqueOrThrow({ where: { id: created[0] } });
    const input = inputs.find((entry) => entry.email === row.email)!;
    assert.equal(row.active && row.role === "ADMIN", true);
    assert.equal(row.passwordHash !== input.password && row.passwordHash.startsWith("scrypt$"), true);
    assert.ok(await authenticateCredentials(input.email, input.password));
    assert.equal(await db.auditLog.count({ where: { actorUserId: row.id, action: "ADMIN_BOOTSTRAPPED" } }), 1);
  } finally {
    await db.auditLog.deleteMany({ where: { actorUserId: { in: created } } });
    await db.appSession.deleteMany({ where: { userId: { in: created } } });
    await db.user.deleteMany({ where: { id: { in: created } } });
    await db.$disconnect();
  }
});
