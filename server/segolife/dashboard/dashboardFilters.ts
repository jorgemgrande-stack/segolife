/**
 * dashboardFilters.ts — SEGOLIFE ADMIN COMMAND CENTER. Contexto normalizado
 * de filtro (comunidad + rango de tiempo) que reciben TODOS los módulos del
 * dashboard — nunca se resuelve la comunidad de forma distinta en cada
 * widget.
 *
 * COMUNIDAD (spec §33, CRÍTICO): nunca se infiere desde el venue. Un venue
 * puede pertenecer a más de una comunidad — el filtro por comunidad usa
 * SIEMPRE las relaciones reales (`user_communities` para estudiantes/
 * actividad de demanda, `community_venues`/`community_events` para
 * venues/eventos — actividad de "oferta"). Nunca `if (community==="ie")`.
 */
import { eq, inArray, type SQL } from "drizzle-orm";
import { userCommunities, communityVenues, communityEvents } from "../../../drizzle/schema";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";

export type TimeRangeKey = "today" | "7d" | "30d" | "course";

export interface DashboardFilterInput {
  communityId?: number | null;
  range?: TimeRangeKey;
  /** Custom range — solo si ambos vienen informados; si no, se usa `range`. */
  from?: string | null;
  to?: string | null;
}

export interface DashboardFilterContext {
  communityId: number | null;
  from: Date;
  to: Date;
  rangeLabel: TimeRangeKey | "custom";
}

/**
 * "Curso" (spec §5) — curso académico español: si estamos en agosto o
 * después (mes >= 7, 0-indexed), el curso empezó el 1 de septiembre de este
 * año; si no, empezó el 1 de septiembre del año anterior. Documentado aquí
 * como la única definición — nunca reinventada en un componente.
 */
function courseStart(now: Date): Date {
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 8, 1, 0, 0, 0, 0); // 1 de septiembre
}

export function resolveTimeRange(range: TimeRangeKey, now: Date = new Date()): { from: Date; to: Date } {
  const to = now;
  switch (range) {
    case "today": {
      const from = new Date(now); from.setHours(0, 0, 0, 0);
      return { from, to };
    }
    case "7d": return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to };
    case "30d": return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to };
    case "course": return { from: courseStart(now), to };
  }
}

export function resolveDashboardFilterContext(input: DashboardFilterInput, now: Date = new Date()): DashboardFilterContext {
  if (input.from && input.to) {
    const from = new Date(input.from);
    const to = new Date(input.to);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from < to) {
      return { communityId: input.communityId ?? null, from, to, rangeLabel: "custom" };
    }
  }
  const range = input.range ?? "30d";
  const { from, to } = resolveTimeRange(range, now);
  return { communityId: input.communityId ?? null, from, to, rangeLabel: range };
}

/**
 * Condición SQL "userId pertenece a esta comunidad" — vía user_communities
 * real (nunca inferida). `null` cuando communityId es null (sin filtro —
 * "Todas"), para poder hacer `and(base, communityUserCondition(...) ?? undefined)`.
 */
export function communityUserCondition(userIdColumn: SQL.Aliased | Parameters<typeof inArray>[0], communityId: number | null, db: AnyDbHandle) {
  if (communityId == null) return undefined;
  return inArray(userIdColumn, db.select({ userId: userCommunities.userId }).from(userCommunities).where(eq(userCommunities.communityId, communityId)));
}

/** Condición SQL "venueId pertenece a esta comunidad" — vía community_venues real. */
export function communityVenueCondition(venueIdColumn: Parameters<typeof inArray>[0], communityId: number | null, db: AnyDbHandle) {
  if (communityId == null) return undefined;
  return inArray(venueIdColumn, db.select({ venueId: communityVenues.venueId }).from(communityVenues).where(eq(communityVenues.communityId, communityId)));
}

/** Condición SQL "eventId pertenece a esta comunidad" — vía community_events real. */
export function communityEventCondition(eventIdColumn: Parameters<typeof inArray>[0], communityId: number | null, db: AnyDbHandle) {
  if (communityId == null) return undefined;
  return inArray(eventIdColumn, db.select({ eventId: communityEvents.eventId }).from(communityEvents).where(eq(communityEvents.communityId, communityId)));
}
