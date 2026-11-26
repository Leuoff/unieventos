import { requireActor } from "@/server/auth-context";
import { getRequestDetail, updateRequest } from "@/server/requests-service";
import { checkRequestId, json, readJson, requestApiError } from "@/server/requests-http";
import type { RequestInput } from "@/types/requests";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    await requireActor(); const { id } = await context.params; checkRequestId(id); return json(await getRequestDetail(id)); } catch (error) { return requestApiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    await requireActor(); const { id } = await context.params; checkRequestId(id); return json(await updateRequest(id, await readJson(request) as RequestInput)); } catch (error) { return requestApiError(error); }
}
