import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { InventoryError } from "@/server/inventory-error";
import { json } from "@/server/inventory-http";
export { json, readJson } from "@/server/inventory-http";
export { InventoryError as EventError } from "@/server/inventory-error";

export function checkEventId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new InventoryError(404, "Evento não encontrado.");
}

export function eventApiError(error: unknown) {
  if (error instanceof InventoryError) return json({ error: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) }, error.status);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return json({ error: "Evento não encontrado." }, 404);
    if (error.code === "P2003") return json({ error: "Um equipamento informado não está mais disponível para vínculo. Revise as necessidades." }, 409);
    if (error.code === "P2002") return json({ error: "Informe cada equipamento apenas uma vez nas necessidades." }, 409);
    if (error.code === "P2034") return json({ error: "O evento foi alterado simultaneamente. Atualize os dados e tente novamente." }, 409);
  }
  return json({ error: "Não foi possível acessar os eventos. Verifique a conexão e tente novamente." }, 503);
}
