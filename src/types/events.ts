import type { Department } from "@/types/domain";
import type { Pagination } from "@/types/inventory";

export const DEPARTMENTS: Department[] = ["Multimeios", "Marketing", "Projeto de Extensão"];
export const eventStatusLabels = { PLANNED: "Em análise", CONFIRMED: "Confirmado", COMPLETED: "Concluído", CANCELLED: "Cancelado" } as const;
export const eventKindLabels = { INTERNAL: "Interno", EXTERNAL: "Externo" } as const;
export type CalendarEventStatus = keyof typeof eventStatusLabels;
export type CalendarEventKind = keyof typeof eventKindLabels;

export interface EventEquipmentNeed {
  id: string;
  equipmentId: string;
  equipmentName: string;
  equipmentCategory: string;
  equipmentArchived: boolean;
  quantity: number;
  notes: string;
}

export interface CalendarEvent {
  id: string;
  createdByUserId: string | null;
  title: string;
  description: string;
  department: Department;
  responsibleName: string;
  contact: string;
  location: string;
  kind: CalendarEventKind;
  status: CalendarEventStatus;
  startsAt: string;
  endsAt: string;
  equipmentNeeds: EventEquipmentNeed[];
  version: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventInput {
  title: string;
  description: string;
  department: Department;
  responsibleName: string;
  contact: string;
  location: string;
  kind: CalendarEventKind;
  status: CalendarEventStatus;
  startsAt: string;
  endsAt: string;
  equipmentNeeds: { equipmentId: string; quantity: number; notes: string }[];
  version?: number;
  reason?: string;
}

export interface EventConflict {
  id: string;
  title: string;
  location: string;
  startsAt: string;
  endsAt: string;
  department: Department;
}

export interface EventSummary {
  total: number;
  confirmed: number;
  external: number;
  cancelled: number;
  today: number;
  upcoming: number;
}

export interface EventList {
  items: CalendarEvent[];
  pagination: Pagination;
  summary: EventSummary;
  locations: string[];
}

export interface EventDetail {
  event: CalendarEvent;
  history: { id: string; action: string; description: string; actorUserId: string | null; createdAt: string }[];
  historyPagination: Pagination;
  conflicts: EventConflict[];
  permissions: { edit: boolean; archive: boolean };
}

export interface EventMutation { event: CalendarEvent; conflicts: EventConflict[] }
export interface EventOverview { items: CalendarEvent[]; summary: EventSummary; today: string; timeZone: "America/Sao_Paulo" }
export interface EventEquipmentOption { id: string; name: string; category: string; archivedAt: string | null; total: number; available: number }
