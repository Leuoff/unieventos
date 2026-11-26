import { requireActor } from "@/server/auth-context";
import { createEvent, listEvents } from "@/server/events-service";
import { eventApiError, json, readJson } from "@/server/events-http";
import type { EventInput } from "@/types/events";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireActor(); return json(await listEvents(new URL(request.url).searchParams)); }
  catch (error) { return eventApiError(error); }
}
export async function POST(request: Request) {
  try {
    await requireActor(); return json(await createEvent(await readJson(request) as EventInput), 201); }
  catch (error) { return eventApiError(error); }
}
