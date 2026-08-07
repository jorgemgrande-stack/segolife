/**
 * Lógica pura del filtro global de comunidad del admin (Todas/IE/UVA/...).
 * Separada del Context de React para que sea testable sin DOM y reutilizable
 * por cualquier router que necesite aplicar el mismo filtro (CRM, eventos,
 * venues, analítica — ver docs/SEGOLIFE_MULTICOMMUNITY_ARCHITECTURE.md Paso 5).
 *
 * "all" es un valor especial, no un id de comunidad — nunca se compara contra
 * un slug ("ie"/"uva") literal, solo contra ids numéricos reales.
 */

export const ADMIN_COMMUNITY_FILTER_ALL = "all" as const;

export type AdminCommunityFilterValue = typeof ADMIN_COMMUNITY_FILTER_ALL | number;

export const ADMIN_COMMUNITY_FILTER_STORAGE_KEY = "segolife-admin-community-filter";

/** Parsea el valor persistido (string | null) a un filtro válido. Nunca lanza. */
export function parseAdminCommunityFilter(raw: string | null | undefined): AdminCommunityFilterValue {
  if (!raw || raw === ADMIN_COMMUNITY_FILTER_ALL) return ADMIN_COMMUNITY_FILTER_ALL;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : ADMIN_COMMUNITY_FILTER_ALL;
}

/** Serializa un filtro para persistirlo. */
export function serializeAdminCommunityFilter(value: AdminCommunityFilterValue): string {
  return value === ADMIN_COMMUNITY_FILTER_ALL ? ADMIN_COMMUNITY_FILTER_ALL : String(value);
}

/** communityId a aplicar en una query — undefined significa "sin filtro" (Todas). */
export function communityFilterToQueryParam(value: AdminCommunityFilterValue): number | undefined {
  return value === ADMIN_COMMUNITY_FILTER_ALL ? undefined : value;
}
