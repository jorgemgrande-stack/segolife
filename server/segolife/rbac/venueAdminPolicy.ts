/**
 * venueAdminPolicy.ts — SEGOLIFE RBAC CONSOLIDATION (spec §20/§21/§35).
 * Documenta en código (no solo en una migración one-off) el bundle de
 * permisos que el rol RBAC `venue_admin` debe tener sembrado en
 * rbac_role_permissions — mínimo privilegio real, spec §22.
 *
 * INVARIANTE DE SEGURIDAD (spec §35, autoescalada): ninguna clave `.manage`
 * de estos dominios puede concederse a venue_admin. `getVenueStaffAccess()`
 * decide "¿este usuario es admin GLOBAL de este dominio?" comprobando la
 * MISMA clave `.manage` que gatea la operación completa del dominio
 * (benefits.manage / commerce.manage / attendance.manage) — si venue_admin
 * tuviera esa clave, `getVenueStaffAccess` lo trataría como admin global y
 * vería/operaría TODOS los venues, no solo los suyos. Es además la misma
 * clave que gatea addVenueStaff/removeVenueStaff — con ella, un Venue Admin
 * podría asignarse a sí mismo más venues (self-escalation, spec §35).
 */
export const VENUE_ADMIN_PERMISSION_BUNDLE = [
  "benefits.redeem",
  "commerce.view",
  "commerce.record",
  "attendance.redeem",
] as const;

/** Cualquier permiso cuya action sea "manage" es, por diseño de esta plataforma, un permiso de alcance GLOBAL — nunca debe concederse a venue_admin. */
export function isGlobalScopePermission(key: string): boolean {
  return key.endsWith(".manage") || key === "settings.manage" || key === "settings.view";
}

/** Dominios explícitamente fuera del alcance de VENUE_ADMIN (spec §22/§28/§29/§30): CRM, Communication Center, Fourvenues/integrations, Student 360, economía de SegoTokens. "referrals" añadido en Fase 8 (Referral & Invite Rewards Engine, spec §75) — mismo criterio que "tokens": economía adyacente, GLOBAL_ADMIN exclusivamente. */
export const VENUE_ADMIN_FORBIDDEN_MODULES = [
  "settings", "crm", "engagement", "integrations", "students360", "roles", "tokens", "referrals", "sales",
] as const;

export function isForbiddenModule(key: string): boolean {
  const module = key.split(".")[0];
  return (VENUE_ADMIN_FORBIDDEN_MODULES as readonly string[]).includes(module);
}
