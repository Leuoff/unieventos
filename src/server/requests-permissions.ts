import "server-only";
import { z } from "zod";
import { InventoryError } from "@/server/inventory-error";
import { requireActor } from "@/server/auth-context";
import type { AuthUser, Permission } from "@/types/auth";

export type RequestPermission = "REQUEST_APPROVE" | "REQUEST_REFUSE" | "RESERVATION_CANCEL";
/** A identidade deve vir de uma sessão validada no servidor, nunca do corpo HTTP. */
export interface RequestActor { actorUserId: string; permissions: readonly Permission[]; identity?: AuthUser }
export type RequestAuthorizer = () => Promise<RequestActor>;
export const REQUEST_AUTHORIZATION_MESSAGE = "Sua conta não possui permissão para esta operação. Solicite acesso a um administrador.";

/** Negação segura até existir um provedor de sessão autenticada. */
export const unauthenticatedRequestAuthorizer: RequestAuthorizer = async () => {
  throw new InventoryError(401, "Sua sessão expirou ou não foi iniciada. Entre novamente para continuar.");
};

/** A sessão e as permissões são obtidas exclusivamente no servidor. */
export const authenticatedRequestAuthorizer: RequestAuthorizer = async () => {
  const identity = await requireActor();
  return { actorUserId: identity.id, permissions: identity.permissions, identity };
};

export async function authorizeRequest(authorizer: RequestAuthorizer, permission?: RequestPermission) {
  const actor = await authorizer();
  if (!actor || !z.uuid().safeParse(actor.actorUserId).success || !Array.isArray(actor.permissions) || (permission && !actor.permissions.includes(permission))) throw new InventoryError(403, "Sua identidade autenticada não possui permissão para esta ação.");
  return actor;
}
