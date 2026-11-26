import type { Pagination } from "@/types/inventory";

export const movementStatusLabels = { IN_USE: "Em uso", PARTIAL: "Devolução parcial", OVERDUE: "Em atraso", COMPLETED: "Concluída", DAMAGED: "Com avaria", LOST: "Com extravio" } as const;
export type MovementStatus = keyof typeof movementStatusLabels;
export type SettlementCondition = "GOOD" | "DAMAGED" | "LOST";
export interface MovementChecklist { quantityChecked: boolean; conditionChecked: boolean; accessoriesChecked: boolean }
export interface WithdrawalInput {
  reservationId: string; quantity: number; unitIds: string[]; responsibleName: string;
  destination: string; notes: string; expectedReturnAt?: string; checklist: MovementChecklist;
}
export interface SettlementInput {
  version: number; goodQuantity: number; damagedQuantity: number; lostQuantity: number;
  units: { unitId: string; condition: SettlementCondition }[]; notes: string; checklist: MovementChecklist;
}
export interface ExtensionInput { version: number; expectedReturnAt: string; reason: string }
export interface MovementUnit {
  id: string; assetNumber: string; condition: "IN_USE" | SettlementCondition;
  returnedAt: string | null; lostAt: string | null;
}
export interface PhysicalMovement {
  id: string; equipmentId: string; equipmentName: string; trackingMode: "QUANTITY" | "INDIVIDUAL";
  reservationId: string | null; eventId: string | null; eventTitle: string | null;
  quantity: number; returnedQuantity: number; lostQuantity: number; damagedQuantity: number; pendingQuantity: number;
  responsibleName: string; destination: string; notes: string; createdAt: string; expectedReturnAt: string | null;
  actorUserId: string | null; actorName: string | null; version: number; status: MovementStatus; units: MovementUnit[];
  checklist: MovementChecklist | null;
}
export interface MovementSummary { total: number; inUse: number; pending: number; overdue: number; damaged: number; lost: number }
export interface MovementList { items: PhysicalMovement[]; pagination: Pagination; summary: MovementSummary }
export interface MovementOverview { items: PhysicalMovement[]; summary: MovementSummary; limitReached: boolean }
export interface SettlementView {
  id: string; createdAt: string; actorUserId: string; actorName: string; notes: string;
  goodQuantity: number; damagedQuantity: number; lostQuantity: number;
  units: { unitId: string; assetNumber: string; condition: SettlementCondition }[];
  checklist: MovementChecklist;
}
export interface MovementDetail {
  movement: PhysicalMovement; settlements: SettlementView[];
  history: { id: string; action: string; description: string; actorUserId: string | null; actorName: string | null; createdAt: string }[];
  permissions: { settle: boolean; extend: boolean; reason: string };
  warnings: string[];
}
export interface WithdrawalOption {
  reservationId: string; equipmentId: string; equipmentName: string; eventId: string; eventTitle: string;
  startsAt: string; endsAt: string; quantity: number; remainingQuantity: number; trackingMode: "QUANTITY" | "INDIVIDUAL";
  units: { id: string; assetNumber: string; available: boolean }[];
}
export interface AssetMovementHistory { unitId: string; assetNumber: string; equipmentId: string; equipmentName: string; items: MovementDetail[] }
