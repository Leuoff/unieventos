import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { InventoryError } from "@/server/inventory-error";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function checkId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new InventoryError(404, "Equipamento não encontrado.");
}

export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new InventoryError(403, "Esta operação deve ser realizada pelo UniEventos.");
  const origin = request.headers.get("origin");
  // Next.js may normalize request.url to localhost; Host preserves the browser target.
  if (origin) {
    let sameOrigin = false;
    try {
      const parsed = new URL(origin);
      const expected = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : `${new URL(request.url).protocol}//${request.headers.get("host")}`;
      sameOrigin = ["http:", "https:"].includes(parsed.protocol) && parsed.origin === expected;
    } catch { /* Opaque or malformed origins are rejected. */ }
    if (!sameOrigin) throw new InventoryError(403, "Esta operação deve ser realizada pelo UniEventos.");
  }
  if (!request.headers.get("content-type")?.includes("application/json")) throw new InventoryError(415, "Envie os dados no formato JSON.");
  if (Number(request.headers.get("content-length") || 0) > 200_000) throw new InventoryError(413, "Os dados enviados excedem o limite permitido.");
  let text: string;
  try { text = await request.text(); } catch { throw new InventoryError(400, "Não foi possível ler os dados enviados."); }
  if (text.length > 200_000) throw new InventoryError(413, "Os dados enviados excedem o limite permitido.");
  try { return JSON.parse(text); } catch { throw new InventoryError(400, "Os dados enviados não são um JSON válido."); }
}

export function apiError(error: unknown) {
  if (error instanceof InventoryError) return json({ error: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) }, error.status);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return json({ error: "Este número de patrimônio já está cadastrado. Confira todas as unidades.", fieldErrors: { units: "Já existe uma unidade com este número de patrimônio." } }, 409);
    if (error.code === "P2025") return json({ error: "Equipamento não encontrado." }, 404);
    if (error.code === "P2003") return json({ error: "Esta unidade possui histórico vinculado e não pode ser removida." }, 409);
    if (error.code === "P2034") return json({ error: "Outro processo alterou o estoque. Atualize os dados e tente novamente." }, 409);
  }
  // Drivers can wrap network failures in different Prisma errors. Do not expose URLs or SQL.
  return json({ error: "Não foi possível acessar o estoque. Verifique se o banco está disponível e tente novamente." }, 503);
}
