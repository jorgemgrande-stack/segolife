/**
 * studentRewardPreviewService.ts — SEGOTOKENS REWARD PREVIEW & ECONOMY
 * TRANSPARENCY (Fase 10.6). Read model de solo lectura para que el Student
 * vea, ANTES/DURANTE/DESPUÉS de una acción, qué gana en SegoTokens — sin que
 * el frontend calcule NUNCA una tasa. Este archivo NO reimplementa ninguna
 * fórmula de negocio: cada número sale de una llamada real a
 * `evaluateReward(ctx, "SIMULATION")` (rewardEngine.ts, el mismo motor que ya
 * usa el simulador admin y que reutiliza tokenRuleEngine.ts/tokenEngine.ts —
 * la ÚNICA fuente de verdad). Aquí solo se TRADUCE ese resultado a un formato
 * legible para Student (guaranteed vs conditional, tasa efectiva en texto,
 * valor promocional en €) y se compone en lote para listas (spec §30: N+1-safe).
 *
 * INVARIANTE DE SOLO LECTURA: ninguna función de este archivo llama jamás a
 * earnTokens/spendTokens/postLedgerMovement/reserveTokenSpend ni ninguna
 * mutación — igual que evaluateReward en modo SIMULATION, desplegar este
 * archivo no puede generar ningún hecho económico nuevo.
 *
 * IDENTIDAD: todas las funciones exigen `userId` explícito y SIEMPRE lo
 * resuelve el router desde `ctx.user.id` (nunca desde el input del cliente) —
 * ver server/routers/tokens.ts, procedimientos previewMy*.
 */
import { evaluateReward, type RewardContext, type RewardExplanation } from "./rewardEngine";
import { getTokenRuleById } from "../../db/tokenRulesDb";
import { getTokenCampaignById } from "../../db/tokenCampaignsDb";
import { resolveRedemptionPolicy, tokensToValueCents } from "./tokenSpendService";
import { ensureWallet, type AnyDbHandle } from "./tokenLedgerService";
import type { TokenRule } from "../../../drizzle/schema";

/** Tope duro de items por llamada batch — protege el payload de red y limita
 * cuántas llamadas concurrentes a evaluateReward dispara un solo request (los
 * pools de conexión de tokenRuleEngine.ts/tokenLedgerService.ts ya limitan la
 * concurrencia real hacia MySQL — este tope es sobre el TAMAÑO del lote, no
 * un mecanismo de concurrencia nuevo). */
export const MAX_BATCH_PREVIEW_ITEMS = 24;

export type PreviewOrigin = Extract<
  TokenRule["origin"],
  | "attendance" | "event" | "ticket" | "purchase" | "consumption" | "product" | "recurrence" | "campaign"
  // "community_response"/"community_proposal_approved" (Fase 10.6) — SÍ tienen
  // productor real (communityResponseService.ts llama earnTokens con estos
  // orígenes; producción confirma reglas activas id=8/9) — a diferencia de
  // "enviar una idea nueva" (Proponer), que NUNCA concede nada y por eso no
  // se previsualiza (spec §confirmado 10.5: NOT_CONNECTED solo para el envío,
  // nunca para responder/aprobar).
  | "community_response" | "community_proposal_approved"
>;

export interface StudentPreviewContext {
  userId: number;
  origin: PreviewOrigin;
  venueId?: number | null;
  eventId?: number | null;
  communityId?: number | null;
  amountSpent?: number;
  at?: Date;
}

export interface ConditionalReward {
  actionType: string;
  totalTokens: number;
  eligible: boolean;
  reasonIfNotEligible: string | null;
}

export interface StudentRewardPreview {
  eligible: boolean;
  actionType: PreviewOrigin;
  baseTokens: number;
  campaignTokens: number;
  recurrenceTokens: number;
  totalGuaranteedTokens: number;
  conditionalRewards: ConditionalReward[];
  promotionalValue: { cents: number; formatted: string } | null;
  effectiveRate: string | null;
  /** Código estable (no prosa) — el mismo `RewardReason` de rewardEngine.ts, para que el cliente lo traduzca vía i18n (nunca texto fijo en un solo idioma desde el servidor). */
  explanation: RewardExplanation["reason"];
  campaignLabel: string | null;
  expiresAt: string | null;
  capRemaining: number | null;
  reasonIfNotEligible: string | null;
  /**
   * true cuando la regla que aplicaría es per_euro/percentage/multiplier y no
   * se indicó `amountSpent` — en ese caso `totalGuaranteedTokens` se fuerza a
   * 0 y `eligible` a false para no fabricar un importe falso; el frontend
   * debe mostrar `effectiveRate` (la tasa) en vez de un total. Nunca ocurre
   * con reglas `fixed` (p.ej. asistencia), que no dependen de un importe.
   */
  amountRequired: boolean;
}

function formatEffectiveRate(rule: TokenRule | null): string | null {
  if (!rule) return null;
  switch (rule.calcMethod) {
    case "fixed":
      return `${rule.fixedAmount ?? 0} ST`;
    case "per_euro":
      return `${rule.rate ?? "0"} ST/€`;
    case "percentage":
      return `${rule.rate ?? "0"}%`;
    case "multiplier":
      return `×${rule.multiplier ?? "0"}`;
    default:
      return null;
  }
}

function formatEuros(cents: number): string {
  return `${(cents / 100).toFixed(2)}€`;
}

async function buildSingle(
  ctx: StudentPreviewContext,
  explanation: RewardExplanation,
  db?: AnyDbHandle
): Promise<StudentRewardPreview> {
  // getTokenRuleById/getTokenCampaignById tienen su propio DbHandle local (sin
  // variante de transacción) — nunca se llaman dentro de una transacción de
  // escritura (este archivo es de solo lectura), así que se dejan resolver
  // contra su propio pool en vez de forzar el tipo AnyDbHandle aquí.
  const rule = explanation.ruleId != null ? await getTokenRuleById(explanation.ruleId) : null;
  const amountDependent = rule != null && (rule.calcMethod === "per_euro" || rule.calcMethod === "percentage" || rule.calcMethod === "multiplier");
  const amountRequired = amountDependent && ctx.amountSpent == null;

  const breakdown = explanation.breakdown;
  const campaign = breakdown?.campaignId != null ? await getTokenCampaignById(breakdown.campaignId) : null;

  const totalGuaranteedTokens = amountRequired ? 0 : (breakdown?.final ?? 0);
  const eligible = amountRequired ? false : explanation.eligible;

  let promotionalValue: StudentRewardPreview["promotionalValue"] = null;
  if (totalGuaranteedTokens > 0) {
    const policy = await resolveRedemptionPolicy({ communityId: ctx.communityId, venueId: ctx.venueId, eventId: ctx.eventId }, ctx.at ?? new Date(), db);
    if (policy) {
      const cents = tokensToValueCents(totalGuaranteedTokens, policy);
      promotionalValue = { cents, formatted: formatEuros(cents) };
    }
  }

  const capRemaining = breakdown && breakdown.beforeLimits > breakdown.final ? breakdown.final : null;

  return {
    eligible,
    actionType: ctx.origin,
    baseTokens: breakdown?.base ?? 0,
    campaignTokens: breakdown ? breakdown.beforeLimits - breakdown.base - breakdown.recurrenceBonus : 0,
    recurrenceTokens: breakdown?.recurrenceBonus ?? 0,
    totalGuaranteedTokens,
    conditionalRewards: [],
    promotionalValue,
    effectiveRate: formatEffectiveRate(rule),
    explanation: explanation.reason,
    campaignLabel: campaign?.name ?? null,
    expiresAt: campaign?.endsAt ? campaign.endsAt.toISOString() : null,
    capRemaining,
    reasonIfNotEligible: eligible ? null : (amountRequired ? "NO_RULE_FOUND" : explanation.reason),
    amountRequired,
  };
}

function toRewardContext(ctx: StudentPreviewContext): RewardContext {
  return {
    userId: ctx.userId,
    origin: ctx.origin,
    venueId: ctx.venueId ?? null,
    eventId: ctx.eventId ?? null,
    communityId: ctx.communityId ?? null,
    amountSpent: ctx.amountSpent,
    at: ctx.at,
  };
}

/** Previsualización de una única acción (spec §27) — el Student SIEMPRE es ctx.user.id, nunca un input del cliente. */
export async function previewMyReward(ctx: StudentPreviewContext, db?: AnyDbHandle): Promise<StudentRewardPreview> {
  const result = await evaluateReward(toRewardContext(ctx), "SIMULATION", db);
  return buildSingle(ctx, result.explanation, db);
}

export interface StudentEventPreviewContext {
  userId: number;
  eventId: number;
  venueId?: number | null;
  communityId?: number | null;
  amountSpent?: number;
  at?: Date;
}

/**
 * Compuesto para un evento (spec §31/§32): la recompensa GARANTIZADA de
 * comprar (origin="ticket") nunca se mezcla con la CONDICIONAL de asistir
 * (origin="attendance", solo se concede si el Student valida entrada) — se
 * devuelven en campos estructuralmente distintos para que el frontend NUNCA
 * pueda presentarlas juntas por error.
 */
export async function previewMyEventReward(ctx: StudentEventPreviewContext, db?: AnyDbHandle): Promise<StudentRewardPreview> {
  const guaranteed = await previewMyReward({
    userId: ctx.userId, origin: "ticket", venueId: ctx.venueId, eventId: ctx.eventId, communityId: ctx.communityId,
    amountSpent: ctx.amountSpent, at: ctx.at,
  }, db);

  const attendanceResult = await evaluateReward(toRewardContext({
    userId: ctx.userId, origin: "attendance", venueId: ctx.venueId, eventId: ctx.eventId, communityId: ctx.communityId, at: ctx.at,
  }), "SIMULATION", db);
  const attendancePreview = await buildSingle(
    { userId: ctx.userId, origin: "attendance", venueId: ctx.venueId, eventId: ctx.eventId, communityId: ctx.communityId, at: ctx.at },
    attendanceResult.explanation,
    db
  );

  const conditionalRewards: ConditionalReward[] = attendancePreview.totalGuaranteedTokens > 0 || attendancePreview.eligible
    ? [{
        actionType: "attendance",
        totalTokens: attendancePreview.totalGuaranteedTokens,
        eligible: attendancePreview.eligible,
        reasonIfNotEligible: attendancePreview.reasonIfNotEligible,
      }]
    : [];

  return { ...guaranteed, conditionalRewards };
}

export interface BatchPreviewItem {
  key: string;
  origin: PreviewOrigin;
  venueId?: number | null;
  eventId?: number | null;
  communityId?: number | null;
  amountSpent?: number;
}

/** Lote genérico (spec §30) — colapsa N cards en 1 request de red; internamente sigue llamando al MISMO motor por item, nunca una fórmula batch paralela. */
export async function previewMyRewardBatch(
  userId: number,
  items: BatchPreviewItem[],
  db?: AnyDbHandle
): Promise<Record<string, StudentRewardPreview>> {
  const bounded = items.slice(0, MAX_BATCH_PREVIEW_ITEMS);
  const results = await Promise.all(bounded.map(item =>
    previewMyReward({ userId, origin: item.origin, venueId: item.venueId, eventId: item.eventId, communityId: item.communityId, amountSpent: item.amountSpent }, db)
      .then(preview => [item.key, preview] as const)
  ));
  return Object.fromEntries(results);
}

export interface BatchEventPreviewItem {
  key: string;
  eventId: number;
  venueId?: number | null;
  communityId?: number | null;
  amountSpent?: number;
}

/** Lote de eventos (spec §30/§31) — usado por tarjetas de evento en listas (Explore/Home), guaranteed+conditional por evento. */
export interface WalletPromotionalValue {
  balance: number;
  promotionalValue: { cents: number; formatted: string } | null;
}

/**
 * "¿Cuánto vale mi saldo?" (spec §35, Wallet) — SIEMPRE la política de canje
 * GLOBAL (sin venue/evento concreto, porque el saldo no está atado a
 * ninguno) resuelta por la MISMA `resolveRedemptionPolicy`/`tokensToValueCents`
 * que ya usa Universal Spend — nunca una tasa aparte inventada para Wallet.
 */
export async function previewMyWalletValue(userId: number, db?: AnyDbHandle): Promise<WalletPromotionalValue> {
  const wallet = await ensureWallet(userId);
  const policy = await resolveRedemptionPolicy({}, new Date(), db);
  const promotionalValue = policy && wallet.balance > 0
    ? { cents: tokensToValueCents(wallet.balance, policy), formatted: formatEuros(tokensToValueCents(wallet.balance, policy)) }
    : null;
  return { balance: wallet.balance, promotionalValue };
}

export async function previewMyEventRewardBatch(
  userId: number,
  items: BatchEventPreviewItem[],
  db?: AnyDbHandle
): Promise<Record<string, StudentRewardPreview>> {
  const bounded = items.slice(0, MAX_BATCH_PREVIEW_ITEMS);
  const results = await Promise.all(bounded.map(item =>
    previewMyEventReward({ userId, eventId: item.eventId, venueId: item.venueId, communityId: item.communityId, amountSpent: item.amountSpent }, db)
      .then(preview => [item.key, preview] as const)
  ));
  return Object.fromEntries(results);
}
