import { withdrawalOptions } from "@/server/movements-service";
import { json, movementApiError } from "@/server/movements-http";
export const runtime = "nodejs";
export async function GET(request: Request) { try { return json(await withdrawalOptions(new URL(request.url).searchParams)); } catch (error) { return movementApiError(error); } }
