import { z } from "zod";
import { InventoryError } from "@/server/inventory-error";
import { apiError, json, readJson } from "@/server/inventory-http";
import { getUser, updateUser } from "@/server/users-service";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
async function idFrom(context: Context) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) throw new InventoryError(404, "Usuário não encontrado.");
  return id;
}
export async function GET(_request: Request, context: Context) {
  try { return json({ user: await getUser(await idFrom(context)) }); } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try { return json({ user: await updateUser(await idFrom(context), await readJson(request)) }); } catch (error) { return apiError(error); }
}
