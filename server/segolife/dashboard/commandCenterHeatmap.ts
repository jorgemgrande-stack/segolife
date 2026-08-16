/**
 * commandCenterHeatmap.ts — SEGOLIFE ADMIN COMMAND CENTER (Fase 14, "solo lo
 * nuevo" tras la Fase 12). Actividad por hora/día de semana (spec §16) —
 * asistencia y ventas.
 *
 * ZONA HORARIA (spec §5, "use nightlife operational semantics"): auditoría
 * de esta fase confirmó que NO existe ninguna función SQL de conversión de
 * huso horario ya probada en este repo (CONVERT_TZ depende de que el MySQL
 * de producción tenga cargadas las tablas de zonas horarias, algo no
 * verificado y frágil de asumir). En vez de inventar una conversión SQL
 * nueva, se reutiliza `resolveMadridMoment()` (tokenScheduleService.ts, ya
 * DST-safe y probado desde la Fase 6) sobre las filas YA acotadas por el
 * rango de fechas del filtro — nunca un escaneo sin límite: el propio
 * `ctx.from`/`ctx.to` acota la consulta, más un `LIMIT` defensivo explícito
 * para proteger de un futuro pico de volumen (spec §31).
 *
 * Solo se devuelven CONTEOS agregados por hora/día (spec §34 privacidad) —
 * nunca las filas individuales ni ningún identificador de Student.
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { DashboardFilterContext } from "./dashboardFilters";
import { resolveMadridMoment } from "../tokens/tokenScheduleService";

const ROW_LIMIT = 5000;
const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export interface HourBucket { hour: number; count: number }
export interface WeekdayBucket { weekday: number; label: string; count: number }

export interface HeatmapSeries {
  byHour: HourBucket[];
  byWeekday: WeekdayBucket[];
  sampleSize: number;
  truncated: boolean;
}

export interface HeatmapSnapshot {
  attendance: HeatmapSeries;
  commerce: HeatmapSeries;
}

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

function bucketTimestamps(timestamps: Date[]): { byHour: HourBucket[]; byWeekday: WeekdayBucket[] } {
  const hourCounts = new Array(24).fill(0);
  const weekdayCounts = new Array(7).fill(0);
  for (const ts of timestamps) {
    const moment = resolveMadridMoment(ts);
    const hour = Number(moment.time.split(":")[0]);
    hourCounts[hour]++;
    weekdayCounts[moment.dayOfWeek]++;
  }
  return {
    byHour: hourCounts.map((count, hour) => ({ hour, count })),
    byWeekday: weekdayCounts.map((count, weekday) => ({ weekday, label: WEEKDAY_LABELS[weekday], count })),
  };
}

async function fetchSeries(table: "event_attendance" | "commerce_transactions", timestampColumn: string, ctx: DashboardFilterContext, db: AnyDbHandle): Promise<HeatmapSeries> {
  const communityFilter = ctx.communityId != null
    ? sql`AND user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${ctx.communityId})`
    : sql``;
  const statusFilter = table === "commerce_transactions" ? sql`AND status IN ('confirmed', 'refunded', 'partially_refunded')` : sql``;

  const result = await db.execute(sql`
    SELECT ${sql.raw(timestampColumn)} AS ts FROM ${sql.raw(table)}
    WHERE ${sql.raw(timestampColumn)} >= ${ctx.from} AND ${sql.raw(timestampColumn)} < ${ctx.to}
    ${statusFilter} ${communityFilter}
    LIMIT ${ROW_LIMIT + 1}
  `);
  const rows = rowsOf<{ ts: string | Date }>(result);
  const truncated = rows.length > ROW_LIMIT;
  const bounded = truncated ? rows.slice(0, ROW_LIMIT) : rows;
  const timestamps = bounded.map(r => (r.ts instanceof Date ? r.ts : new Date(r.ts)));
  const { byHour, byWeekday } = bucketTimestamps(timestamps);

  return { byHour, byWeekday, sampleSize: bounded.length, truncated };
}

export async function getHeatmapSnapshot(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<HeatmapSnapshot> {
  const [attendance, commerce] = await Promise.all([
    fetchSeries("event_attendance", "occurred_at", ctx, db),
    fetchSeries("commerce_transactions", "occurred_at", ctx, db),
  ]);
  return { attendance, commerce };
}
