import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { InventoryError } from "@/server/inventory-error";
import { json } from "@/server/inventory-http";
export { json, readJson } from "@/server/inventory-http";

export function checkRequestId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new InventoryError(404, "Solicitação não encontrada.");
}
export function requestApiError(error: unknown) {
  if (error instanceof InventoryError) return json({ error: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) }, error.status);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return json({ error: "O registro vinculado não foi encontrado." }, 404);
    if (["P2002", "P2003", "P2034"].includes(error.code)) return json({ error: "Os dados foram alterados ou possuem um vínculo em conflito. Atualize e tente novamente." }, 409);
  }
  return json({ error: "Não foi possível acessar as solicitações. Verifique a conexão e tente novamente." }, 503);
}
