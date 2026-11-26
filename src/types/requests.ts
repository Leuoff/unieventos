import type { Pagination } from "@/types/inventory";

export const requestStatusLabels = { DRAFT: "Rascunho", PENDING: "Pendente", APPROVED: "Aprovada", REFUSED: "Recusada", CANCELLED: "Cancelada" } as const;
export type RequestStatus = keyof typeof requestStatusLabels;
export interface RequestInput {
  eventId: string;
  responsibleName: string;
  startsAt: string;
  endsAt: string;
  notes: string;
  items: { equipmentId: string; quantity: number; notes: string }[];
  version?: number;
}
export interface EquipmentRequest extends RequestInput {
  id: string;
  createdByUserId: string | null;
  eventTitle: string;
  department: string;
  status: RequestStatus;
  version: number;
  importedFromNeeds: boolean;
  createdAt: string;
  updatedAt: string;
  items: { id: string; equipmentId: string; equipmentName: string; quantity: number; notes: string }[];
}
export interface RequestHistoryEntry { id: string; action: string; description: string; actorUserId: string | null; createdAt: string }
export interface ReservationView {
  id: string; equipmentId: string; equipmentName: string; eventId: string | null; eventTitle: string | null;
  requestId: string | null; quantity: number; startsAt: string; endsAt: string;
  status: "ACTIVE" | "CANCELLED" | "COMPLETED"; assets: string[];
}
export interface AvailabilityItem {
  equipmentId: string; equipmentName: string; requested: number; available: number;
  sufficient: boolean; assetNumbers: string[]; message: string;
}
export interface RequestDetail {
  request: EquipmentRequest; history: RequestHistoryEntry[]; reservations: ReservationView[];
  availability: AvailabilityItem[];
  permissions: { edit: boolean; submit: boolean; approve: boolean; refuse: boolean; cancel: boolean; reason: string };
}
export interface RequestSummary { total: number; draft: number; pending: number; approved: number; refused: number; cancelled: number }
export interface RequestList { items: EquipmentRequest[]; pagination: Pagination; summary: RequestSummary }
export interface RequestOverview { summary: RequestSummary }
