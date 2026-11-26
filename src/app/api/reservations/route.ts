import { requireActor } from "@/server/auth-context";
import { listReservations } from "@/server/requests-service";
import { json, requestApiError } from "@/server/requests-http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireActor(); return json(await listReservations(new URL(request.url).searchParams)); } catch (error) { return requestApiError(error); }
}
