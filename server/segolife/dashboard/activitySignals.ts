/**
 * activitySignals.ts — SEGOLIFE ADMIN COMMAND CENTER (spec §1.2). Fuente
 * ÚNICA de "actividad genuina" — usada por Active Students (KPI strip) y
 * Community Pulse (DAU/WAU/MAU). Nunca se redefine en otro sitio.
 *
 * SEÑALES QUE CUENTAN (spec §1.2, exhaustivo): login, compra de ticket
 * (pedido pagado), asistencia, consumo POS, consumo QR, earning/spending
 * real de SegoTokens, uso/canje de Benefit, respuesta a Plan & Play,
 * apoyo a propuesta, propuesta de estudiante enviada.
 *
 * SEÑALES QUE NUNCA CUENTAN POR SÍ SOLAS (spec §1.2, explícito): notificación
 * leída/clicada, status manual de student_profiles. Por eso este módulo NO
 * lee `notifications` ni `student_profiles.status` — a propósito, no un
 * olvido.
 *
 * DEDUPLICACIÓN: un Student con 20 señales en el periodo cuenta una sola
 * vez — todo aquí se agrega vía `COUNT(DISTINCT user_id)`/`GROUP BY
 * user_id`, nunca sumando eventos como si fueran personas.
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";

/**
 * UNION ALL de las 10 tablas fuente (9 tipos de señal del spec + login vía
 * student_login_events, que es la única fuente real de HISTORIAL de login —
 * users.last_signed_in es un único valor mutable, no sirve para "¿tuvo al
 * menos un login en este rango pasado?" salvo que sea el rango más reciente).
 * Cada rama proyecta exactamente (user_id, occurred_at) — mismo shape.
 */
const ACTIVITY_UNION_SQL = sql`(
  SELECT user_id, purchased_at AS occurred_at FROM ticket_orders WHERE status = 'paid' AND user_id IS NOT NULL AND purchased_at IS NOT NULL
  UNION ALL
  SELECT user_id, occurred_at FROM event_attendance
  UNION ALL
  SELECT user_id, occurred_at FROM commerce_transactions WHERE status = 'confirmed' AND user_id IS NOT NULL
  UNION ALL
  SELECT redeemed_by_user_id AS user_id, redeemed_at AS occurred_at FROM consumption_qr_codes WHERE status = 'redeemed' AND redeemed_by_user_id IS NOT NULL AND redeemed_at IS NOT NULL
  UNION ALL
  SELECT user_id, created_at AS occurred_at FROM token_ledger
  UNION ALL
  SELECT user_id, used_at AS occurred_at FROM user_benefits WHERE used_at IS NOT NULL
  UNION ALL
  SELECT user_id, responded_at AS occurred_at FROM community_responses
  UNION ALL
  SELECT user_id, created_at AS occurred_at FROM community_supports
  UNION ALL
  SELECT student_user_id AS user_id, created_at AS occurred_at FROM community_student_proposals
  UNION ALL
  SELECT user_id, occurred_at FROM student_login_events
) activity_signals`;

export interface ActiveStudentsCount {
  activeCount: number;
}

/** COUNT(DISTINCT user_id) de estudiantes con al menos una señal genuina en [from, to). Filtro de comunidad real vía user_communities. */
export async function countActiveStudents(from: Date, to: Date, communityId: number | null, db: AnyDbHandle): Promise<number> {
  const communityJoin = communityId != null
    ? sql`JOIN user_communities uc ON uc.user_id = activity_signals.user_id AND uc.community_id = ${communityId}`
    : sql``;
  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT activity_signals.user_id) AS cnt
    FROM ${ACTIVITY_UNION_SQL}
    ${communityJoin}
    WHERE activity_signals.occurred_at >= ${from} AND activity_signals.occurred_at < ${to}
  `);
  const rows = (result as unknown as [Array<{ cnt: number | string }>])[0];
  const cnt = rows?.[0]?.cnt;
  return cnt != null ? Number(cnt) : 0;
}

export interface DailyActiveStudents {
  /** "YYYY-MM-DD" en zona del servidor — consistente con el resto del repo (sin abstracción de timezone dedicada). */
  date: string;
  activeCount: number;
}

/** Serie diaria de Students activos únicos — para el gráfico de Community Pulse. Un Student con 2 señales el mismo día cuenta 1 vez ESE día. */
export async function dailyActiveStudents(from: Date, to: Date, communityId: number | null, db: AnyDbHandle): Promise<DailyActiveStudents[]> {
  const communityJoin = communityId != null
    ? sql`JOIN user_communities uc ON uc.user_id = activity_signals.user_id AND uc.community_id = ${communityId}`
    : sql``;
  const result = await db.execute(sql`
    SELECT DATE(activity_signals.occurred_at) AS day, COUNT(DISTINCT activity_signals.user_id) AS cnt
    FROM ${ACTIVITY_UNION_SQL}
    ${communityJoin}
    WHERE activity_signals.occurred_at >= ${from} AND activity_signals.occurred_at < ${to}
    GROUP BY DATE(activity_signals.occurred_at)
    ORDER BY day ASC
  `);
  const rows = (result as unknown as [Array<{ day: string | Date; cnt: number | string }>])[0] ?? [];
  return rows.map(r => ({ date: typeof r.day === "string" ? r.day : new Date(r.day).toISOString().slice(0, 10), activeCount: Number(r.cnt) }));
}

/**
 * Última señal genuina de cada Student (independiente de comunidad) —
 * usado por Student Intelligence para clasificar segmentos vía agregado SQL
 * (spec §10: sin fan-out N+1). Devuelve solo estudiantes con AL MENOS una señal.
 */
export async function lastActivityByStudent(db: AnyDbHandle): Promise<Map<number, Date>> {
  const result = await db.execute(sql`
    SELECT user_id, MAX(occurred_at) AS last_at
    FROM ${ACTIVITY_UNION_SQL}
    WHERE user_id IS NOT NULL
    GROUP BY user_id
  `);
  const rows = (result as unknown as [Array<{ user_id: number; last_at: string | Date }>])[0] ?? [];
  const map = new Map<number, Date>();
  for (const r of rows) map.set(Number(r.user_id), new Date(r.last_at));
  return map;
}

/** Nº de señales genuinas por Student en la ventana [since, at) — usado para "frequency" (spec §10, mismo criterio que FREQUENCY_TARGET_EVENTS). */
export async function activityCountByStudentSince(since: Date, at: Date, db: AnyDbHandle): Promise<Map<number, number>> {
  const result = await db.execute(sql`
    SELECT user_id, COUNT(*) AS cnt
    FROM ${ACTIVITY_UNION_SQL}
    WHERE user_id IS NOT NULL AND occurred_at >= ${since} AND occurred_at < ${at}
    GROUP BY user_id
  `);
  const rows = (result as unknown as [Array<{ user_id: number; cnt: number | string }>])[0] ?? [];
  const map = new Map<number, number>();
  for (const r of rows) map.set(Number(r.user_id), Number(r.cnt));
  return map;
}

/** Nº de venues distintos con actividad genuina por Student — para MULTI-VENUE (spec §10, §16). */
export async function distinctVenuesByStudent(db: AnyDbHandle): Promise<Map<number, number>> {
  // Solo las señales con venue_id real (ticket_orders no tiene venue_id directo — se resuelve vía event→venue en el módulo llamador si hace falta; aquí solo las fuentes con venue_id propio).
  const result = await db.execute(sql`
    SELECT user_id, COUNT(DISTINCT venue_id) AS cnt FROM (
      SELECT user_id, venue_id FROM event_attendance WHERE venue_id IS NOT NULL
      UNION ALL
      SELECT user_id, venue_id FROM commerce_transactions WHERE venue_id IS NOT NULL AND user_id IS NOT NULL
      UNION ALL
      SELECT redeemed_by_user_id AS user_id, venue_id FROM consumption_qr_codes WHERE venue_id IS NOT NULL AND redeemed_by_user_id IS NOT NULL
    ) venue_signals
    GROUP BY user_id
  `);
  const rows = (result as unknown as [Array<{ user_id: number; cnt: number | string }>])[0] ?? [];
  const map = new Map<number, number>();
  for (const r of rows) map.set(Number(r.user_id), Number(r.cnt));
  return map;
}

/**
 * Students activos únicos por venue en [from, to) — para Venue Performance
 * (spec §14). Misma fuente de "venue real" que `distinctVenuesByStudent`
 * (event_attendance/commerce_transactions/consumption_qr_codes, todas con
 * venue_id propio) más ticket_orders resuelto vía events→venue_id (los
 * pedidos de ticket no tienen venue_id directo). Un Student con actividad en
 * 2 venues del periodo cuenta en AMBOS (venue-scoped, no exclusivo).
 */
export async function activeStudentsByVenue(from: Date, to: Date, communityId: number | null, db: AnyDbHandle): Promise<Map<number, number>> {
  const communityJoin = communityId != null
    ? sql`AND venue_activity.user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${communityId})`
    : sql``;
  const result = await db.execute(sql`
    SELECT venue_activity.venue_id AS venue_id, COUNT(DISTINCT venue_activity.user_id) AS cnt FROM (
      SELECT o.user_id AS user_id, e.venue_id AS venue_id FROM ticket_orders o
        JOIN events e ON e.id = o.event_id
        WHERE o.status = 'paid' AND o.user_id IS NOT NULL AND e.venue_id IS NOT NULL AND o.purchased_at >= ${from} AND o.purchased_at < ${to}
      UNION ALL
      SELECT user_id, venue_id FROM event_attendance WHERE venue_id IS NOT NULL AND occurred_at >= ${from} AND occurred_at < ${to}
      UNION ALL
      SELECT user_id, venue_id FROM commerce_transactions WHERE status = 'confirmed' AND venue_id IS NOT NULL AND user_id IS NOT NULL AND occurred_at >= ${from} AND occurred_at < ${to}
      UNION ALL
      SELECT redeemed_by_user_id AS user_id, venue_id FROM consumption_qr_codes WHERE status = 'redeemed' AND venue_id IS NOT NULL AND redeemed_by_user_id IS NOT NULL AND redeemed_at >= ${from} AND redeemed_at < ${to}
    ) venue_activity
    WHERE 1=1 ${communityJoin}
    GROUP BY venue_activity.venue_id
  `);
  const rows = (result as unknown as [Array<{ venue_id: number; cnt: number | string }>])[0] ?? [];
  const map = new Map<number, number>();
  for (const r of rows) map.set(Number(r.venue_id), Number(r.cnt));
  return map;
}
