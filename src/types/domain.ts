export type Department = "Multimeios" | "Marketing" | "Projeto de Extensão";

export type EventCategory =
  | "Institucional"
  | "Acadêmico"
  | "Extensão"
  | "Cultural";

export type EventStatus =
  | "Confirmado"
  | "Em análise"
  | "Concluído"
  | "Cancelado";

export type EquipmentCategory =
  | "Audiovisual"
  | "Áudio"
  | "Informática"
  | "Iluminação"
  | "Acessórios";

export type RequestStatus = "Pendente" | "Aprovada" | "Recusada";
export type MovementType = "Retirada" | "Devolução";
export type MovementStatus = "Concluída" | "Prevista" | "Em atraso";
export type ActivityKind = "event" | "request" | "return" | "equipment";

export interface Event {
  id: string;
  title: string;
  description: string;
  /** Data civil no formato YYYY-MM-DD, exibida em America/Sao_Paulo. */
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  department: Department;
  kind: "Interno" | "Externo";
  category: EventCategory;
  status: EventStatus;
  attendees: number;
  equipmentIds: string[];
}

/** Saldo de uma categoria de equipamentos em uma referência de tempo. */
export interface Equipment {
  id: string;
  name: string;
  category: EquipmentCategory;
  total: number;
  available: number;
  reserved: number;
  inUse: number;
  maintenance: number;
  location: string;
}

export interface RequestItem {
  equipmentId: string;
  quantity: number;
}

export interface EquipmentRequest {
  id: string;
  eventId: string;
  department: Department;
  requester: string;
  date: string;
  status: RequestStatus;
  items: RequestItem[];
  note?: string;
}

export interface Movement {
  id: string;
  eventId: string;
  equipmentId: string;
  quantity: number;
  type: MovementType;
  responsible: string;
  /** Instante ISO 8601 com offset explícito. */
  date: string;
  status: MovementStatus;
}

export interface Activity {
  id: string;
  title: string;
  description: string;
  time: string;
  kind: ActivityKind;
}
