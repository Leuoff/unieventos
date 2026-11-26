import { requireActor } from "@/server/auth-context";
import { decideRequest } from "@/server/requests-service";
import { checkRequestId, json, readJson, requestApiError } from "@/server/requests-http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireActor();
    const { id } = await context.params; checkRequestId(id);
    return json(await decideRequest(id, await readJson(request) as Parameters<typeof decideRequest>[1]));
  } catch (error) { return requestApiError(error); }
}
