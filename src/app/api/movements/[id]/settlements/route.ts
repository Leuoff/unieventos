import { requireActor } from "@/server/auth-context";
import { settleWithdrawal } from "@/server/movements-service";
import { checkMovementId, json, readJson, movementApiError } from "@/server/movements-http";
import type { SettlementInput } from "@/types/movements";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { await requireActor("MOVEMENTS_WRITE"); const { id } = await context.params; checkMovementId(id); return json(await settleWithdrawal(id, await readJson(request) as SettlementInput)); } catch (error) { return movementApiError(error); }
}
