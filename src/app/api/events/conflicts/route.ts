import { requireActor } from "@/server/auth-context";
import { eventConflicts } from "@/server/events-service";
import { eventApiError, json } from "@/server/events-http";
export const runtime = "nodejs";
export async function GET(request: Request) { try {
    await requireActor(); return json(await eventConflicts(new URL(request.url).searchParams)); } catch (error) { return eventApiError(error); } }
