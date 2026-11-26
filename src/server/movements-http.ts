import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { InventoryError } from "@/server/inventory-error";
import { json } from "@/server/inventory-http";
export { json, readJson } from "@/server/inventory-http";
export function checkMovementId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new InventoryError(404, "Movimentação não encontrada.");
}
export function movementApiError(error: unknown) {
  if (error instanceof InventoryError) return json({ error: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) }, error.status);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return json({ error: "O registro vinculado não foi encontrado." }, 404);
    if (["P2002", "P2003", "P2034"].includes(error.code)) return json({ error: "Os registros possuem um vínculo em conflito ou foram alterados simultaneamente. Atualize os dados e tente novamente." }, 409);
  }
  return json({ error: "Não foi possível acessar as movimentações. Verifique a conexão e tente novamente." }, 503);
}
