import { requireActor } from "@/server/auth-context";
import { eventEquipmentOptions } from "@/server/events-service";
import { eventApiError, json } from "@/server/events-http";
export const runtime = "nodejs";
export async function GET(request: Request) { try {
    await requireActor(); return json(await eventEquipmentOptions(new URL(request.url).searchParams.get("q") ?? "")); } catch (error) { return eventApiError(error); } }
