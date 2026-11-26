import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalPrisma = globalThis as unknown as { inventoryPrisma?: PrismaClient };

export function getPrisma() {
  if (!process.env.DATABASE_URL) throw new Error("INVENTORY_DATABASE_NOT_CONFIGURED");
  if (!globalPrisma.inventoryPrisma) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, max: 5 });
    globalPrisma.inventoryPrisma = new PrismaClient({ adapter });
  }
  return globalPrisma.inventoryPrisma;
}
