import "server-only";

/** Prisma pode expor o conflito como P2034 ou preservar a causa do adaptador pg. */
export function isTransactionConflict(error: unknown): boolean {
  const visited = new Set<object>();
  function inspect(value: unknown, depth: number): boolean {
    if (typeof value !== "object" || value === null || visited.has(value) || depth > 8) return false;
    visited.add(value);
    const record = value as Record<string, unknown>;
    if (record.code === "P2034" || record.code === "40001" || record.code === "40P01" || record.originalCode === "40001" || record.originalCode === "40P01" || record.kind === "TransactionWriteConflict") return true;
    return ["cause", "meta", "driverAdapterError", "error"].some((key) => inspect(record[key], depth + 1));
  }
  return inspect(error, 0);
}

/** Pequeno recuo com variação evita que duas transações repitam o conflito em sincronia. */
export async function waitForTransactionRetry(attempt: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, 10 * 2 ** attempt + Math.floor(Math.random() * 15)));
}
