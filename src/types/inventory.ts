/** Contratos do estoque persistido. Não reutilizam os snapshots de demonstração. */
export type TrackingMode = "QUANTITY" | "INDIVIDUAL";
export type UnitStatus = "AVAILABLE" | "RESERVED" | "IN_USE" | "MAINTENANCE" | "LOST";

export interface InventoryUnit {
  id: string;
  assetNumber: string;
  status: UnitStatus;
}

export interface InventoryEquipment {
  id: string;
  name: string;
  category: string;
  description: string;
  location: string;
  trackingMode: TrackingMode;
  total: number;
  available: number;
  reserved: number;
  inUse: number;
  maintenance: number;
  lost: number;
  /** Compromissos atuais sem capacidade física, por atraso, avaria ou extravio. */
  conflictQuantity: number;
  units: InventoryUnit[];
  version: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentInput {
  name: string;
  category: string;
  description: string;
  location: string;
  trackingMode: TrackingMode;
  total: number;
  maintenance: number;
  units: { id?: string; assetNumber: string; status: UnitStatus }[];
  reason?: string;
  version?: number;
}

export interface InventorySummary {
  totalTypes: number;
  total: number;
  available: number;
  reserved: number;
  inUse: number;
  maintenance: number;
  lost: number;
  conflictQuantity: number;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface EquipmentList {
  items: InventoryEquipment[];
  summary: InventorySummary;
  categories: string[];
  pagination: Pagination;
}

export interface EquipmentDetail {
  equipment: InventoryEquipment;
  history: { id: string; action: string; description: string; createdAt: string }[];
  historyPagination: Pagination;
  canDelete: boolean;
  deleteBlockedReason: string | null;
}

export interface InventoryOverview {
  summary: InventorySummary;
  items: InventoryEquipment[];
}
