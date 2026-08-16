/**
 * commandCenterRetention.ts — SEGOLIFE ADMIN COMMAND CENTER (Fase 14, "solo
 * lo nuevo" tras la Fase 12). Retención/recurrencia real (spec §15):
 * primera vez vs recurrente, frecuencia de visita, multi-venue.
 *
 * FUENTE: unión de `venue_visits` (visita sin evento, día operativo YA
 * calculado y persistido en `operational_date`) y `event_attendance`
 * (asistencia CON evento). Auditoría de esta fase confirmó que son
 * mutuamente excluyentes por construcción (unifiedCheckinService.ts solo
 * escribe en `venue_visits` cuando no hay evento vigente que resolver) —
 * unirlas es la única forma de obtener "toda la actividad real de un
 * Student en un venue", ya que ninguna de las dos por separado lo cubre.
 *
 * LÍMITE DOCUMENTADO (spec §5, honestidad explícita): `venue_visits` ya
 * trae `operational_date` con el corte real de 06:00 Europe/Madrid,
 * DST-safe (`resolveOperationalDate`). `event_attendance` NO tiene esa
 * columna — aquí se aproxima con un desplazamiento fijo de 6h en UTC
 * (`DATE(occurred_at - INTERVAL 6 HOUR)`), que difiere del cálculo exacto
 * en Madrid-local solo durante las ~2 noches al año de cambio de horario
 * (máximo 1h de imprecisión en el límite, nunca en el resto del año) —
 * aceptable para una métrica de recurrencia a escala de semana/mes; NO se
 * usa esta aproximación en ningún KPI de "hoy" (esos ya usan el corte
 * exacto vía `dashboardFilters.ts`).
 *
 * "Recurrente semanal" (spec §15): cuando el filtro activo es range=7d,
 * `returningInPeriod` de esta misma función YA responde exactamente esa
 * pregunta ("de los activos esta semana, cuántos tenían actividad previa a
 * esta semana") — no se construye una métrica paralela solo para el grano
 * semanal (spec §15 "avoid... unless objectively necessary").
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { DashboardFilterContext } from "./dashboardFilters";

export interface RetentionSnapshot {
  activeStudents: number;
  firstTimeInPeriod: number;
  returningInPeriod: number;
  returningRatePct: number | null;
  avgActiveDaysPerStudent: number | null;
  multiVenueStudents: number;
}

function firstRow<T>(result: unknown): T | undefined {
  return ((result as unknown as [T[]])[0] ?? [])[0];
}

export async function getRetentionSnapshot(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<RetentionSnapshot> {
  const communityFilter = ctx.communityId != null
    ? sql`AND user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${ctx.communityId})`
    : sql``;

  const result = await db.execute(sql`
    WITH combined_activity AS (
      SELECT user_id, venue_id, occurred_at, operational_date FROM venue_visits
      UNION ALL
      SELECT user_id, venue_id, occurred_at, DATE(DATE_SUB(occurred_at, INTERVAL 6 HOUR)) AS operational_date FROM event_attendance
    ),
    scoped AS (
      SELECT * FROM combined_activity WHERE 1=1 ${communityFilter}
    ),
    per_user AS (
      SELECT
        user_id,
        MIN(occurred_at) AS first_activity_ever,
        COUNT(DISTINCT CASE WHEN occurred_at >= ${ctx.from} AND occurred_at < ${ctx.to} THEN operational_date END) AS active_days_in_period,
        COUNT(DISTINCT CASE WHEN occurred_at >= ${ctx.from} AND occurred_at < ${ctx.to} THEN venue_id END) AS distinct_venues_in_period
      FROM scoped
      GROUP BY user_id
    )
    SELECT
      SUM(CASE WHEN active_days_in_period > 0 THEN 1 ELSE 0 END) AS active_students,
      SUM(CASE WHEN active_days_in_period > 0 AND first_activity_ever >= ${ctx.from} THEN 1 ELSE 0 END) AS first_time,
      SUM(CASE WHEN active_days_in_period > 0 AND first_activity_ever < ${ctx.from} THEN 1 ELSE 0 END) AS returning,
      SUM(CASE WHEN active_days_in_period > 0 THEN active_days_in_period ELSE 0 END) AS total_active_days,
      SUM(CASE WHEN distinct_venues_in_period >= 2 THEN 1 ELSE 0 END) AS multi_venue_students
    FROM per_user
  `);

  const row = firstRow<{
    active_students: number | string | null; first_time: number | string | null; returning: number | string | null;
    total_active_days: number | string | null; multi_venue_students: number | string | null;
  }>(result);

  const activeStudents = Number(row?.active_students ?? 0);
  const firstTimeInPeriod = Number(row?.first_time ?? 0);
  const returningInPeriod = Number(row?.returning ?? 0);
  const totalActiveDays = Number(row?.total_active_days ?? 0);

  return {
    activeStudents,
    firstTimeInPeriod,
    returningInPeriod,
    returningRatePct: activeStudents > 0 ? Math.round((returningInPeriod / activeStudents) * 1000) / 10 : null,
    avgActiveDaysPerStudent: activeStudents > 0 ? Math.round((totalActiveDays / activeStudents) * 10) / 10 : null,
    multiVenueStudents: Number(row?.multi_venue_students ?? 0),
  };
}
