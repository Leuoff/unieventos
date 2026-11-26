import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { createUserSchema, institutionalDomains, updateUserSchema } from "@/lib/auth-validation";
import { departmentForRole, hashPassword } from "@/server/auth-core";
import { requireActor, requireActorInTransaction } from "@/server/auth-context";
import { InventoryError } from "@/server/inventory-error";
import { getPrisma } from "@/server/prisma";
import { isTransactionConflict, waitForTransactionRetry } from "@/server/transaction-conflict";
import { roleLabels, type ManagedUser, type Permission, type UserInput } from "@/types/auth";

const select = { id: true, name: true, email: true, role: true, department: true, active: true, permissions: true, version: true, createdAt: true, updatedAt: true } satisfies Prisma.UserSelect;
type UserRecord = Prisma.UserGetPayload<{ select: typeof select }>;
const dto = (row: UserRecord): ManagedUser => ({ ...row, permissions: row.permissions as Permission[], createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const auditDto = (row: UserRecord) => ({ id: row.id, name: row.name, email: row.email, role: row.role, department: row.department, active: row.active, permissions: row.permissions, version: row.version });
function parse(input: unknown, update = false): UserInput {
  const result = (update ? updateUserSchema : createUserSchema).safeParse(input);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) fieldErrors[String(issue.path[0] || "form")] ??= issue.message;
    throw new InventoryError(400, "Confira os dados do usuário.", fieldErrors);
  }
  return result.data;
}
async function transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await getPrisma().$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new InventoryError(409, "Este e-mail institucional já está cadastrado.", { email: "E-mail já cadastrado." });
      if (!isTransactionConflict(error) || attempt === 4) throw error;
      await waitForTransactionRetry(attempt);
    }
  }
  throw new InventoryError(409, "Outro administrador alterou os usuários. Atualize e tente novamente.");
}
export async function listUsers(params = new URLSearchParams()) {
  await requireActor("USERS_MANAGE");
  const page = Number(params.get("page") || 1);
  const pageSize = Number(params.get("pageSize") || 12);
  if (!Number.isSafeInteger(page) || page < 1 || ![6, 12, 24].includes(pageSize)) throw new InventoryError(400, "Paginação inválida.");
  const q = (params.get("q") || "").trim().slice(0, 120);
  const role = params.get("role");
  const active = params.get("active") || "all";
  if (role && !(role in roleLabels)) throw new InventoryError(400, "Perfil inválido.");
  if (!["all", "active", "inactive"].includes(active)) throw new InventoryError(400, "Status inválido.");
  const where: Prisma.UserWhereInput = { ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}), ...(role ? { role: role as UserInput["role"] } : {}), ...(active === "all" ? {} : { active: active === "active" }) };
  const [total, rows] = await getPrisma().$transaction([getPrisma().user.count({ where }), getPrisma().user.findMany({ where, select, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize })]);
  return { items: rows.map(dto), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, domains: institutionalDomains() };
}
export async function getUser(id: string) {
  await requireActor("USERS_MANAGE");
  const user = await getPrisma().user.findUnique({ where: { id }, select });
  if (!user) throw new InventoryError(404, "Usuário não encontrado.");
  return dto(user);
}
export async function createUser(input: unknown) {
  const actor = await requireActor("USERS_MANAGE");
  const data = parse(input);
  const passwordHash = await hashPassword(data.password!);
  return transaction(async (tx) => {
    await requireActorInTransaction(tx, "USERS_MANAGE", actor);
    const user = await tx.user.create({ data: { name: data.name, email: data.email, passwordHash, role: data.role, department: departmentForRole(data.role), active: data.active, permissions: data.role === "ADMIN" ? [] : data.permissions }, select });
    await tx.auditLog.create({ data: { actorUserId: actor.id, action: "USER_CREATED", entityType: "User", entityId: user.id, description: "Conta institucional cadastrada por administrador autenticado.", after: auditDto(user) } });
    return dto(user);
  });
}
export async function updateUser(id: string, input: unknown) {
  const actor = await requireActor("USERS_MANAGE");
  const data = parse(input, true);
  const passwordHash = data.password ? await hashPassword(data.password) : undefined;
  return transaction(async (tx) => {
    // Shared lock order serializes administrative changes and protects the last admin.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('unieventos-users-administration'))`;
    await requireActorInTransaction(tx, "USERS_MANAGE", actor);
    const existing = await tx.user.findUnique({ where: { id }, select: { ...select, authVersion: true } });
    if (!existing) throw new InventoryError(404, "Usuário não encontrado.");
    if (existing.version !== data.version) throw new InventoryError(409, "Este usuário foi alterado. Atualize os dados antes de salvar.");
    const permissions = data.role === "ADMIN" ? [] : [...data.permissions].sort();
    const samePermissions = JSON.stringify([...existing.permissions].sort()) === JSON.stringify(permissions);
    if (actor.id === id && (data.role !== existing.role || data.active !== existing.active || !samePermissions)) throw new InventoryError(403, "Você não pode alterar seu próprio perfil, status ou permissões.");
    if (existing.active && existing.role === "ADMIN" && (!data.active || data.role !== "ADMIN")) {
      const admins = await tx.user.count({ where: { active: true, role: "ADMIN" } });
      if (admins <= 1) throw new InventoryError(409, "É necessário manter ao menos um administrador ativo.");
    }
    const securityChanged = data.email !== existing.email || data.role !== existing.role || data.active !== existing.active || !samePermissions || !!passwordHash;
    const user = await tx.user.update({ where: { id }, data: { name: data.name, email: data.email, role: data.role, department: departmentForRole(data.role), active: data.active, permissions, ...(passwordHash ? { passwordHash } : {}), version: { increment: 1 }, ...(securityChanged ? { authVersion: { increment: 1 } } : {}) }, select });
    if (securityChanged) await tx.appSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorUserId: actor.id, action: !data.active && existing.active ? "USER_DEACTIVATED" : "USER_UPDATED", entityType: "User", entityId: id, description: securityChanged ? "Conta atualizada; sessões anteriores revogadas por alteração de segurança." : "Dados cadastrais da conta atualizados.", before: auditDto(existing), after: { ...auditDto(user), passwordChanged: !!passwordHash } } });
    return dto(user);
  });
}
/** Somente CLI local confiável; não há rota pública para bootstrap ou cadastro. */
export async function bootstrapFirstAdmin(input: { name: string; email: string; password: string }) {
  const data = parse({ ...input, role: "ADMIN", active: true, permissions: [] });
  const passwordHash = await hashPassword(data.password!);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('unieventos-users-administration'))`;
    if (await tx.user.count()) throw new InventoryError(409, "O bootstrap já foi concluído. Use um administrador existente para gerenciar contas.");
    const user = await tx.user.create({ data: { name: data.name, email: data.email, passwordHash, role: "ADMIN", department: null, active: true, permissions: [] }, select });
    await tx.auditLog.create({ data: { actorUserId: user.id, action: "ADMIN_BOOTSTRAPPED", entityType: "User", entityId: user.id, description: "Primeiro administrador criado pelo bootstrap local, sem senha padrão." } });
    return dto(user);
  });
}
