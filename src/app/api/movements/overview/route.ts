import { overviewMovements } from "@/server/movements-service";
import { json, movementApiError } from "@/server/movements-http";
export const runtime = "nodejs";
export async function GET() { try { return json(await overviewMovements()); } catch (error) { return movementApiError(error); } }
