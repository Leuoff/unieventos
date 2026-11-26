import { requireActor } from "@/server/auth-context";
import { archiveEvent, getEventDetail, updateEvent } from "@/server/events-service";
import { checkEventId, eventApiError, EventError, json, readJson } from "@/server/events-http";
import { eventArchiveSchema } from "@/lib/events-validation";
import type { EventInput } from "@/types/events";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    await requireActor();
    const { id } = await params;
    checkEventId(id);
    const page = Number(new URL(request.url).searchParams.get("historyPage") ?? 1);
    if (!Number.isSafeInteger(page) || page < 1) throw new EventError(400, "Página do histórico inválida.");
    return json(await getEventDetail(id, page));
  } catch (error) { return eventApiError(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    await requireActor();
    const { id } = await params;
    checkEventId(id);
    return json(await updateEvent(id, await readJson(request) as EventInput));
  } catch (error) { return eventApiError(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    await requireActor();
    const { id } = await params;
    checkEventId(id);
    const result = eventArchiveSchema.safeParse(await readJson(request));
    if (!result.success) throw new EventError(422, "Informe o motivo do arquivamento e a versão atual.", Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message])));
    return json(await archiveEvent(id, result.data.version, result.data.reason));
  } catch (error) { return eventApiError(error); }
}
