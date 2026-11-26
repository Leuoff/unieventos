import { requireActor } from "@/server/auth-context";
import { importEventNeeds } from "@/server/requests-service";
import { json, readJson, requestApiError } from "@/server/requests-http";
import { z } from "zod";
import { InventoryError } from "@/server/inventory-error";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await requireActor();
    const body = z.object({ eventId: z.uuid() }).strict().safeParse(await readJson(request));
    if (!body.success) throw new InventoryError(422, "Selecione um evento real para reaproveitar as necessidades.");
    return json(await importEventNeeds(body.data.eventId));
  } catch (error) { return requestApiError(error); }
}
