import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/server/prisma";
import { isInstitutionalEmail, normalizeEmail } from "@/lib/auth-validation";
import { permissionLabels, type AuthUser, type Permission, type UserRole } from "@/types/auth";

export const SESSION_MAX_AGE = 8 * 60 * 60;
const SCRYPT_N = 32768;
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: SCRYPT_N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${SCRYPT_N}$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || parts[1] !== String(SCRYPT_N) || parts[2] !== "8" || parts[3] !== "1" || !/^[0-9a-f]{32}$/.test(parts[4]) || !/^[0-9a-f]{128}$/.test(parts[5])) return false;
  const key = await derive(password, Buffer.from(parts[4], "hex"));
  return timingSafeEqual(key, Buffer.from(parts[5], "hex"));
}
export const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const departmentForRole = (role: UserRole) => ({ ADMIN: null, MULTIMEIOS: "Multimeios", MARKETING: "Marketing", EXTENSAO: "Projeto de Extensão" })[role];
type SessionUser = { id: string; name: string; email: string; role: UserRole; department: string | null; permissions: string[] };
export function authUserDto(user: SessionUser, sessionId: string): AuthUser {
  const permissions = user.role === "ADMIN" ? Object.keys(permissionLabels) as Permission[] : user.permissions.filter((permission): permission is Permission => permission !== "USERS_MANAGE" && Object.hasOwn(permissionLabels, permission));
  return { id: user.id, name: user.name, email: user.email, role: user.role, department: departmentForRole(user.role), permissions, sessionId };
}
export async function getSessionUser(token: string): Promise<AuthUser | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const session = await getPrisma().appSession.findUnique({ where: { tokenHash: hashSessionToken(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.active || !isInstitutionalEmail(session.user.email) || session.authVersion !== session.user.authVersion) return null;
  return authUserDto(session.user, session.id);
}
export async function revokeSession(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return;
  await getPrisma().$transaction(async (tx) => {
    const session = await tx.appSession.findUnique({ where: { tokenHash: hashSessionToken(token) } });
    if (!session || session.revokedAt) return;
    await tx.appSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorUserId: session.userId, action: "LOGOUT", entityType: "AppSession", entityId: session.id, description: "Sessão encerrada pelo usuário autenticado." } });
  });
}
// Limites persistidos por conta e globais. Nenhum cabeçalho de IP é tratado como confiável.
async function consumeLoginAttempt(email: string) {
  const accountKey = hashSessionToken(`account:${email}`);
  const globalKey = hashSessionToken("global-login-window");
  return getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('unieventos-login-global'))`;
    const now = new Date();
    for (const [key, maximum] of [[globalKey, 1000], [accountKey, 5]] as const) {
      const current = await tx.loginThrottle.findUnique({ where: { key } });
      if (current && current.windowEndsAt > now && current.attempts >= maximum) return false;
    }
    for (const key of [globalKey, accountKey]) {
      const current = await tx.loginThrottle.findUnique({ where: { key } });
      await tx.loginThrottle.upsert({ where: { key }, create: { key, attempts: 1, windowEndsAt: new Date(now.getTime() + 15 * 60_000) }, update: current && current.windowEndsAt > now ? { attempts: { increment: 1 } } : { attempts: 1, windowEndsAt: new Date(now.getTime() + 15 * 60_000) } });
    }
    return true;
  });
}
const dummyHash = `scrypt$${SCRYPT_N}$8$1$${"00".repeat(16)}$${"00".repeat(64)}`;
export async function authenticateCredentials(email: string, password: string): Promise<{ user: AuthUser; sessionToken: string } | null> {
  if (typeof email !== "string" || typeof password !== "string" || email.length > 254 || password.length > 128 || password.length < 1) return null;
  const normalized = normalizeEmail(email);
  const allowed = await consumeLoginAttempt(normalized);
  const user = allowed && isInstitutionalEmail(normalized) ? await getPrisma().user.findUnique({ where: { email: normalized } }) : null;
  const valid = await verifyPassword(password, user?.passwordHash || dummyHash);
  if (!allowed || !valid || !user?.active) return null;
  return getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR SHARE`;
    const current = await tx.user.findUnique({ where: { id: user.id } });
    if (!current?.active || !isInstitutionalEmail(current.email) || current.passwordHash !== user.passwordHash || current.authVersion !== user.authVersion) return null;
    const sessionToken = randomBytes(32).toString("hex");
    const session = await tx.appSession.create({ data: { tokenHash: hashSessionToken(sessionToken), userId: current.id, authVersion: current.authVersion, expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1000) } });
    await tx.loginThrottle.deleteMany({ where: { key: hashSessionToken(`account:${normalized}`) } });
    await tx.auditLog.create({ data: { actorUserId: current.id, action: "LOGIN", entityType: "AppSession", entityId: session.id, description: "Autenticação por credenciais institucionais concluída." } });
    return { user: authUserDto(current, session.id), sessionToken };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
