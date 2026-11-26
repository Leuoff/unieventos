export const roleLabels = { ADMIN: "Administrador", MULTIMEIOS: "Multimeios", MARKETING: "Marketing", EXTENSAO: "Projeto de Extensão" } as const;
export type UserRole = keyof typeof roleLabels;
export const permissionLabels = {
  INVENTORY_WRITE: "Alterar estoque",
  MOVEMENTS_WRITE: "Registrar retiradas e devoluções",
  EVENT_MANAGE_ALL: "Gerenciar eventos de outros usuários",
  REQUEST_MANAGE_ALL: "Gerenciar solicitações de outros usuários",
  REQUEST_APPROVE: "Aprovar solicitações",
  REQUEST_REFUSE: "Recusar solicitações",
  RESERVATION_CANCEL: "Cancelar reservas aprovadas",
  USERS_MANAGE: "Administrar usuários",
} as const;
export type Permission = keyof typeof permissionLabels;
export interface AuthUser {
  id: string; name: string; email: string; role: UserRole; department: string | null;
  permissions: Permission[]; sessionId: string;
}
export interface ManagedUser {
  id: string; name: string; email: string; role: UserRole; department: string | null;
  active: boolean; permissions: Permission[]; version: number; createdAt: string; updatedAt: string;
}
export interface UserInput {
  name: string; email: string; role: UserRole; active: boolean;
  permissions: Permission[]; password?: string; version?: number;
}
