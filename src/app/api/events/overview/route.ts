import { requireActor } from "@/server/auth-context";
import { overviewEvents } from "@/server/events-service";
import { eventApiError, json } from "@/server/events-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { try {
    await requireActor(); return json(await overviewEvents()); } catch (error) { return eventApiError(error); } }
