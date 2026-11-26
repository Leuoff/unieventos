import { getActor } from "@/server/auth-context";
import { apiError, json } from "@/server/inventory-http";
export const runtime = "nodejs";
export async function GET() {
  try { return json({ user: await getActor() }); } catch (error) { return apiError(error); }
}
