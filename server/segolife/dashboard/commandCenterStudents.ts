/**
 * commandCenterStudents.ts — SEGOLIFE ADMIN COMMAND CENTER.
 * `dashboard.getCommunityPulse` (segmentos), `dashboard.getHistoricalAudience`,
 * `dashboard.getCrossVenue` (spec §10, §15, §16).
 *
 * STUDENT INTELLIGENCE (spec §10): reutiliza los MISMOS umbrales que
 * `studentIntelligenceService.computeSegment()` (importados, nunca
 * reescritos con otro número) — pero recalculados como AGREGADO SQL
 * poblacional en vez de invocar `computeSegment()` por Student (ese motor es
 * puro/per-student con un fan-out de 8 queries por invocación —
 * `students360.ts getSummary` — llamarlo en bucle sobre 10k Students serían
 * 80.000 queries). La actividad usada aquí es la MISMA fuente única de
 * "actividad genuina" que activitySignals.ts (spec §1.2) — más estricta que
 * el timeline completo de Student 360 (que sí incluye notificaciones), y
 * por tanto MÁS correcta para esta clasificación, no una aproximación.
 *
 * Sin REACTIVATED (spec §1.3, decisión cerrada). MULTI-VENUE es una
 * dimensión aparte, no mutuamente excluyente con el resto (spec §10).
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import {
  NEW_STUDENT_GRACE_DAYS, FREQUENCY_WINDOW_DAYS, FREQUENCY_TARGET_EVENTS,
  COMMERCE_TARGET_CENTS, LOYALTY_TARGET_ACTIONS, DORMANT_THRESHOLD_DAYS, AT_RISK_THRESHOLD_DAYS,
} from "../students/studentIntelligenceService";
import { getHistoricalIdentityStats, type HistoricalIdentityStats } from "../students/historicalIdentityService";
import { lastActivityByStudent, activityCountByStudentSince, distinctVenuesByStudent } from "./activitySignals";

export type StudentSegmentKey = "new" | "active" | "highly_engaged" | "at_risk" | "dormant" | "high_spend";

export interface StudentSegmentStats {
  key: StudentSegmentKey;
  label: string;
  count: number;
  populationPct: number;
}

export interface StudentIntelligenceSnapshot {
  totalStudents: number;
  segments: StudentSegmentStats[];
  multiVenue: { count: number; populationPct: number; avgVenuesPerActiveStudent: number | null };
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export async function getStudentIntelligence(communityId: number | null, db: AnyDbHandle, now: Date = new Date()): Promise<StudentIntelligenceSnapshot> {
  const communityJoin = communityId != null ? sql`AND uc.community_id = ${communityId}` : sql``;
  const studentRowsResult = await db.execute(sql`
    SELECT u.id AS user_id, u.created_at AS created_at, w.lifetime_earned AS tokens_lifetime_earned
    FROM users u
    JOIN student_profiles sp ON sp.user_id = u.id
    ${communityId != null ? sql`JOIN user_communities uc ON uc.user_id = u.id` : sql``}
    LEFT JOIN token_wallets w ON w.user_id = u.id
    WHERE 1=1 ${communityJoin}
  `);
  const studentRows = (studentRowsResult as unknown as [Array<{ user_id: number; created_at: string | Date; tokens_lifetime_earned: number | null }>])[0] ?? [];

  const spendResult = await db.execute(sql`
    SELECT user_id, SUM(cents) AS total FROM (
      SELECT user_id, total_cents AS cents FROM ticket_orders WHERE status = 'paid' AND user_id IS NOT NULL
      UNION ALL
      SELECT user_id, total_cents AS cents FROM commerce_transactions WHERE status = 'confirmed' AND user_id IS NOT NULL
    ) spend GROUP BY user_id
  `);
  const spendRows = (spendResult as unknown as [Array<{ user_id: number; total: number | string }>])[0] ?? [];
  const spendByStudent = new Map<number, number>(spendRows.map(r => [Number(r.user_id), Number(r.total)]));

  const [lastActivityMap, frequencyMap, venuesMap] = await Promise.all([
    lastActivityByStudent(db),
    activityCountByStudentSince(new Date(now.getTime() - FREQUENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000), now, db),
    distinctVenuesByStudent(db),
  ]);

  const counts: Record<StudentSegmentKey, number> = { new: 0, active: 0, highly_engaged: 0, at_risk: 0, dormant: 0, high_spend: 0 };
  let multiVenueCount = 0;
  let activeStudentsWithVenueData = 0;
  let venueSum = 0;

  for (const row of studentRows) {
    const userId = Number(row.user_id);
    const registeredAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
    const daysSinceRegistration = daysBetween(registeredAt, now);
    const lastActivity = lastActivityMap.get(userId) ?? null;
    const daysSinceActivity = lastActivity ? daysBetween(lastActivity, now) : null;
    const frequencyCount = frequencyMap.get(userId) ?? 0;
    const totalSpendCents = spendByStudent.get(userId) ?? 0;
    const tokensLifetimeEarned = Number(row.tokens_lifetime_earned ?? 0);
    const venues = venuesMap.get(userId) ?? 0;

    if (venues > 0) { activeStudentsWithVenueData++; venueSum += venues; }
    if (venues >= 2) multiVenueCount++;

    // Mismas reglas y prioridad EXACTAS que studentIntelligenceService.computeSegment().
    if (daysSinceRegistration < NEW_STUDENT_GRACE_DAYS) { counts.new++; continue; }
    if (daysSinceActivity === null || daysSinceActivity > DORMANT_THRESHOLD_DAYS) { counts.dormant++; continue; }
    if (daysSinceActivity > AT_RISK_THRESHOLD_DAYS) { counts.at_risk++; continue; }

    const isHighSpend = totalSpendCents >= COMMERCE_TARGET_CENTS * 2 || tokensLifetimeEarned >= LOYALTY_TARGET_ACTIONS * 20;
    if (isHighSpend && daysSinceActivity <= AT_RISK_THRESHOLD_DAYS) { counts.high_spend++; continue; }
    if (frequencyCount >= FREQUENCY_TARGET_EVENTS && daysSinceActivity <= 14) { counts.highly_engaged++; continue; }
    counts.active++;
  }

  const total = studentRows.length;
  const labels: Record<StudentSegmentKey, string> = {
    new: "Nuevo", active: "Activo", highly_engaged: "Muy comprometido", at_risk: "En riesgo", dormant: "Dormido", high_spend: "Alto gasto",
  };
  const segments = (Object.keys(counts) as StudentSegmentKey[]).map(key => ({
    key, label: labels[key], count: counts[key],
    populationPct: total > 0 ? Math.round((counts[key] / total) * 1000) / 10 : 0,
  }));

  return {
    totalStudents: total,
    segments,
    multiVenue: {
      count: multiVenueCount,
      populationPct: total > 0 ? Math.round((multiVenueCount / total) * 1000) / 10 : 0,
      avgVenuesPerActiveStudent: activeStudentsWithVenueData > 0 ? Math.round((venueSum / activeStudentsWithVenueData) * 10) / 10 : null,
    },
  };
}

export async function getHistoricalAudience(db: AnyDbHandle): Promise<HistoricalIdentityStats> {
  return getHistoricalIdentityStats(db as never);
}

export interface CrossVenueSnapshot {
  registered: { singleVenue: number; multiVenue: number; avgVenuesPerPerson: number | null; multiVenuePct: number };
  historical: { total: number; crossVenue: number; crossVenuePct: number };
}

/** Poblaciones SEPARADAS a propósito (spec §16) — Registered Students y Historical Audience nunca se suman como si fueran personas distintas cuando puede haber overlap vía claim. */
export async function getCrossVenueIntelligence(db: AnyDbHandle): Promise<CrossVenueSnapshot> {
  const [venuesMap, historicalStats] = await Promise.all([
    distinctVenuesByStudent(db),
    getHistoricalIdentityStats(db as never),
  ]);
  let singleVenue = 0, multiVenue = 0, sum = 0, withData = 0;
  for (const v of Array.from(venuesMap.values())) {
    if (v <= 0) continue;
    withData++; sum += v;
    if (v >= 2) multiVenue++; else singleVenue++;
  }
  const total = singleVenue + multiVenue;
  return {
    registered: {
      singleVenue, multiVenue,
      avgVenuesPerPerson: withData > 0 ? Math.round((sum / withData) * 10) / 10 : null,
      multiVenuePct: total > 0 ? Math.round((multiVenue / total) * 1000) / 10 : 0,
    },
    historical: {
      total: historicalStats.total,
      crossVenue: historicalStats.crossVenue,
      crossVenuePct: historicalStats.total > 0 ? Math.round((historicalStats.crossVenue / historicalStats.total) * 1000) / 10 : 0,
    },
  };
}
