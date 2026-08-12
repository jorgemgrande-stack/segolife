/**
 * tokenEngine.ts — orquestador determinista del motor de SegoTokens (Fase 2).
 * Único punto de entrada para GANAR/GASTAR tokens vía regla — QR, Benefits y
 * Fourvenues (fases futuras) deberán llamar a `earnTokens`/`spendTokens` en
 * vez de reimplementar esta secuencia. Los routers delegan aquí, nunca
 * construyen ledger a mano (ver server/routers/tokens.ts).
 *
 * ORDEN DE APLICACIÓN (earnTokens):
 *  1-2. usuario/comunidad — responsabilidad del llamador (RBAC/community
 *       access ya resueltos antes de invocar el motor).
 *  3. horario del venue (isWithinSchedule) — si no hay venue, se omite.
 *  4. (evento/producto: solo se usan como criterio de scope de la regla).
 *  5. regla base aplicable (findApplicableRule).
 *  6. tokens base (calculateBaseTokens).
 *  7. bonus de recurrencia (applyRecurrenceBonus).
 *  8-9. campaña: multiplicador + bonus fijo (findApplicableCampaign +
 *       applyCampaignToAmount).
 *  10. límites diario/mensual de la regla — RECORTA el importe final en vez
 *      de rechazar la operación completa (ver drizzle/schema.ts,
 *      comentario de token_rules).
 *  11-12. ledger + wallet, atómicamente (postLedgerMovement).
 *
 * El desglose completo (`TokenBreakdown`) se guarda en `token_ledger.metadata`
 * — permite mostrar "Base: 20, Recurrencia: +10, Campaña x2 → 60" sin
 * recalcular nada a posteriori.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  postLedgerMovement,
  sumAmountByRuleInWindow,
  TokenEngineError,
  type AnyDbHandle,
} from "./tokenLedgerService";
import { isWithinSchedule } from "./tokenScheduleService";
import {
  findApplicableRule,
  calculateBaseTokens,
  applyRecurrenceBonus,
  findApplicableCampaign,
  applyCampaignToAmount,
} from "./tokenRuleEngine";
import type { TokenWallet, TokenLedgerEntry, TokenRule } from "../../../drizzle/schema";
import { emitEngagementEvent } from "../engagement/engagementEvents";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface TokenBreakdown {
  base: number;
  recurrenceBonus: number;
  recurrenceRuleId: number | null;
  campaignMultiplier: number | null;
  campaignBonus: number | null;
  campaignId: number | null;
  beforeLimits: number;
  final: number;
  ruleId: number;
}

export interface EngineResult {
  wallet: TokenWallet;
  ledger: TokenLedgerEntry;
  breakdown: TokenBreakdown;
}

function dayStart(at: Date): Date {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthStart(at: Date): Date {
  const d = new Date(at);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface EarnTokensInput {
  userId: number;
  communityId?: number | null;
  venueId?: number | null;
  eventId?: number | null;
  productId?: number | null;
  amountSpent?: number;
  origin: TokenRule["origin"];
  /**
   * Id de la fila de origen (p.ej. commerce_transactions.id o
   * consumption_qr_codes.id) — antes se perdía siempre (token_ledger.source_id
   * nunca se rellenaba pese a existir la columna), lo que hacía indistinguible
   * en el ledger un consumo QR de un consumo POS (mismo sourceType, ver
   * auditoría Student 360 §C/D). Opcional para no romper callers existentes.
   */
  sourceId?: number | null;
  idempotencyKey?: string | null;
  createdByUserId?: number | null;
  at?: Date;
}

export async function earnTokens(input: EarnTokensInput, db?: AnyDbHandle): Promise<EngineResult> {
  const conn = db ?? (await getDb());
  const at = input.at ?? new Date();

  if (input.venueId) {
    const allowed = await isWithinSchedule(input.venueId, "earn", at, conn);
    if (!allowed) throw new TokenEngineError("OUTSIDE_SCHEDULE", "El venue no permite ganar tokens en este horario");
  }

  const rule = await findApplicableRule({
    direction: "earn",
    origin: input.origin,
    communityId: input.communityId,
    venueId: input.venueId,
    eventId: input.eventId,
    productId: input.productId,
  }, at, conn);
  if (!rule) throw new TokenEngineError("NO_RULE_FOUND", "No existe ninguna regla activa que aplique a esta operación");

  const base = calculateBaseTokens(rule, { amountSpent: input.amountSpent });
  const recurrence = await applyRecurrenceBonus({
    userId: input.userId, venueId: input.venueId, communityId: input.communityId, at,
  }, conn);
  const campaign = await findApplicableCampaign({
    communityId: input.communityId, venueId: input.venueId, eventId: input.eventId, at,
  }, conn);

  const afterRecurrence = base + recurrence.bonus;
  const beforeLimits = applyCampaignToAmount(campaign, afterRecurrence);

  let final = beforeLimits;
  if (rule.dailyLimit != null) {
    const earnedToday = await sumAmountByRuleInWindow(input.userId, rule.id, "credit", dayStart(at), conn);
    final = Math.min(final, Math.max(0, rule.dailyLimit - earnedToday));
  }
  if (rule.monthlyLimit != null) {
    const earnedThisMonth = await sumAmountByRuleInWindow(input.userId, rule.id, "credit", monthStart(at), conn);
    final = Math.min(final, Math.max(0, rule.monthlyLimit - earnedThisMonth));
  }
  if (final <= 0) {
    throw new TokenEngineError("RULE_LIMIT_EXCEEDED", "Se ha alcanzado el límite de esta regla para el periodo actual");
  }

  const breakdown: TokenBreakdown = {
    base,
    recurrenceBonus: recurrence.bonus,
    recurrenceRuleId: recurrence.rule?.id ?? null,
    campaignMultiplier: campaign?.multiplier != null ? Number(campaign.multiplier) : null,
    campaignBonus: campaign?.bonusTokens ?? null,
    campaignId: campaign?.id ?? null,
    beforeLimits,
    final,
    ruleId: rule.id,
  };

  const { wallet, ledger } = await postLedgerMovement({
    userId: input.userId,
    direction: "credit",
    amount: final,
    reason: rule.name,
    sourceType: input.origin,
    sourceId: input.sourceId ?? null,
    venueId: input.venueId ?? null,
    eventId: input.eventId ?? null,
    ruleId: rule.id,
    campaignId: campaign?.id ?? null,
    idempotencyKey: input.idempotencyKey,
    metadata: breakdown as unknown as Record<string, unknown>,
    createdByUserId: input.createdByUserId,
  }, conn);

  // Communication Center: "tokens_earned" ya existía en el catálogo tipado
  // de engagementEvents.ts pero nunca se emitía (confirmado por auditoría) —
  // mismo patrón que emitEngagementEvent("ticket_purchased", ...) en
  // checkoutService.ts. El listener decide si el monto merece email
  // (política de relevancia), nunca este motor.
  emitEngagementEvent("tokens_earned", {
    userId: input.userId,
    communityId: input.communityId ?? null,
    amount: final,
    ledgerId: ledger.id,
    venueId: input.venueId ?? null,
    eventId: input.eventId ?? null,
  });

  return { wallet, ledger, breakdown };
}

export interface SpendTokensInput {
  userId: number;
  communityId?: number | null;
  venueId: number;
  productId?: number | null;
  /** Por defecto 'product' — el origen conceptual de un gasto real es casi siempre un producto del venue. */
  origin?: TokenRule["origin"];
  idempotencyKey?: string | null;
  createdByUserId?: number | null;
  at?: Date;
}

/**
 * Gasto de tokens. A diferencia de earnTokens, un límite alcanzado RECHAZA
 * la operación en vez de recortarla — descontar el precio pactado de un
 * producto no es una opción válida. `postLedgerMovement` es quien impide
 * saldo negativo (INSUFFICIENT_BALANCE), con lock de fila real sobre el
 * wallet — dos gastos simultáneos del mismo usuario quedan serializados por
 * MySQL, no por esta función.
 */
export async function spendTokens(input: SpendTokensInput, db?: AnyDbHandle): Promise<EngineResult> {
  const conn = db ?? (await getDb());
  const at = input.at ?? new Date();

  const allowed = await isWithinSchedule(input.venueId, "spend", at, conn);
  if (!allowed) throw new TokenEngineError("OUTSIDE_SCHEDULE", "El venue no permite gastar tokens en este horario");

  const origin = input.origin ?? "product";
  const rule = await findApplicableRule({
    direction: "spend",
    origin,
    communityId: input.communityId,
    venueId: input.venueId,
    productId: input.productId,
  }, at, conn);
  if (!rule) throw new TokenEngineError("NO_RULE_FOUND", "No existe ninguna regla de gasto activa que aplique a esta operación");

  const cost = calculateBaseTokens(rule, {});
  if (cost <= 0) throw new TokenEngineError("RULE_LIMIT_EXCEEDED", "La regla no define un coste válido");

  if (rule.dailyLimit != null) {
    const spentToday = await sumAmountByRuleInWindow(input.userId, rule.id, "debit", dayStart(at), conn);
    if (spentToday + cost > rule.dailyLimit) {
      throw new TokenEngineError("RULE_LIMIT_EXCEEDED", "Se ha alcanzado el límite diario de gasto de esta regla");
    }
  }
  if (rule.monthlyLimit != null) {
    const spentThisMonth = await sumAmountByRuleInWindow(input.userId, rule.id, "debit", monthStart(at), conn);
    if (spentThisMonth + cost > rule.monthlyLimit) {
      throw new TokenEngineError("RULE_LIMIT_EXCEEDED", "Se ha alcanzado el límite mensual de gasto de esta regla");
    }
  }

  const breakdown: TokenBreakdown = {
    base: cost,
    recurrenceBonus: 0,
    recurrenceRuleId: null,
    campaignMultiplier: null,
    campaignBonus: null,
    campaignId: null,
    beforeLimits: cost,
    final: cost,
    ruleId: rule.id,
  };

  const { wallet, ledger } = await postLedgerMovement({
    userId: input.userId,
    direction: "debit",
    amount: cost,
    reason: rule.name,
    sourceType: origin,
    venueId: input.venueId,
    ruleId: rule.id,
    idempotencyKey: input.idempotencyKey,
    metadata: breakdown as unknown as Record<string, unknown>,
    createdByUserId: input.createdByUserId,
  }, conn);

  return { wallet, ledger, breakdown };
}
