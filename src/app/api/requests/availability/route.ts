import { requireActor } from "@/server/auth-context";
import { requestAvailability } from "@/server/requests-service";
import { json, readJson, requestApiError } from "@/server/requests-http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await requireActor(); return json(await requestAvailability(await readJson(request) as Parameters<typeof requestAvailability>[0])); }
  catch (error) { return requestApiError(error); }
}
