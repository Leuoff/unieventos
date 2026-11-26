import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@/generated/prisma/client";
import { getSessionUser, authUserDto } from "@/server/auth-core";
import { InventoryError } from "@/server/inventory-error";
import { isInstitutionalEmail } from "@/lib/auth-validation";
import type { AuthUser, Permission } from "@/types/auth";

// Trusted server-code dependency injection; this accepts only a persisted session token,
// not a user, role or permissions. It is never wired to request headers or HTTP bodies.
const sessionContext = new AsyncLocalStorage<string>();
export function withSessionToken<T>(token: string, callback: () => T): T {
  return sessionContext.run(token, callback);
}
export async function getActor(): Promise<AuthUser | null> {
  const token = sessionContext.getStore();
  if (token !== undefined) return getSessionUser(token);
  const { auth } = await import("@/auth");
  return (await auth())?.user || null;
}
export async function requireActor(permission?: Permission): Promise<AuthUser> {
  const actor = await getActor();
  if (!actor) throw new InventoryError(401, "Sua sessão expirou ou não foi iniciada. Entre novamente para continuar.");
  if (permission && !actor.permissions.includes(permission)) throw new InventoryError(403, "Seu perfil não tem permissão para esta operação.");
  return actor;
}
export async function requireActorInTransaction(tx: Prisma.TransactionClient, permission?: Permission, actor?: AuthUser): Promise<AuthUser> {
  const claimed = actor || await requireActor();
  // Lock the persisted account and session until the protected transaction commits.
  // Concurrent deactivation, revocation and permission changes cannot race a decision.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${claimed.id}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "AppSession" WHERE "id" = ${claimed.sessionId}::uuid FOR SHARE`;
  const session = await tx.appSession.findUnique({ where: { id: claimed.sessionId }, include: { user: true } });
  if (!session || session.userId !== claimed.id || session.revokedAt || session.expiresAt <= new Date() || !session.user.active || !isInstitutionalEmail(session.user.email) || session.authVersion !== session.user.authVersion) throw new InventoryError(401, "Sua sessão expirou ou foi encerrada. Entre novamente para continuar.");
  const verified = authUserDto(session.user, session.id);
  if (permission && !verified.permissions.includes(permission)) throw new InventoryError(403, "Seu perfil não tem permissão para esta operação.");
  return verified;
}
