import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { InventoryError } from "@/server/inventory-error";
import type { AvailabilityItem } from "@/types/requests";

export const availabilityInclude = {
  units: { orderBy: [{ assetNumber: "asc" as const }, { id: "asc" as const }] },
  reservations: { include: { units: true } },
  withdrawals: { include: { units: true } },
} satisfies Prisma.EquipmentInclude;
type Equipment = Prisma.EquipmentGetPayload<{ include: typeof availabilityInclude }>;

export interface AvailabilityResult { item: AvailabilityItem; unitIds: string[] }

/** [início, fim): término e início coincidentes não se sobrepõem. */
export function calculateRequestAvailability(equipment: Equipment, quantity: number, startsAt: Date, endsAt: Date, excludeReservationId?: string): AvailabilityResult {
  if (equipment.archivedAt) return { item: { equipmentId: equipment.id, equipmentName: equipment.name, requested: quantity, available: 0, sufficient: false, assetNumbers: [], message: "Equipamento arquivado. Novas reservas estão indisponíveis." }, unitIds: [] };
  const outstanding = equipment.withdrawals.reduce((sum, withdrawal) => sum + Math.max(0, withdrawal.quantity - withdrawal.returnedQuantity - withdrawal.lostQuantity), 0);
  const individual = equipment.trackingMode === "INDIVIDUAL";
  const total = individual ? equipment.units.length : equipment.total;
  const maintenance = individual ? equipment.units.filter((unit) => unit.state === "MAINTENANCE").length : equipment.maintenance;
  const lost = individual ? equipment.units.filter((unit) => unit.state === "LOST").length : equipment.lost;
  const overlapping = equipment.reservations.filter((reservation) => reservation.id !== excludeReservationId && reservation.status === "ACTIVE" && reservation.startsAt < endsAt && reservation.endsAt > startsAt);
  const changes = new Map<number, number>();
  const blockedUnitIds = new Set(equipment.withdrawals.flatMap((withdrawal) => withdrawal.units.filter((unit) => unit.returnedAt === null && unit.lostAt === null).map((unit) => unit.unitId)));
  let incompleteUnitAllocation = individual && outstanding !== blockedUnitIds.size;
  for (const reservation of overlapping) {
    const withdrawals = equipment.withdrawals.filter((withdrawal) => withdrawal.reservationId === reservation.id);
    const remaining = Math.max(0, reservation.quantity - withdrawals.reduce((sum, withdrawal) => sum + withdrawal.quantity, 0));
    const start = Math.max(startsAt.getTime(), reservation.startsAt.getTime());
    const end = Math.min(endsAt.getTime(), reservation.endsAt.getTime());
    changes.set(start, (changes.get(start) ?? 0) + remaining);
    changes.set(end, (changes.get(end) ?? 0) - remaining);
    if (individual) {
      const fulfilled = new Set(withdrawals.flatMap((withdrawal) => withdrawal.units.map((unit) => unit.unitId)));
      const remainingUnits = reservation.units.filter((unit) => !fulfilled.has(unit.unitId));
      if (remainingUnits.length !== remaining) incompleteUnitAllocation = true;
      for (const unit of remainingUnits) blockedUnitIds.add(unit.unitId);
    }
  }
  let running = 0;
  let peak = 0;
  for (const [, change] of [...changes.entries()].sort(([a], [b]) => a - b)) { running += change; peak = Math.max(peak, running); }
  const capacity = Math.max(0, total - maintenance - lost - outstanding - peak);
  const candidates = individual ? equipment.units.filter((unit) => unit.state === "AVAILABLE" && !blockedUnitIds.has(unit.id)) : [];
  // Uma unidade individual precisa estar livre no intervalo inteiro. Não se troca patrimônio no meio da reserva.
  const available = individual ? (incompleteUnitAllocation ? 0 : Math.min(capacity, candidates.length)) : capacity;
  const sufficient = quantity <= available;
  const message = incompleteUnitAllocation
    ? "Há uma alocação individual incompleta no estoque. Revise os patrimônios antes de aprovar."
    : sufficient
      ? `${available} unidade(s) disponível(is) durante todo o período. A consulta não cria uma reserva.`
      : `Estoque insuficiente no período: solicitado ${quantity}, disponível ${available}. Considere reservas aprovadas, retiradas pendentes, manutenção e extravios.`;
  return { item: { equipmentId: equipment.id, equipmentName: equipment.name, requested: quantity, available, sufficient, assetNumbers: candidates.slice(0, available).map((unit) => unit.assetNumber), message }, unitIds: candidates.slice(0, quantity).map((unit) => unit.id) };
}

export async function availabilityInTransaction(tx: Prisma.TransactionClient, input: { startsAt: string; endsAt: string; items: { equipmentId: string; quantity: number }[] }) {
  const equipment = await tx.equipment.findMany({ where: { id: { in: input.items.map((item) => item.equipmentId) } }, include: availabilityInclude });
  return input.items.map((item) => {
    const record = equipment.find((row) => row.id === item.equipmentId);
    if (!record) throw new InventoryError(422, "Um equipamento informado não foi encontrado. Selecione itens reais do estoque.");
    return calculateRequestAvailability(record, item.quantity, new Date(input.startsAt), new Date(input.endsAt));
  });
}
