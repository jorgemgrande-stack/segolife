/**
 * commandCenterReferrals.ts — SEGOLIFE ADMIN COMMAND CENTER (Fase 14, "solo
 * lo nuevo" tras la Fase 12). Referral BI para el Command Center — spec §17
 * lo marcaba como hueco real en el informe final de la Fase 12 (el motor de
 * Referrals ya existe y funciona, pero nunca se resumía aquí).
 *
 * Auditoría de esta fase: `referralService.ts::getReferralOverview()` ya
 * existe pero hace `SELECT * FROM referrals` completo sin filtro de periodo
 * ni de comunidad (fetch-all-then-reduce-en-JS) — no sirve para un Command
 * Center con filtro global compartido (spec §31 "avoid... full-table
 * scans"). Este módulo lee la MISMA tabla canónica `referrals` con
 * agregación SQL real acotada por `ctx.from`/`ctx.to`/`ctx.communityId` —
 * nunca una segunda verdad de negocio, solo una consulta distinta sobre el
 * mismo hecho.
 *
 * `pendingReconciliation` SÍ reutiliza `findReferralsPendingReconciliation()`
 * tal cual (es un indicador de "ahora mismo", no de un periodo histórico —
 * reejecutarlo con el mismo criterio que ya usa el admin real de Referrals
 * es correcto, no una duplicación).
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { DashboardFilterContext } from "./dashboardFilters";
import { findReferralsPendingReconciliation } from "../referrals/referralService";

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

export interface TopReferrerRow {
  referrerUserId: number;
  name: string | null;
  convertedCount: number;
}

export interface ReferralBiSnapshot {
  registeredInPeriod: number;
  convertedInPeriod: number;
  rewardedInPeriod: number;
  conversionRatePct: number | null;
  tokensIssuedInPeriod: number;
  uniqueInvitersInPeriod: number;
  pendingReconciliation: number;
  topReferrers: TopReferrerRow[];
}

export async function getReferralBi(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<ReferralBiSnapshot> {
  const communityCond = ctx.communityId != null ? sql`AND r.community_id = ${ctx.communityId}` : sql``;

  const [statusResult, tokensResult, topResult, pending] = await Promise.all([
    db.execute(sql`
      SELECT r.status, COUNT(*) AS n, COUNT(DISTINCT r.referrer_user_id) AS inviters
      FROM referrals r
      WHERE r.registered_at >= ${ctx.from} AND r.registered_at < ${ctx.to} ${communityCond}
      GROUP BY r.status
    `),
    // spec §17 — tokensIssued solo cuenta lados con ledger_id real (mismo criterio EXACTO que getReferralOverview, nunca uno distinto).
    db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN r.inviter_ledger_id IS NOT NULL THEN r.inviter_reward_tokens ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN r.invitee_ledger_id IS NOT NULL THEN r.invitee_reward_tokens ELSE 0 END), 0) AS tokens_issued,
        COUNT(DISTINCT r.referrer_user_id) AS unique_inviters
      FROM referrals r
      WHERE r.registered_at >= ${ctx.from} AND r.registered_at < ${ctx.to} ${communityCond}
    `),
    db.execute(sql`
      SELECT r.referrer_user_id AS referrer_user_id, u.name AS name, COUNT(*) AS converted_count
      FROM referrals r
      JOIN users u ON u.id = r.referrer_user_id
      WHERE r.registered_at >= ${ctx.from} AND r.registered_at < ${ctx.to}
        AND r.status IN ('converted', 'rewarded')
        ${communityCond}
      GROUP BY r.referrer_user_id, u.name
      ORDER BY converted_count DESC
      LIMIT 10
    `),
    findReferralsPendingReconciliation(15, db),
  ]);

  const statusRows = rowsOf<{ status: string; n: number | string; inviters: number | string }>(statusResult);
  const byStatus = new Map(statusRows.map(r => [r.status, Number(r.n)]));
  const registeredInPeriod = statusRows.reduce((sum, r) => sum + Number(r.n), 0);
  const rewardedInPeriod = byStatus.get("rewarded") ?? 0;
  const convertedInPeriod = (byStatus.get("converted") ?? 0) + rewardedInPeriod;

  const tokensRow = rowsOf<{ tokens_issued: number | string; unique_inviters: number | string }>(tokensResult)[0];
  const tokensIssuedInPeriod = Number(tokensRow?.tokens_issued ?? 0);
  const uniqueInvitersInPeriod = Number(tokensRow?.unique_inviters ?? 0);

  const topReferrers = rowsOf<{ referrer_user_id: number; name: string | null; converted_count: number | string }>(topResult)
    .map(r => ({ referrerUserId: Number(r.referrer_user_id), name: r.name, convertedCount: Number(r.converted_count) }));

  return {
    registeredInPeriod,
    convertedInPeriod,
    rewardedInPeriod,
    conversionRatePct: registeredInPeriod > 0 ? Math.round((convertedInPeriod / registeredInPeriod) * 1000) / 10 : null,
    tokensIssuedInPeriod,
    uniqueInvitersInPeriod,
    pendingReconciliation: pending.length,
    topReferrers,
  };
}
