/**
 * rewardEngine.ts — SEGOLIFE LIVE LOYALTY DESIGN & FOURVENUES REWARD ENGINE.
 * `evaluateReward(context, mode)` es el punto de entrada ÚNICO que unifica
 * SIMULACIÓN y ejecución real bajo la misma firma (spec: "la MISMA función
 * de motor, evaluateReward(context, mode: SIMULATION|LIVE)").
 *
 * SIMULATION: reutiliza el cálculo REAL de tokenRuleEngine.ts (misma
 * selección de regla, misma recurrencia, misma campaña, mismos topes
 * diario/mensual — contra las filas REALES de token_rules/token_campaigns
 * activas ahora mismo) pero NUNCA llama a postLedgerMovement/ensureWallet —
 * calcula y explica, no persiste nada. Útil para "si evaluara esto ahora
 * mismo con las reglas activas, ¿qué pasaría" sin ningún efecto secundario.
 *
 * LIVE: delegaría en earnTokens() — el mismo camino que ya usan
 * ticketPurchasePipeline.ts/attendancePipeline.ts — pero permanece
 * ESTRUCTURALMENTE BLOQUEADO en esta fase: `LIVE_MODE_ENABLED` es una
 * constante literal `false` sin ningún flag de entorno, endpoint admin ni
 * caller que la alcance. Cambiar esto es una decisión de negocio explícita
 * y futura, nunca un efecto colateral de otra tarea (ver informe de fase,
 * Decision Gate: "LIVE LOYALTY: DO NOT ACTIVATE").
 *
 * FUERA DE ALCANCE A PROPÓSITO: este motor calcula/concede SegoTokens
 * (origin→regla→importe), nunca Benefits — evaluateBenefitsForOrigin sigue
 * siendo responsabilidad exclusiva del pipeline llamador (mismo criterio ya
 * confirmado por la auditoría: EARN ENGINE y BENEFIT ENGINE son módulos
 * deliberadamente separados, ver ticketPurchasePipeline.ts/attendancePipeline.ts,
 * que llaman a ambos motores por separado, nunca uno a través del otro).
 */
import {
  findApplicableRule,
  calculateBaseTokens,
  applyRecurrenceBonus,
  findApplicableCampaign,
  applyCampaignToAmount,
} from "./tokenRuleEngine";
import { earnTokens, type EngineResult } from "./tokenEngine";
import { sumAmountByRuleInWindow, type AnyDbHandle } from "./tokenLedgerService";
import { isWithinSchedule } from "./tokenScheduleService";
import type { TokenRule } from "../../../drizzle/schema";

export type RewardMode = "SIMULATION" | "LIVE";

export interface RewardContext {
  userId: number;
  communityId?: number | null;
  venueId?: number | null;
  eventId?: number | null;
  productId?: number | null;
  amountSpent?: number;
  origin: TokenRule["origin"];
  sourceId?: number | null;
  idempotencyKey?: string | null;
  createdByUserId?: number | null;
  at?: Date;
  /**
   * Fecha de corte opcional (diseño de `loyalty_cutoff_at`, ver informe de
   * fase — no persistido todavía como columna real, se documenta la
   * migración propuesta pero se expone aquí como parámetro explícito por
   * llamada, mismo patrón ya usado por `loyaltyEffectiveFrom` en
   * ticketPurchasePipeline.ts). Una operación anterior a esta fecha nunca
   * genera recompensa, ni en SIMULATION ni en LIVE.
   */
  loyaltyCutoffAt?: Date | null;
}

export type RewardReason =
  | "GRANTED"
  | "CUTOFF_BLOCKED"
  | "OUTSIDE_SCHEDULE"
  | "NO_RULE_FOUND"
  | "RULE_LIMIT_EXCEEDED";

export interface RewardBreakdown {
  base: number;
  recurrenceBonus: number;
  recurrenceRuleId: number | null;
  campaignId: number | null;
  campaignMultiplier: number | null;
  campaignBonus: number | null;
  beforeLimits: number;
  final: number;
}

export interface RewardExplanation {
  eligible: boolean;
  reason: RewardReason;
  ruleId: number | null;
  /** Desglose siempre presente salvo cuando ni siquiera hay regla aplicable (NO_RULE_FOUND) — permite mostrar "esto daría 0 porque el tope diario ya está agotado" en vez de solo un booleano. */
  breakdown: RewardBreakdown | null;
}

export interface RewardResult {
  mode: RewardMode;
  explanation: RewardExplanation;
  /** Solo se rellena en LIVE (inalcanzable esta fase) — referencia real al movimiento de ledger creado. */
  ledgerId: number | null;
}

export class RewardEngineError extends Error {
  constructor(public code: "LIVE_MODE_DISABLED" | "CUTOFF_BLOCKED", message: string) {
    super(message);
    this.name = "RewardEngineError";
  }
}

/**
 * Bloqueo estructural de esta fase (Live Loyalty Design). Ningún flag de
 * entorno, tabla de configuración ni endpoint admin puede poner esto a
 * `true` — requiere editar este literal en un commit futuro explícito,
 * revisado como una decisión de negocio propia, nunca como parte de otra
 * tarea. Ver Decision Gate del informe de fase.
 */
const LIVE_MODE_ENABLED = false as boolean;

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

function isBeforeCutoff(ctx: RewardContext, at: Date): boolean {
  return !!ctx.loyaltyCutoffAt && at < ctx.loyaltyCutoffAt;
}

/**
 * Calcula (sin persistir) exactamente lo que earnTokens() calcularía —
 * mismas reglas/recurrencia/campaña/topes reales activos ahora mismo. Nunca
 * lanza para un resultado de negocio normal (sin regla, fuera de horario,
 * tope agotado) — esos son desenlaces explicables, no errores; solo
 * CUTOFF_BLOCKED se modela igual (desenlace, no excepción) para que
 * SIMULATION nunca necesite un try/catch en el llamador.
 */
async function calculateOnly(ctx: RewardContext, db?: AnyDbHandle): Promise<RewardExplanation> {
  const at = ctx.at ?? new Date();

  if (isBeforeCutoff(ctx, at)) {
    return { eligible: false, reason: "CUTOFF_BLOCKED", ruleId: null, breakdown: null };
  }

  if (ctx.venueId) {
    const allowed = await isWithinSchedule(ctx.venueId, "earn", at, db);
    if (!allowed) return { eligible: false, reason: "OUTSIDE_SCHEDULE", ruleId: null, breakdown: null };
  }

  const rule = await findApplicableRule({
    direction: "earn",
    origin: ctx.origin,
    communityId: ctx.communityId,
    venueId: ctx.venueId,
    eventId: ctx.eventId,
    productId: ctx.productId,
  }, at, db);
  if (!rule) return { eligible: false, reason: "NO_RULE_FOUND", ruleId: null, breakdown: null };

  const base = calculateBaseTokens(rule, { amountSpent: ctx.amountSpent });
  const recurrence = await applyRecurrenceBonus({ userId: ctx.userId, venueId: ctx.venueId, communityId: ctx.communityId, at }, db);
  const campaign = await findApplicableCampaign({ communityId: ctx.communityId, venueId: ctx.venueId, eventId: ctx.eventId, at }, db);

  const afterRecurrence = base + recurrence.bonus;
  const beforeLimits = applyCampaignToAmount(campaign, afterRecurrence);

  let final = beforeLimits;
  if (rule.dailyLimit != null) {
    const earnedToday = await sumAmountByRuleInWindow(ctx.userId, rule.id, "credit", dayStart(at), db);
    final = Math.min(final, Math.max(0, rule.dailyLimit - earnedToday));
  }
  if (rule.monthlyLimit != null) {
    const earnedThisMonth = await sumAmountByRuleInWindow(ctx.userId, rule.id, "credit", monthStart(at), db);
    final = Math.min(final, Math.max(0, rule.monthlyLimit - earnedThisMonth));
  }

  const breakdown: RewardBreakdown = {
    base,
    recurrenceBonus: recurrence.bonus,
    recurrenceRuleId: recurrence.rule?.id ?? null,
    campaignId: campaign?.id ?? null,
    campaignMultiplier: campaign?.multiplier != null ? Number(campaign.multiplier) : null,
    campaignBonus: campaign?.bonusTokens ?? null,
    beforeLimits,
    final,
  };

  if (final <= 0) return { eligible: false, reason: "RULE_LIMIT_EXCEEDED", ruleId: rule.id, breakdown };
  return { eligible: true, reason: "GRANTED", ruleId: rule.id, breakdown };
}

export async function evaluateReward(ctx: RewardContext, mode: RewardMode, db?: AnyDbHandle): Promise<RewardResult> {
  if (mode === "LIVE") {
    if (!LIVE_MODE_ENABLED) {
      throw new RewardEngineError(
        "LIVE_MODE_DISABLED",
        "LIVE LOYALTY sigue desactivado (fase Live Loyalty Design) — evaluateReward() nunca persiste en modo LIVE todavía."
      );
    }
    // Camino real — inalcanzable mientras LIVE_MODE_ENABLED sea false (ver comentario de cabecera).
    const at = ctx.at ?? new Date();
    if (isBeforeCutoff(ctx, at)) {
      throw new RewardEngineError("CUTOFF_BLOCKED", "La operación es anterior al corte de loyalty configurado.");
    }
    const result: EngineResult = await earnTokens({
      userId: ctx.userId,
      communityId: ctx.communityId,
      venueId: ctx.venueId,
      eventId: ctx.eventId,
      productId: ctx.productId,
      amountSpent: ctx.amountSpent,
      origin: ctx.origin,
      sourceId: ctx.sourceId,
      idempotencyKey: ctx.idempotencyKey,
      createdByUserId: ctx.createdByUserId,
      at: ctx.at,
    }, db);
    return {
      mode,
      explanation: {
        eligible: true,
        reason: "GRANTED",
        ruleId: result.breakdown.ruleId,
        breakdown: {
          base: result.breakdown.base,
          recurrenceBonus: result.breakdown.recurrenceBonus,
          recurrenceRuleId: result.breakdown.recurrenceRuleId,
          campaignId: result.breakdown.campaignId,
          campaignMultiplier: result.breakdown.campaignMultiplier,
          campaignBonus: result.breakdown.campaignBonus,
          beforeLimits: result.breakdown.beforeLimits,
          final: result.breakdown.final,
        },
      },
      ledgerId: result.ledger.id,
    };
  }

  const explanation = await calculateOnly(ctx, db);
  return { mode, explanation, ledgerId: null };
}
