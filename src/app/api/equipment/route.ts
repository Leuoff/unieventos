import { requireActor } from "@/server/auth-context";
import { validateEquipment } from "@/lib/inventory-validation";
import { createEquipment, listEquipment } from "@/server/inventory-service";
import { apiError, json, readJson } from "@/server/inventory-http";
import { InventoryError } from "@/server/inventory-error";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireActor(); return json(await listEquipment(new URL(request.url).searchParams)); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await requireActor("INVENTORY_WRITE");
    const result = validateEquipment(await readJson(request));
    if (!result.success) throw new InventoryError(422, "Confira os campos do equipamento.", result.fieldErrors);
    return json({ equipment: await createEquipment(result.data) }, 201);
  } catch (error) { return apiError(error); }
}
