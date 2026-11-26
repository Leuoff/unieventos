import { requireActor } from "@/server/auth-context";
import { extendWithdrawal } from "@/server/movements-service";
import { checkMovementId, json, readJson, movementApiError } from "@/server/movements-http";
import type { ExtensionInput } from "@/types/movements";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { await requireActor("MOVEMENTS_WRITE"); await requireActor("REQUEST_APPROVE"); const { id } = await context.params; checkMovementId(id); return json(await extendWithdrawal(id, await readJson(request) as ExtensionInput)); } catch (error) { return movementApiError(error); }
}
