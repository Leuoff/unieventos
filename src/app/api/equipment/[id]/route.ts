import { requireActor } from "@/server/auth-context";
import { deleteSchema, validateEquipment } from "@/lib/inventory-validation";
import { deleteEquipment, getEquipmentDetail, updateEquipment } from "@/server/inventory-service";
import { apiError, checkId, json, readJson } from "@/server/inventory-http";
import { InventoryError } from "@/server/inventory-error";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    await requireActor();
    const { id } = await params;
    checkId(id);
    const historyPage = Number(new URL(request.url).searchParams.get("historyPage") ?? "1");
    if (!Number.isSafeInteger(historyPage) || historyPage < 1) throw new InventoryError(400, "Página do histórico inválida.");
    return json(await getEquipmentDetail(id, historyPage));
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    await requireActor("INVENTORY_WRITE");
    const { id } = await params;
    checkId(id);
    const result = validateEquipment(await readJson(request), true);
    if (!result.success) throw new InventoryError(422, "Confira os campos do equipamento.", result.fieldErrors);
    return json({ equipment: await updateEquipment(id, result.data) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    await requireActor("INVENTORY_WRITE");
    const { id } = await params;
    checkId(id);
    const result = deleteSchema.safeParse(await readJson(request));
    if (!result.success) throw new InventoryError(422, "Reabra o equipamento para confirmar a versão atual.");
    return json(await deleteEquipment(id, result.data.version));
  } catch (error) { return apiError(error); }
}
