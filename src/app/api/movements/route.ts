import { requireActor } from "@/server/auth-context";
import { createWithdrawal, listMovements } from "@/server/movements-service";
import { json, readJson, movementApiError } from "@/server/movements-http";
import type { WithdrawalInput } from "@/types/movements";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return json(await listMovements(new URL(request.url).searchParams)); } catch (error) { return movementApiError(error); }
}
export async function POST(request: Request) {
  try { await requireActor("MOVEMENTS_WRITE"); return json(await createWithdrawal(await readJson(request) as WithdrawalInput), 201); } catch (error) { return movementApiError(error); }
}
