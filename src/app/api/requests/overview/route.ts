import { requireActor } from "@/server/auth-context";
import { overviewRequests } from "@/server/requests-service";
import { json, requestApiError } from "@/server/requests-http";
export const runtime = "nodejs";
export async function GET() { try {
    await requireActor(); return json(await overviewRequests()); } catch (error) { return requestApiError(error); } }
