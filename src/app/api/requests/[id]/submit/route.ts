import { requireActor } from "@/server/auth-context";
import { submitRequest } from "@/server/requests-service";
import { checkRequestId, json, readJson, requestApiError } from "@/server/requests-http";
import { z } from "zod";
import { InventoryError } from "@/server/inventory-error";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireActor();
    const { id } = await context.params; checkRequestId(id);
    const body = z.object({ version: z.number().int().positive() }).strict().safeParse(await readJson(request));
    if (!body.success) throw new InventoryError(422, "Informe a versão atual da solicitação.");
    return json(await submitRequest(id, body.data.version));
  } catch (error) { return requestApiError(error); }
}
