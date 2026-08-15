/**
 * adminGuard.ts — SEGOLIFE RBAC CONSOLIDATION (spec §33/§34). Regla pura,
 * sin BD: decide si un cambio de rol dejaría el sistema sin ningún
 * Administrador General activo. Antes esta guardia SOLO existía en el
 * cliente (UsersManager.tsx) — cualquier llamada directa a
 * admin.changeUserRole podía degradar al último admin sin ninguna
 * comprobación server-side ("backend manda", spec §47).
 */
export interface AdminGuardTarget {
  role: string;
  isActive: boolean;
}

export function wouldRemoveLastAdmin(newRole: string, target: AdminGuardTarget | undefined, activeAdminCount: number): boolean {
  if (newRole === "admin") return false;
  if (!target || target.role !== "admin" || !target.isActive) return false;
  return activeAdminCount <= 1;
}
