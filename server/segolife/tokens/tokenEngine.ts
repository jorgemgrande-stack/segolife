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
 *  10. límites diario/semanal/mensual/lifetime de la regla — RECORTA el
 *      importe final en vez de rechazar la operación completa (ver
 *      drizzle/schema.ts, comentario de token_rules).
 *  10b. presupuesto de campaña (max_total_tokens) — si la campaña aplicada
 *      lo define, recorta al remanente real BAJO LOCK de fila (ver
 *      earnWithCampaignBudgetLock) — protección real de concurrencia, dos
 *      Students no pueden agotar el mismo presupuesto a la vez (Loyalty
 *      Production Hardening, 2026-08-14, spec §12).
 *  11-12. ledger + wallet, atómicamente (postLedgerMovement).
 *
 * El desglose completo (`TokenBreakdown`) se guarda en `token_ledger.metadata`
 * — permite mostrar "Base: 20, Recurrencia: +10, Campaña x2 → 60" sin
 * recalcular nada a posteriori.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and } from "drizzle-orm";
import {
  postLedgerMovement,
  postLedgerMovementInTx,
  sumAmountByRuleInWindow,
  TokenEngineError,
  type AnyDbHandle,
  type PostLedgerMovementInput,
} from "./tokenLedgerService";
import { isWithinSchedule } from "./tokenScheduleService";
import {
  findApplicableRule,
  calculateBaseTokens,
  applyRecurrenceBonus,
  findApplicableCampaign,
  applyCampaignToAmount,
} from "./tokenRuleEngine";
import { tokenCampaigns, tokenLedger, type TokenWallet, type TokenLedgerEntry, type TokenRule } from "../../../drizzle/schema";
import { emitEngagementEvent } from "../engagement/engagementEvents";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

/**
 * GLOBAL LIVE SWITCH real (SegoTokens Live Activation, spec §19) —
 * `earnTokens()` es el ÚNICO punto de entrada real para GANAR tokens (lo
 * usan ticketPurchasePipeline.ts/attendancePipeline.ts/commercePipeline.ts/
 * consumptionQrService.ts/nativeCheckinService.ts — nunca lo reimplementan).
 *
 * HALLAZGO de esta fase: antes de esto, `rewardEngine.ts:LIVE_MODE_ENABLED`
 * NO protegía nada real — solo gateaba `evaluateReward(mode="LIVE")`, una
 * función sin ningún caller en producción (los pipelines reales llaman
 * `earnTokens()` directamente). La ÚNICA protección real, todo este tiempo,
 * era `venue_integrations.loyaltyEnabled` por venue (vía `suppressLoyalty`
 * en cada pipeline) — real, probada, pero única (sin defensa en
 * profundidad). Esta constante es la segunda capa real que pedía el spec:
 * incluso si algún caller futuro olvidara resolver `suppressLoyalty`
 * correctamente, `earnTokens()` sigue exigiendo esta bandera global.
 *
 * Literal en código a propósito (mismo criterio que tenía
 * `LIVE_MODE_ENABLED`, que ahora importa este valor en vez de mantener una
 * bandera propia desconectada) — activar/desactivar LIVE globalmente exige
 * un commit revisado, nunca un toggle de un solo clic. El kill switch
 * RÁPIDO y sin deploy para detener nuevos rewards sigue siendo
 * `venue_integrations.loyaltyEnabled` (instantáneo desde /admin/tokens o
 * integraciones) — apagar UN venue no requiere tocar este literal.
 */
export const LIVE_LOYALTY_ENABLED = true as boolean;

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

/** Semana ISO (lunes-domingo) — mismo criterio exacto que tokenRuleEngine.windowStart("week"), Europe/Madrid implícito vía Date local del proceso (ver docs/SEGOLIFE_BASELINE.md, sin abstracción de timezone dedicada todavía). */
function weekStart(at: Date): Date {
  const d = new Date(at);
  const day = d.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthStart(at: Date): Date {
  const d = new Date(at);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** "Desde siempre" — mismo valor que tokenRuleEngine.windowStart("lifetime"). */
function lifetimeStart(): Date {
  return new Date(0);
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
  if (!LIVE_LOYALTY_ENABLED) {
    throw new TokenEngineError("GLOBAL_LIVE_DISABLED", "LIVE loyalty global está desactivado — ver tokenEngine.ts:LIVE_LOYALTY_ENABLED");
  }

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
  if (rule.weeklyLimit != null) {
    const earnedThisWeek = await sumAmountByRuleInWindow(input.userId, rule.id, "credit", weekStart(at), conn);
    final = Math.min(final, Math.max(0, rule.weeklyLimit - earnedThisWeek));
  }
  if (rule.monthlyLimit != null) {
    const earnedThisMonth = await sumAmountByRuleInWindow(input.userId, rule.id, "credit", monthStart(at), conn);
    final = Math.min(final, Math.max(0, rule.monthlyLimit - earnedThisMonth));
  }
  if (rule.lifetimeLimit != null) {
    const earnedLifetime = await sumAmountByRuleInWindow(input.userId, rule.id, "credit", lifetimeStart(), conn);
    final = Math.min(final, Math.max(0, rule.lifetimeLimit - earnedLifetime));
  }
  if (final <= 0) {
    throw new TokenEngineError("RULE_LIMIT_EXCEEDED", "Se ha alcanzado el límite de esta regla para el periodo actual");
  }

  // El breakdown depende del importe REALMENTE concedido, que solo se conoce
  // con certeza tras el lock de presupuesto de campaña (puede recortar el
  // último momento) — se construye como función para poder insertarse en
  // `token_ledger.metadata` con el valor final correcto, nunca uno provisional.
  const buildBreakdown = (grantedAmount: number): TokenBreakdown => ({
    base,
    recurrenceBonus: recurrence.bonus,
    recurrenceRuleId: recurrence.rule?.id ?? null,
    campaignMultiplier: campaign?.multiplier != null ? Number(campaign.multiplier) : null,
    campaignBonus: campaign?.bonusTokens ?? null,
    campaignId: campaign?.id ?? null,
    beforeLimits,
    final: grantedAmount,
    ruleId: rule.id,
  });
  const buildMovement = (grantedAmount: number): PostLedgerMovementInput => ({
    userId: input.userId,
    direction: "credit",
    amount: grantedAmount,
    reason: rule.name,
    sourceType: input.origin,
    sourceId: input.sourceId ?? null,
    venueId: input.venueId ?? null,
    eventId: input.eventId ?? null,
    ruleId: rule.id,
    campaignId: campaign?.id ?? null,
    idempotencyKey: input.idempotencyKey,
    metadata: buildBreakdown(grantedAmount) as unknown as Record<string, unknown>,
    createdByUserId: input.createdByUserId,
  });

  // Presupuesto de campaña (spec §12) — solo si la campaña aplicada define
  // max_total_tokens. El remanente real y el recorte se calculan DENTRO del
  // lock de fila de la campaña, para que dos Students no puedan agotar el
  // mismo presupuesto a la vez (misma garantía que el lock de wallet).
  const { wallet, ledger } = campaign?.maxTotalTokens != null
    ? await earnWithCampaignBudgetLock(conn, campaign.id, final, buildMovement)
    : await postLedgerMovement(buildMovement(final), conn);

  const breakdown = buildBreakdown(ledger.amount);

  // Communication Center: "tokens_earned" ya existía en el catálogo tipado
  // de engagementEvents.ts pero nunca se emitía (confirmado por auditoría) —
  // mismo patrón que emitEngagementEvent("ticket_purchased", ...) en
  // checkoutService.ts. El listener decide si el monto merece email
  // (política de relevancia), nunca este motor.
  emitEngagementEvent("tokens_earned", {
    userId: input.userId,
    communityId: input.communityId ?? null,
    amount: ledger.amount,
    ledgerId: ledger.id,
    venueId: input.venueId ?? null,
    eventId: input.eventId ?? null,
  });

  return { wallet, ledger, breakdown };
}

/**
 * Presupuesto de campaña con protección real de concurrencia (spec §12) —
 * bloquea la FILA de la campaña (`SELECT...FOR UPDATE`) DENTRO de la misma
 * transacción que calcula el remanente real y escribe el ledger: dos earns
 * que compiten por el mismo presupuesto quedan serializados por MySQL, no
 * por lógica de aplicación (mismo criterio exacto que ya protege
 * token_wallets — nunca se usa Redis ni un contador aparte que pueda
 * desincronizarse). Política de recorte (spec §12, decisión explícita):
 * CLAMP TO REMAINING BUDGET — si el remanente es 7 y el candidato es 10, se
 * conceden 7, nunca se rechaza la operación completa mientras quede margen
 * > 0. Presupuesto agotado (remanente 0) → RULE_LIMIT_EXCEEDED, igual que
 * cualquier otro tope.
 */
async function earnWithCampaignBudgetLock(
  conn: AnyDbHandle,
  campaignId: number,
  candidateAmount: number,
  buildMovement: (grantedAmount: number) => PostLedgerMovementInput
): Promise<{ wallet: TokenWallet; ledger: TokenLedgerEntry }> {
  return conn.transaction(async (tx) => {
    const [lockedCampaign] = await tx.select().from(tokenCampaigns).where(eq(tokenCampaigns.id, campaignId)).limit(1).for("update");
    if (!lockedCampaign || lockedCampaign.maxTotalTokens == null) {
      // Carrera improbable (la campaña se desactivó/perdió presupuesto justo entre el lookup y el lock) — se concede el candidato sin recorte, mismo criterio que "sin campaña".
      return postLedgerMovementInTx(tx, buildMovement(candidateAmount));
    }
    const issuedRows = await tx.select({ amount: tokenLedger.amount }).from(tokenLedger)
      .where(and(eq(tokenLedger.campaignId, campaignId), eq(tokenLedger.direction, "credit")));
    const issued = issuedRows.reduce((sum, r) => sum + r.amount, 0);
    const remaining = Math.max(0, lockedCampaign.maxTotalTokens - issued);
    const granted = Math.min(candidateAmount, remaining);
    if (granted <= 0) {
      throw new TokenEngineError("RULE_LIMIT_EXCEEDED", "Se ha alcanzado el presupuesto total de esta campaña");
    }
    return postLedgerMovementInTx(tx, buildMovement(granted));
  });
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
  // F60 (saneamiento funcional) — semanal/lifetime se comprobaban en earnTokens
  // pero NUNCA en spendTokens, pese a que el formulario de Reglas deja
  // rellenar los 4 límites sin condicionar por dirección: un admin podía
  // configurar "límite semanal de gasto" creyendo que se respetaba y el
  // motor jamás lo miraba. Mismo criterio que dailyLimit/monthlyLimit de
  // gasto (rechaza la operación completa, nunca recorta).
  if (rule.weeklyLimit != null) {
    const spentThisWeek = await sumAmountByRuleInWindow(input.userId, rule.id, "debit", weekStart(at), conn);
    if (spentThisWeek + cost > rule.weeklyLimit) {
      throw new TokenEngineError("RULE_LIMIT_EXCEEDED", "Se ha alcanzado el límite semanal de gasto de esta regla");
    }
  }
  if (rule.monthlyLimit != null) {
    const spentThisMonth = await sumAmountByRuleInWindow(input.userId, rule.id, "debit", monthStart(at), conn);
    if (spentThisMonth + cost > rule.monthlyLimit) {
      throw new TokenEngineError("RULE_LIMIT_EXCEEDED", "Se ha alcanzado el límite mensual de gasto de esta regla");
    }
  }
  if (rule.lifetimeLimit != null) {
    const spentLifetime = await sumAmountByRuleInWindow(input.userId, rule.id, "debit", lifetimeStart(), conn);
    if (spentLifetime + cost > rule.lifetimeLimit) {
      throw new TokenEngineError("RULE_LIMIT_EXCEEDED", "Se ha alcanzado el límite de por vida de gasto de esta regla");
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
