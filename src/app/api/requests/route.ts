import { requireActor } from "@/server/auth-context";
import { createRequest, listRequests } from "@/server/requests-service";
import { json, readJson, requestApiError } from "@/server/requests-http";
import type { RequestInput } from "@/types/requests";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireActor(); return json(await listRequests(new URL(request.url).searchParams)); } catch (error) { return requestApiError(error); }
}
export async function POST(request: Request) {
  try {
    await requireActor(); return json(await createRequest(await readJson(request) as RequestInput), 201); } catch (error) { return requestApiError(error); }
}
