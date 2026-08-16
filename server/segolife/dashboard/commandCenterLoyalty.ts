/**
 * commandCenterLoyalty.ts — SEGOLIFE ADMIN COMMAND CENTER. `dashboard.getLoyalty`
 * (SegoTokens Economy, spec §19) y `dashboard.getBenefits` (Benefits
 * Performance, spec §20).
 *
 * LOYALTY READ-ONLY (spec §36, absoluto): este módulo NUNCA llama
 * `earnTokens`/`evaluateReward`/ninguna función de escritura del motor de
 * loyalty — solo LEE `token_ledger`/`token_wallets` ya materializados.
 * `liveStatus` refleja `tokenEngine.ts:LIVE_LOYALTY_ENABLED` (SegoTokens
 * Live Activation, spec §19/§26) — antes era un literal "LIVE_LOCKED" fijo,
 * cuando esa constante todavía no protegía nada real (ver hallazgo
 * documentado junto a LIVE_LOYALTY_ENABLED). Seguir leyendo esta constante
 * (nunca `venue_integrations.loyaltyEnabled` por separado) NO viola
 * "read-only": es una simple lectura de un valor en memoria, igual que
 * antes, solo que ahora responde lo que es cierto.
 *
 * Nunca se inventa un KPI de "tokens expirando" (spec §19 — no existe
 * `expires_at` en `token_ledger`/`token_wallets`, confirmado en auditoría
 * previa).
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { DashboardFilterContext } from "./dashboardFilters";
import { LIVE_LOYALTY_ENABLED } from "../tokens/tokenEngine";

const EXPIRING_SOON_HOURS = 48;
const TOP_N = 10;

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

export interface TokenRuleBreakdown {
  ruleId: number | null;
  ruleName: string;
  totalEarned: number;
}
export interface VenueTokenBreakdown {
  venueId: number;
  venueName: string;
  earned: number;
  spent: number;
}
export interface EventTokenBreakdown {
  eventId: number;
  eventName: string;
  earned: number;
  spent: number;
}
/** Fase 12 (spec §17/§22): "¿qué acciones generan más ST?" — GROUP BY sobre `token_ledger.source_type` real, nunca sobre la config de reglas (economyGovernanceService.ORIGIN_LABELS solo etiqueta, nunca agrega histórico). */
export interface OriginTokenBreakdown {
  origin: string;
  earned: number;
  spent: number;
}

export interface LoyaltyEconomySnapshot {
  liveStatus: "LIVE_ACTIVE" | "LIVE_LOCKED";
  earnedInPeriod: number;
  spentInPeriod: number;
  circulatingBalance: number;
  activeWallets: number;
  avgBalance: number | null;
  topEarningRules: TokenRuleBreakdown[];
  tokensByVenue: VenueTokenBreakdown[];
  tokensByEvent: EventTokenBreakdown[];
  tokensByOrigin: OriginTokenBreakdown[];
}

export async function getLoyaltyEconomy(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<LoyaltyEconomySnapshot> {
  const ledgerCommunityCond = ctx.communityId != null ? sql`AND tl.user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${ctx.communityId})` : sql``;
  const walletCommunityCond = ctx.communityId != null ? sql`AND w.user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${ctx.communityId})` : sql``;

  const [movementResult, walletResult, rulesResult, venueResult, eventResult, originResult] = await Promise.all([
    db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS earned,
        COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0) AS spent
      FROM token_ledger tl WHERE tl.created_at >= ${ctx.from} AND tl.created_at < ${ctx.to} ${ledgerCommunityCond}
    `),
    db.execute(sql`
      SELECT COUNT(*) AS active_wallets, COALESCE(SUM(w.balance), 0) AS circulating, COALESCE(AVG(w.balance), 0) AS avg_balance
      FROM token_wallets w WHERE w.balance > 0 ${walletCommunityCond}
    `),
    db.execute(sql`
      SELECT tl.rule_id AS rule_id, COALESCE(tr.name, 'Sin regla asociada (manual)') AS rule_name, SUM(tl.amount) AS total
      FROM token_ledger tl LEFT JOIN token_rules tr ON tr.id = tl.rule_id
      WHERE tl.direction = 'credit' AND tl.created_at >= ${ctx.from} AND tl.created_at < ${ctx.to} ${ledgerCommunityCond}
      GROUP BY tl.rule_id, tr.name
      ORDER BY total DESC
      LIMIT ${TOP_N}
    `),
    db.execute(sql`
      SELECT tl.venue_id AS venue_id, v.name AS venue_name,
        COALESCE(SUM(CASE WHEN tl.direction = 'credit' THEN tl.amount ELSE 0 END), 0) AS earned,
        COALESCE(SUM(CASE WHEN tl.direction = 'debit' THEN tl.amount ELSE 0 END), 0) AS spent
      FROM token_ledger tl JOIN venues v ON v.id = tl.venue_id
      WHERE tl.venue_id IS NOT NULL AND tl.created_at >= ${ctx.from} AND tl.created_at < ${ctx.to} ${ledgerCommunityCond}
      GROUP BY tl.venue_id, v.name
      ORDER BY earned DESC
    `),
    db.execute(sql`
      SELECT tl.event_id AS event_id, e.name AS event_name,
        COALESCE(SUM(CASE WHEN tl.direction = 'credit' THEN tl.amount ELSE 0 END), 0) AS earned,
        COALESCE(SUM(CASE WHEN tl.direction = 'debit' THEN tl.amount ELSE 0 END), 0) AS spent
      FROM token_ledger tl JOIN events e ON e.id = tl.event_id
      WHERE tl.event_id IS NOT NULL AND tl.created_at >= ${ctx.from} AND tl.created_at < ${ctx.to} ${ledgerCommunityCond}
      GROUP BY tl.event_id, e.name
      ORDER BY earned DESC
      LIMIT ${TOP_N}
    `),
    // Fase 12 (spec §17 "earning by origin"/§22 Community "ST issued through Community")
    // — origin real de token_rules.origin, persistido tal cual en cada movimiento
    // (tokenEngine.ts: sourceType = input.origin) — nunca una etiqueta inventada aquí.
    db.execute(sql`
      SELECT tl.source_type AS origin,
        COALESCE(SUM(CASE WHEN tl.direction = 'credit' THEN tl.amount ELSE 0 END), 0) AS earned,
        COALESCE(SUM(CASE WHEN tl.direction = 'debit' THEN tl.amount ELSE 0 END), 0) AS spent
      FROM token_ledger tl
      WHERE tl.created_at >= ${ctx.from} AND tl.created_at < ${ctx.to} ${ledgerCommunityCond}
      GROUP BY tl.source_type
      ORDER BY earned DESC
    `),
  ]);

  const movement = rowsOf<{ earned: number | string; spent: number | string }>(movementResult)[0] ?? { earned: 0, spent: 0 };
  const wallet = rowsOf<{ active_wallets: number | string; circulating: number | string; avg_balance: number | string }>(walletResult)[0] ?? { active_wallets: 0, circulating: 0, avg_balance: 0 };
  const activeWallets = Number(wallet.active_wallets);

  return {
    liveStatus: LIVE_LOYALTY_ENABLED ? "LIVE_ACTIVE" : "LIVE_LOCKED",
    earnedInPeriod: Number(movement.earned),
    spentInPeriod: Number(movement.spent),
    circulatingBalance: Number(wallet.circulating),
    activeWallets,
    avgBalance: activeWallets > 0 ? Math.round(Number(wallet.avg_balance) * 10) / 10 : null,
    topEarningRules: rowsOf<{ rule_id: number | null; rule_name: string; total: number | string }>(rulesResult).map(r => ({ ruleId: r.rule_id, ruleName: r.rule_name, totalEarned: Number(r.total) })),
    tokensByVenue: rowsOf<{ venue_id: number; venue_name: string; earned: number | string; spent: number | string }>(venueResult).map(r => ({ venueId: Number(r.venue_id), venueName: r.venue_name, earned: Number(r.earned), spent: Number(r.spent) })),
    tokensByEvent: rowsOf<{ event_id: number; event_name: string; earned: number | string; spent: number | string }>(eventResult).map(r => ({ eventId: Number(r.event_id), eventName: r.event_name, earned: Number(r.earned), spent: Number(r.spent) })),
    tokensByOrigin: rowsOf<{ origin: string | null; earned: number | string; spent: number | string }>(originResult).map(r => ({ origin: r.origin ?? "desconocido", earned: Number(r.earned), spent: Number(r.spent) })),
  };
}

export interface BenefitRedemptionBreakdown {
  benefitDefinitionId: number;
  benefitName: string;
  redeemedCount: number;
}

export interface BenefitsPerformanceSnapshot {
  generated: number;
  available: number;
  redeemed: number;
  expired: number;
  redemptionRatePct: number | null;
  expiringWithin48h: number;
  mostRedeemed: BenefitRedemptionBreakdown[];
}

export async function getBenefitsPerformance(ctx: DashboardFilterContext, db: AnyDbHandle, now: Date = ctx.to): Promise<BenefitsPerformanceSnapshot> {
  const communityCond = ctx.communityId != null ? sql`AND ub.user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${ctx.communityId})` : sql``;
  const soonThreshold = new Date(now.getTime() + EXPIRING_SOON_HOURS * 60 * 60 * 1000);

  const [statsResult, expiringResult, rankingResult] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) AS \`generated\`,
        SUM(CASE WHEN ub.status = 'active' AND (ub.valid_until IS NULL OR ub.valid_until >= ${now}) THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN ub.status = 'used' AND ub.used_at >= ${ctx.from} AND ub.used_at < ${ctx.to} THEN 1 ELSE 0 END) AS redeemed,
        SUM(CASE WHEN ub.status = 'expired' OR (ub.status = 'active' AND ub.valid_until < ${now}) THEN 1 ELSE 0 END) AS expired
      FROM user_benefits ub WHERE ub.granted_at >= ${ctx.from} AND ub.granted_at < ${ctx.to} ${communityCond}
    `),
    db.execute(sql`
      SELECT COUNT(*) AS n FROM user_benefits ub
      WHERE ub.status = 'active' AND ub.valid_until IS NOT NULL AND ub.valid_until >= ${now} AND ub.valid_until < ${soonThreshold} ${communityCond}
    `),
    db.execute(sql`
      SELECT ub.benefit_definition_id AS benefit_definition_id, bd.name AS benefit_name, COUNT(*) AS redeemed_count
      FROM user_benefits ub JOIN benefit_definitions bd ON bd.id = ub.benefit_definition_id
      WHERE ub.status = 'used' AND ub.used_at >= ${ctx.from} AND ub.used_at < ${ctx.to} ${communityCond}
      GROUP BY ub.benefit_definition_id, bd.name
      ORDER BY redeemed_count DESC
      LIMIT ${TOP_N}
    `),
  ]);

  const stats = rowsOf<{ generated: number | string; available: number | string; redeemed: number | string; expired: number | string }>(statsResult)[0] ?? { generated: 0, available: 0, redeemed: 0, expired: 0 };
  const generated = Number(stats.generated);
  const redeemed = Number(stats.redeemed ?? 0);
  const expiringWithin48h = Number(rowsOf<{ n: number | string }>(expiringResult)[0]?.n ?? 0);

  return {
    generated,
    available: Number(stats.available ?? 0),
    redeemed,
    expired: Number(stats.expired ?? 0),
    redemptionRatePct: generated > 0 ? Math.round((redeemed / generated) * 1000) / 10 : null,
    expiringWithin48h,
    mostRedeemed: rowsOf<{ benefit_definition_id: number; benefit_name: string; redeemed_count: number | string }>(rankingResult).map(r => ({ benefitDefinitionId: Number(r.benefit_definition_id), benefitName: r.benefit_name, redeemedCount: Number(r.redeemed_count) })),
  };
}

/**
 * Fase 12 (spec §20/§70, "estratégicamente importante"): "¿SEGOLIFE mueve
 * Students entre negocios?" — únicamente hechos reales ya persistidos
 * (`user_benefits.source_venue_id` = venue donde ocurrió el comportamiento
 * que disparó el Benefit; `used_at_venue_id` = venue donde se canjeó).
 * Solo filas con AMBOS venue reales y DISTINTOS entre sí (spec: nunca
 * afirmar causalidad más allá del origen de regla registrado — un
 * cross_venue_grants=0 real es tan válido como uno con datos).
 */
export interface CrossVenueBenefitFlowRow {
  sourceVenueId: number;
  sourceVenueName: string;
  destinationVenueId: number;
  destinationVenueName: string;
  granted: number;
  redeemed: number;
  redemptionRatePct: number | null;
}

export async function getCrossVenueBenefitFlow(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<CrossVenueBenefitFlowRow[]> {
  const communityCond = ctx.communityId != null ? sql`AND ub.user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${ctx.communityId})` : sql``;

  const result = await db.execute(sql`
    SELECT
      ub.source_venue_id AS source_venue_id, v1.name AS source_venue_name,
      ub.used_at_venue_id AS destination_venue_id, v2.name AS destination_venue_name,
      COUNT(*) AS granted,
      SUM(CASE WHEN ub.status = 'used' THEN 1 ELSE 0 END) AS redeemed
    FROM user_benefits ub
    JOIN venues v1 ON v1.id = ub.source_venue_id
    JOIN venues v2 ON v2.id = ub.used_at_venue_id
    WHERE ub.source_venue_id IS NOT NULL AND ub.used_at_venue_id IS NOT NULL
      AND ub.source_venue_id != ub.used_at_venue_id
      AND ub.granted_at >= ${ctx.from} AND ub.granted_at < ${ctx.to}
      ${communityCond}
    GROUP BY ub.source_venue_id, v1.name, ub.used_at_venue_id, v2.name
    ORDER BY granted DESC
    LIMIT ${TOP_N}
  `);

  return rowsOf<{
    source_venue_id: number; source_venue_name: string;
    destination_venue_id: number; destination_venue_name: string;
    granted: number | string; redeemed: number | string;
  }>(result).map(r => {
    const granted = Number(r.granted);
    const redeemed = Number(r.redeemed ?? 0);
    return {
      sourceVenueId: Number(r.source_venue_id), sourceVenueName: r.source_venue_name,
      destinationVenueId: Number(r.destination_venue_id), destinationVenueName: r.destination_venue_name,
      granted, redeemed,
      redemptionRatePct: granted > 0 ? Math.round((redeemed / granted) * 1000) / 10 : null,
    };
  });
}
