/**
 * economyOverviewService.ts — SEGOLIFE SEGOTOKENS ECONOMY & REWARD POLICY.
 * Extiende el Overview existente (tokens.dashboardSummary) con lo que pedía
 * esta fase: estado de Shadow, emitidos hoy/7d/30d, Students activos con
 * tokens, valor promocional estimado, top regla/venue, reversiones.
 *
 * REUSE FIRST: top regla/venue reutiliza `getLoyaltyEconomy()` (ya existe
 * en el Command Center) en vez de reimplementar la misma agregación.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql, eq } from "drizzle-orm";
import { systemSettings } from "../../../drizzle/schema";
import type { AnyDbHandle } from "./tokenLedgerService";
import { getLoyaltyEconomy } from "../dashboard/commandCenterLoyalty";
import { isShadowEnabled } from "./loyaltyShadowService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

export interface EconomyOverviewExtras {
  shadowEnabled: boolean;
  issuedToday: number;
  issued7d: number;
  issued30d: number;
  activeStudentsWithTokens: number;
  estimatedTokenValueCents: number;
  topEarningRule: { ruleId: number | null; ruleName: string; totalEarned: number } | null;
  topVenue: { venueId: number; venueName: string; earned: number } | null;
  reversalsCount: number;
}

/** Ventana de 30 días para top regla/venue — misma escala que el resto del Command Center, suficiente con el volumen real actual. */
export async function getEconomyOverviewExtras(db?: AnyDbHandle, now: Date = new Date()): Promise<EconomyOverviewExtras> {
  const conn = db ?? _db;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [periodResult, activeWalletsResult, reversalsResult, valueRows, thirtyDayEconomy, shadowEnabled] = await Promise.all([
    conn.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'credit' AND created_at >= ${dayStart} THEN amount ELSE 0 END), 0) AS today,
        COALESCE(SUM(CASE WHEN direction = 'credit' AND created_at >= ${sevenDaysAgo} THEN amount ELSE 0 END), 0) AS d7,
        COALESCE(SUM(CASE WHEN direction = 'credit' AND created_at >= ${thirtyDaysAgo} THEN amount ELSE 0 END), 0) AS d30
      FROM token_ledger
    `),
    conn.execute(sql`SELECT COUNT(*) AS n FROM token_wallets WHERE balance > 0`),
    conn.execute(sql`SELECT COUNT(*) AS n FROM token_ledger WHERE source_type = 'reversal'`),
    conn.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, "estimated_token_value_cents")).limit(1),
    getLoyaltyEconomy({ communityId: null, from: thirtyDaysAgo, to: now, rangeLabel: "custom" }, conn),
    isShadowEnabled(),
  ]);

  const period = rowsOf<{ today: number | string; d7: number | string; d30: number | string }>(periodResult)[0] ?? { today: 0, d7: 0, d30: 0 };
  const activeStudentsWithTokens = Number(rowsOf<{ n: number | string }>(activeWalletsResult)[0]?.n ?? 0);
  const reversalsCount = Number(rowsOf<{ n: number | string }>(reversalsResult)[0]?.n ?? 0);
  // ESTIMATED PROMOTIONAL VALUE — nunca cash value (spec §9). Default 2 (€0.02) si el setting todavía no existe.
  const estimatedTokenValueCents = Number(valueRows[0]?.value ?? 2);

  const topRule = thirtyDayEconomy.topEarningRules[0] ?? null;
  const topVenueSorted = thirtyDayEconomy.tokensByVenue.slice().sort((a, b) => b.earned - a.earned);
  const topVenue = topVenueSorted[0] ?? null;

  return {
    shadowEnabled,
    issuedToday: Number(period.today), issued7d: Number(period.d7), issued30d: Number(period.d30),
    activeStudentsWithTokens,
    estimatedTokenValueCents,
    topEarningRule: topRule ? { ruleId: topRule.ruleId, ruleName: topRule.ruleName, totalEarned: topRule.totalEarned } : null,
    topVenue: topVenue ? { venueId: topVenue.venueId, venueName: topVenue.venueName, earned: topVenue.earned } : null,
    reversalsCount,
  };
}
