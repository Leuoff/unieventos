import { requireActor } from "@/server/auth-context";
import { getMovementDetail } from "@/server/movements-service";
import { checkMovementId, json, movementApiError } from "@/server/movements-http";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { await requireActor(); const { id } = await context.params; checkMovementId(id); return json(await getMovementDetail(id)); } catch (error) { return movementApiError(error); }
}
