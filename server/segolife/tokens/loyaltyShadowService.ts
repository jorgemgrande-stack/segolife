/**
 * loyaltyShadowService.ts — SEGOLIFE LOYALTY SHADOW MODE & REAL TRAFFIC
 * OBSERVATION GATE.
 *
 * PRINCIPIO ABSOLUTO (spec §1): SHADOW CALCULATES. SHADOW NEVER EXECUTES.
 * Este archivo es el ÚNICO punto de entrada que los pipelines reales
 * (ticketPurchasePipeline.ts/attendancePipeline.ts) llaman para observar
 * tráfico — nunca escribe en token_ledger/token_wallets/user_benefits,
 * nunca llama a earnTokens()/postLedgerMovement()/evaluateBenefitsForOrigin(),
 * nunca dispara email/WhatsApp/Push/GHL, nunca hace claim/auto-link de
 * identidad histórica.
 *
 * ONE REWARD ENGINE (spec §3): el cálculo real SIEMPRE pasa por
 * `evaluateReward(ctx, "SIMULATION")` de rewardEngine.ts — el MISMO motor
 * que usará LIVE cuando algún día se active. Este archivo nunca reimplementa
 * selección de regla/recurrencia/campaña — solo orquesta: identity gate,
 * idempotencia, acumulación de topes ENTRE observaciones Shadow (ver
 * `computeShadowPriorConsumption`, necesario porque Shadow nunca escribe
 * token_ledger, así que rewardEngine.ts no puede ver por sí solo cuánto se
 * ha "concedido" en observaciones Shadow anteriores) y persistencia.
 *
 * FAILURE ISOLATION (spec §29): `observeShadow()` NUNCA lanza — cualquier
 * fallo (cálculo, persistencia, feature flag) se captura y loguea. Un fallo
 * de Shadow jamás debe romper Fourvenues sync ni ningún flujo de negocio
 * real. Todos los call sites en los pipelines llaman a esta única función,
 * nunca a las piezas internas directamente.
 */
import { eq, and, gte, lt, inArray, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  loyaltyShadowEvaluations, loyaltyShadowErrors, tokenRules, tokenCampaigns, venues, events,
  type LoyaltyShadowEvaluation, type TokenRule,
} from "../../../drizzle/schema";
import {
  evaluateReward, type RewardContext, type RewardReason,
  dayStart, weekStart, monthStart, lifetimeStart,
} from "./rewardEngine";
import { findApplicableRule, findApplicableCampaign } from "./tokenRuleEngine";
import { getFeatureFlag } from "../../config";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
async function getDb(): Promise<DbHandle> { return _db; }

const SHADOW_FLAG_KEY = "loyalty_shadow_enabled";

export async function isShadowEnabled(): Promise<boolean> {
  return getFeatureFlag(SHADOW_FLAG_KEY, false);
}

export type ShadowTrigger = "EVENT_PURCHASE" | "EVENT_ATTENDANCE" | "EVENT_REFUND" | "EVENT_CANCEL" | "PENDING_TO_PAID";
export type ShadowDenialReason = RewardReason | "NO_STUDENT" | "NOTHING_TO_REVERSE";

export interface ShadowObservationInput {
  provider: string;
  /** Identificador estable de la operación real — ticket_orders.externalId / event_attendance.externalAttendanceId / unresolved_operations.externalReferenceId, según el trigger. */
  externalOperationId: string;
  trigger: ShadowTrigger;
  operationState?: string | null;
  /** null = identidad histórica sin Student resuelto (spec §2) — NUNCA se llama a evaluateReward en ese caso. */
  userId: number | null;
  venueId?: number | null;
  eventId?: number | null;
  communityId?: number | null;
  amountSpent?: number;
  origin: RewardContext["origin"];
  occurredAt: Date;
  integrationId?: number | null;
  /** Reenvía `loyaltyEffectiveFrom`/cutoff explícito del caller (p.ej. backfill con fecha) — evaluateReward lo trata igual que cualquier otro CUTOFF_BLOCKED, nunca lo redefine. */
  loyaltyCutoffAt?: Date | null;
}

function isDuplicateKeyError(err: unknown): boolean {
  return !!err && typeof err === "object" && "errno" in err && (err as { errno?: number }).errno === 1062;
}

/**
 * Acumulación de topes SOLO a partir de observaciones Shadow previas (nunca
 * token_ledger real — ese consumo ya lo cubre rewardEngine.ts por su cuenta,
 * spec §34). GRANTED suma, SIMULATED_REVERSAL resta — así una compra
 * reembolsada deja de "ocupar" el tope una vez Shadow observa el reembolso.
 */
async function computeShadowPriorConsumption(userId: number, ruleId: number, at: Date, db: DbHandle) {
  const rows = await db.select({ finalTokens: loyaltyShadowEvaluations.finalTokens, decision: loyaltyShadowEvaluations.decision, evaluatedAt: loyaltyShadowEvaluations.evaluatedAt })
    .from(loyaltyShadowEvaluations)
    .where(and(eq(loyaltyShadowEvaluations.userId, userId), eq(loyaltyShadowEvaluations.ruleId, ruleId)));

  const sumSince = (since: Date) => rows
    .filter(r => r.evaluatedAt >= since)
    .reduce((sum, r) => sum + (r.decision === "GRANTED" ? (r.finalTokens ?? 0) : r.decision === "SIMULATED_REVERSAL" ? -(r.finalTokens ?? 0) : 0), 0);

  return {
    daily: Math.max(0, sumSince(dayStart(at))),
    weekly: Math.max(0, sumSince(weekStart(at))),
    monthly: Math.max(0, sumSince(monthStart(at))),
    lifetime: Math.max(0, sumSince(lifetimeStart())),
  };
}

async function computeShadowPriorCampaignIssued(campaignId: number, db: DbHandle): Promise<number> {
  const rows = await db.select({ finalTokens: loyaltyShadowEvaluations.finalTokens, decision: loyaltyShadowEvaluations.decision })
    .from(loyaltyShadowEvaluations)
    .where(eq(loyaltyShadowEvaluations.campaignId, campaignId));
  const sum = rows.reduce((s, r) => s + (r.decision === "GRANTED" ? (r.finalTokens ?? 0) : r.decision === "SIMULATED_REVERSAL" ? -(r.finalTokens ?? 0) : 0), 0);
  return Math.max(0, sum);
}

interface ShadowRow {
  provider: string; externalOperationId: string; trigger: ShadowTrigger; operationState: string | null;
  userId: number | null; venueId: number | null; eventId: number | null; communityId: number | null;
  ruleId: number | null; rulePolicyVersion: Date | null; campaignId: number | null; campaignPolicyVersion: Date | null;
  eligible: boolean; decision: "GRANTED" | "DENIED" | "SIMULATED_REVERSAL"; denialReason: ShadowDenialReason | null;
  baseTokens: number | null; recurrenceTokens: number | null; campaignTokens: number | null;
  capApplied: boolean; finalTokens: number | null; isReversal: boolean; originalShadowEvaluationId: number | null;
  evaluatedAt: Date;
}

/** Idempotente por (provider, externalOperationId, trigger) — un duplicado nunca lanza, solo se ignora (spec §10: "paid -> mismo paid = SAME EVALUATION"). */
async function persistShadowRow(row: ShadowRow, db: DbHandle): Promise<void> {
  try {
    await db.insert(loyaltyShadowEvaluations).values(row);
  } catch (err) {
    if (isDuplicateKeyError(err)) return; // ya observada — idempotente, no es un error
    throw err;
  }
}

async function findExistingEvaluation(provider: string, externalOperationId: string, trigger: ShadowTrigger, db: DbHandle): Promise<LoyaltyShadowEvaluation | null> {
  const [row] = await db.select().from(loyaltyShadowEvaluations)
    .where(and(eq(loyaltyShadowEvaluations.provider, provider), eq(loyaltyShadowEvaluations.externalOperationId, externalOperationId), eq(loyaltyShadowEvaluations.trigger, trigger)))
    .limit(1);
  return row ?? null;
}

/**
 * Núcleo de cálculo — SIEMPRE vía evaluateReward(ctx, "SIMULATION"). Nunca
 * se llama para userId=null (identity gate ya resuelto por el caller).
 */
async function evaluateGrantTrigger(input: ShadowObservationInput & { userId: number }, db: DbHandle): Promise<ShadowRow> {
  const at = input.occurredAt;
  // findApplicableRule se llama aquí (para poder acumular topes Shadow ANTES
  // de invocar el motor real) y OTRA VEZ dentro de evaluateReward — misma
  // función real, nunca una reimplementación (coste: un SELECT extra barato,
  // nunca una segunda lógica de selección de regla).
  const rule: TokenRule | null = await findApplicableRule({
    direction: "earn", origin: input.origin, communityId: input.communityId, venueId: input.venueId, eventId: input.eventId,
  }, at, db);

  const base: ShadowRow = {
    provider: input.provider, externalOperationId: input.externalOperationId, trigger: input.trigger,
    operationState: input.operationState ?? null, userId: input.userId, venueId: input.venueId ?? null,
    eventId: input.eventId ?? null, communityId: input.communityId ?? null,
    ruleId: null, rulePolicyVersion: null, campaignId: null, campaignPolicyVersion: null,
    eligible: false, decision: "DENIED", denialReason: "NO_RULE_FOUND",
    baseTokens: null, recurrenceTokens: null, campaignTokens: null, capApplied: false, finalTokens: null,
    isReversal: false, originalShadowEvaluationId: null, evaluatedAt: at,
  };
  if (!rule) return base;

  const priorConsumed = await computeShadowPriorConsumption(input.userId, rule.id, at, db);
  const campaign = await findApplicableCampaign({ communityId: input.communityId, venueId: input.venueId, eventId: input.eventId, at }, db);
  const priorCampaignIssued = campaign?.maxTotalTokens != null ? await computeShadowPriorCampaignIssued(campaign.id, db) : undefined;

  const ctx: RewardContext = {
    userId: input.userId, communityId: input.communityId, venueId: input.venueId, eventId: input.eventId,
    amountSpent: input.amountSpent, origin: input.origin, at,
    integrationId: input.integrationId ?? null,
    loyaltyCutoffAt: input.loyaltyCutoffAt ?? null,
    priorSimulatedConsumedByWindow: priorConsumed,
    priorSimulatedCampaignIssued: priorCampaignIssued,
  };
  const result = await evaluateReward(ctx, "SIMULATION", db);
  const b = result.explanation.breakdown;

  return {
    ...base,
    ruleId: rule.id, rulePolicyVersion: rule.updatedAt,
    campaignId: b?.campaignId ?? null, campaignPolicyVersion: campaign?.updatedAt ?? null,
    eligible: result.explanation.eligible,
    decision: result.explanation.eligible ? "GRANTED" : "DENIED",
    denialReason: result.explanation.eligible ? null : result.explanation.reason,
    baseTokens: b?.base ?? null, recurrenceTokens: b?.recurrenceBonus ?? null, campaignTokens: b?.campaignBonus ?? null,
    capApplied: b ? b.final < b.beforeLimits : false,
    finalTokens: result.explanation.eligible ? b?.final ?? null : null,
  };
}

function noStudentRow(input: ShadowObservationInput): ShadowRow {
  return {
    provider: input.provider, externalOperationId: input.externalOperationId, trigger: input.trigger,
    operationState: input.operationState ?? null, userId: null, venueId: input.venueId ?? null,
    eventId: input.eventId ?? null, communityId: input.communityId ?? null,
    ruleId: null, rulePolicyVersion: null, campaignId: null, campaignPolicyVersion: null,
    eligible: false, decision: "DENIED", denialReason: "NO_STUDENT",
    baseTokens: null, recurrenceTokens: null, campaignTokens: null, capApplied: false, finalTokens: null,
    isReversal: false, originalShadowEvaluationId: null, evaluatedAt: input.occurredAt,
  };
}

/**
 * REFUND / CANCEL (spec §7-8) — busca la evaluación GRANTED previa de la
 * MISMA operación (bajo EVENT_PURCHASE o PENDING_TO_PAID, lo que se haya
 * observado) y produce una reversión simulada equivalente. Si nunca se
 * concedió nada (DENIED, o nunca observado), no hay nada que revertir.
 */
async function evaluateReversalTrigger(input: ShadowObservationInput, db: DbHandle): Promise<ShadowRow> {
  const purchaseEval = await findExistingEvaluation(input.provider, input.externalOperationId, "EVENT_PURCHASE", db);
  const pendingEval = await findExistingEvaluation(input.provider, input.externalOperationId, "PENDING_TO_PAID", db);
  const original = [purchaseEval, pendingEval].filter((r): r is LoyaltyShadowEvaluation => !!r && r.decision === "GRANTED")
    .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime())[0] ?? null;

  if (!original) {
    return {
      provider: input.provider, externalOperationId: input.externalOperationId, trigger: input.trigger,
      operationState: input.operationState ?? null, userId: input.userId, venueId: input.venueId ?? null,
      eventId: input.eventId ?? null, communityId: input.communityId ?? null,
      ruleId: null, rulePolicyVersion: null, campaignId: null, campaignPolicyVersion: null,
      eligible: false, decision: "DENIED", denialReason: "NOTHING_TO_REVERSE",
      baseTokens: null, recurrenceTokens: null, campaignTokens: null, capApplied: false, finalTokens: null,
      isReversal: false, originalShadowEvaluationId: null, evaluatedAt: input.occurredAt,
    };
  }

  return {
    provider: input.provider, externalOperationId: input.externalOperationId, trigger: input.trigger,
    operationState: input.operationState ?? null, userId: original.userId, venueId: original.venueId,
    eventId: original.eventId, communityId: original.communityId,
    ruleId: original.ruleId, rulePolicyVersion: original.rulePolicyVersion, campaignId: original.campaignId, campaignPolicyVersion: original.campaignPolicyVersion,
    eligible: true, decision: "SIMULATED_REVERSAL", denialReason: null,
    baseTokens: null, recurrenceTokens: null, campaignTokens: null, capApplied: false,
    finalTokens: original.finalTokens, isReversal: true, originalShadowEvaluationId: original.id,
    evaluatedAt: input.occurredAt,
  };
}

async function runObservation(input: ShadowObservationInput, db: DbHandle): Promise<void> {
  let row: ShadowRow;
  if (input.trigger === "EVENT_REFUND" || input.trigger === "EVENT_CANCEL") {
    row = await evaluateReversalTrigger(input, db);
  } else if (input.userId === null) {
    row = noStudentRow(input);
  } else {
    row = await evaluateGrantTrigger({ ...input, userId: input.userId }, db);
  }
  await persistShadowRow(row, db);
}

/**
 * ÚNICO punto de entrada para los pipelines reales. NUNCA lanza (spec §29) —
 * cualquier error se loguea y se descarta. Si Shadow está OFF, es un no-op
 * inmediato (ni siquiera toca la BD).
 */
// ─── Lectura para el admin UI (spec §18-21/§42) ────────────────────────────
// Mismo criterio de escala que studentSegmentFilterService.ts/
// commandCenterStudents.ts: volumen de Shadow (tráfico real incremental
// desde su activación) es de sobra manejable agregando en Node sobre las
// filas del periodo filtrado, sin necesitar SQL de agregación dedicado.

export interface ShadowFilters {
  communityIds: number[] | "all";
  venueId?: number;
  from: Date;
  to: Date;
}

async function loadFilteredRows(filters: ShadowFilters, db: DbHandle): Promise<LoyaltyShadowEvaluation[]> {
  const conditions = [gte(loyaltyShadowEvaluations.evaluatedAt, filters.from), lt(loyaltyShadowEvaluations.evaluatedAt, filters.to)];
  if (filters.venueId) conditions.push(eq(loyaltyShadowEvaluations.venueId, filters.venueId));
  if (filters.communityIds !== "all") {
    if (filters.communityIds.length === 0) return [];
    conditions.push(inArray(loyaltyShadowEvaluations.communityId, filters.communityIds));
  }
  return db.select().from(loyaltyShadowEvaluations).where(and(...conditions));
}

export interface ShadowKpis {
  operationsObserved: number;
  knownStudents: number;
  unresolvedIdentities: number;
  eligibleRewards: number;
  deniedRewards: number;
  simulatedTokens: number;
  simulatedReversals: number;
}

/** Registered Students vs unresolved identities SIEMPRE separados (spec §19 — nunca inflar "Students affected" con identidades históricas). */
export async function getShadowKpis(filters: ShadowFilters, db?: DbHandle): Promise<ShadowKpis> {
  const conn = db ?? (await getDb());
  const rows = await loadFilteredRows(filters, conn);
  const knownStudentIds = new Set(rows.filter(r => r.userId != null).map(r => r.userId));
  const granted = rows.filter(r => r.decision === "GRANTED");
  const reversals = rows.filter(r => r.decision === "SIMULATED_REVERSAL");
  const simulatedTokens = granted.reduce((s, r) => s + (r.finalTokens ?? 0), 0) - reversals.reduce((s, r) => s + (r.finalTokens ?? 0), 0);
  return {
    operationsObserved: rows.length,
    knownStudents: knownStudentIds.size,
    unresolvedIdentities: rows.filter(r => r.denialReason === "NO_STUDENT").length,
    eligibleRewards: granted.length,
    deniedRewards: rows.filter(r => r.decision === "DENIED").length,
    simulatedTokens,
    simulatedReversals: reversals.length,
  };
}

export interface ShadowFeedItem {
  id: number; evaluatedAt: string; trigger: ShadowTrigger; operationState: string | null;
  venueId: number | null; venueName: string | null;
  eventId: number | null; eventName: string | null;
  userId: number | null;
  decision: string; denialReason: string | null;
  ruleId: number | null; ruleName: string | null;
  finalTokens: number | null;
}

export async function getShadowFeed(filters: ShadowFilters, limit: number, offset: number, db?: DbHandle): Promise<{ items: ShadowFeedItem[]; total: number }> {
  const conn = db ?? (await getDb());
  const rows = await loadFilteredRows(filters, conn);
  const sorted = rows.slice().sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
  const page = sorted.slice(offset, offset + limit);

  const venueIds = Array.from(new Set(page.map(r => r.venueId).filter((v): v is number => v != null)));
  const eventIds = Array.from(new Set(page.map(r => r.eventId).filter((v): v is number => v != null)));
  const ruleIds = Array.from(new Set(page.map(r => r.ruleId).filter((v): v is number => v != null)));
  const [venueRows, eventRows, ruleRows] = await Promise.all([
    venueIds.length ? conn.select({ id: venues.id, name: venues.name }).from(venues).where(inArray(venues.id, venueIds)) : Promise.resolve([]),
    eventIds.length ? conn.select({ id: events.id, name: events.name }).from(events).where(inArray(events.id, eventIds)) : Promise.resolve([]),
    ruleIds.length ? conn.select({ id: tokenRules.id, name: tokenRules.name }).from(tokenRules).where(inArray(tokenRules.id, ruleIds)) : Promise.resolve([]),
  ]);
  const venueNames = new Map(venueRows.map(v => [v.id, v.name]));
  const eventNames = new Map(eventRows.map(e => [e.id, e.name]));
  const ruleNames = new Map(ruleRows.map(r => [r.id, r.name]));

  const items = page.map(r => ({
    id: r.id, evaluatedAt: r.evaluatedAt.toISOString(), trigger: r.trigger as ShadowTrigger, operationState: r.operationState,
    venueId: r.venueId, venueName: r.venueId ? venueNames.get(r.venueId) ?? null : null,
    eventId: r.eventId, eventName: r.eventId ? eventNames.get(r.eventId) ?? null : null,
    userId: r.userId, decision: r.decision, denialReason: r.denialReason,
    ruleId: r.ruleId, ruleName: r.ruleId ? ruleNames.get(r.ruleId) ?? null : null,
    finalTokens: r.finalTokens,
  }));
  return { items, total: sorted.length };
}

export interface ShadowAggregates {
  byVenue: Array<{ venueId: number; venueName: string; count: number }>;
  byTrigger: Array<{ trigger: string; count: number }>;
  byRule: Array<{ ruleId: number; ruleName: string; count: number; tokens: number }>;
  byDenialReason: Array<{ reason: string; count: number }>;
}

export async function getShadowAggregates(filters: ShadowFilters, db?: DbHandle): Promise<ShadowAggregates> {
  const conn = db ?? (await getDb());
  const rows = await loadFilteredRows(filters, conn);

  const venueIds = Array.from(new Set(rows.map(r => r.venueId).filter((v): v is number => v != null)));
  const ruleIds = Array.from(new Set(rows.map(r => r.ruleId).filter((v): v is number => v != null)));
  const [venueRows, ruleRows] = await Promise.all([
    venueIds.length ? conn.select({ id: venues.id, name: venues.name }).from(venues).where(inArray(venues.id, venueIds)) : Promise.resolve([]),
    ruleIds.length ? conn.select({ id: tokenRules.id, name: tokenRules.name }).from(tokenRules).where(inArray(tokenRules.id, ruleIds)) : Promise.resolve([]),
  ]);
  const venueNames = new Map(venueRows.map(v => [v.id, v.name]));
  const ruleNames = new Map(ruleRows.map(r => [r.id, r.name]));

  const byVenueMap = new Map<number, number>();
  const byTriggerMap = new Map<string, number>();
  const byRuleMap = new Map<number, { count: number; tokens: number }>();
  const byDenialMap = new Map<string, number>();
  for (const r of rows) {
    if (r.venueId) byVenueMap.set(r.venueId, (byVenueMap.get(r.venueId) ?? 0) + 1);
    byTriggerMap.set(r.trigger, (byTriggerMap.get(r.trigger) ?? 0) + 1);
    if (r.ruleId) {
      const cur = byRuleMap.get(r.ruleId) ?? { count: 0, tokens: 0 };
      cur.count++;
      if (r.decision === "GRANTED") cur.tokens += r.finalTokens ?? 0;
      byRuleMap.set(r.ruleId, cur);
    }
    if (r.denialReason) byDenialMap.set(r.denialReason, (byDenialMap.get(r.denialReason) ?? 0) + 1);
  }

  return {
    byVenue: Array.from(byVenueMap.entries()).map(([venueId, count]) => ({ venueId, venueName: venueNames.get(venueId) ?? `Venue #${venueId}`, count })).sort((a, b) => b.count - a.count),
    byTrigger: Array.from(byTriggerMap.entries()).map(([trigger, count]) => ({ trigger, count })).sort((a, b) => b.count - a.count),
    byRule: Array.from(byRuleMap.entries()).map(([ruleId, v]) => ({ ruleId, ruleName: ruleNames.get(ruleId) ?? `Regla #${ruleId}`, ...v })).sort((a, b) => b.count - a.count),
    byDenialReason: Array.from(byDenialMap.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

export interface ShadowHealth {
  enabled: boolean;
  lastEvaluationAt: string | null;
  errorCountLast24h: number;
  evaluationRateLast1h: number;
}

/** Spec §42 — enabled/last evaluation/error count/evaluation rate/dropped evaluations, todo desde datos reales, nunca inventado. */
export async function getShadowHealth(db?: DbHandle): Promise<ShadowHealth> {
  const conn = db ?? (await getDb());
  const enabled = await isShadowEnabled();
  const [last] = await conn.select({ evaluatedAt: loyaltyShadowEvaluations.evaluatedAt }).from(loyaltyShadowEvaluations).orderBy(desc(loyaltyShadowEvaluations.evaluatedAt)).limit(1);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since1h = new Date(Date.now() - 60 * 60 * 1000);
  const errorRows = await conn.select({ id: loyaltyShadowErrors.id }).from(loyaltyShadowErrors).where(gte(loyaltyShadowErrors.occurredAt, since24h));
  const recentRows = await conn.select({ id: loyaltyShadowEvaluations.id }).from(loyaltyShadowEvaluations).where(gte(loyaltyShadowEvaluations.evaluatedAt, since1h));
  return {
    enabled,
    lastEvaluationAt: last?.evaluatedAt.toISOString() ?? null,
    errorCountLast24h: errorRows.length,
    evaluationRateLast1h: recentRows.length,
  };
}

export async function observeShadow(input: ShadowObservationInput, db?: DbHandle): Promise<void> {
  try {
    if (!(await isShadowEnabled())) return;
    const conn = db ?? (await getDb());
    await runObservation(input, conn);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[loyaltyShadowService] observeShadow falló (aislado — nunca bloquea el flujo real):", err);
    // Spec §42 — "No silent drop": se registra en loyalty_shadow_errors para
    // que el admin UI pueda mostrarlo. Si INCLUSO este insert falla, se
    // registra en consola y se abandona — nunca se relanza hacia el caller.
    try {
      const conn = db ?? (await getDb());
      await conn.insert(loyaltyShadowErrors).values({
        provider: input.provider, externalOperationId: input.externalOperationId, trigger: input.trigger,
        errorMessage: message.slice(0, 512),
      });
    } catch (persistErr) {
      console.error("[loyaltyShadowService] No se pudo ni registrar el error en loyalty_shadow_errors:", persistErr);
    }
  }
}
