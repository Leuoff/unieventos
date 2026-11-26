import { requireActor } from "@/server/auth-context";
import { overviewEquipment } from "@/server/inventory-service";
import { apiError, json } from "@/server/inventory-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireActor(); return json(await overviewEquipment()); }
  catch (error) { return apiError(error); }
}
