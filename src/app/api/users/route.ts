import { apiError, json, readJson } from "@/server/inventory-http";
import { createUser, listUsers } from "@/server/users-service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return json(await listUsers(new URL(request.url).searchParams)); } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { return json({ user: await createUser(await readJson(request)) }, 201); } catch (error) { return apiError(error); }
}
