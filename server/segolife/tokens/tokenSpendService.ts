/**
 * tokenSpendService.ts — SEGOLIFE SEGOTOKENS UNIVERSAL SPEND & MIXED
 * PAYMENTS (Fase 7). Motor ÚNICO para aplicar SegoTokens directamente
 * contra el precio de una transacción monetaria real (evento/puerta/
 * consumo) — DISTINTO de benefitPurchaseService.ts (ST → adquirir un
 * Benefit, sin precio monetario de por medio, sin tocar este archivo).
 *
 * NO reutiliza `spendTokens()` (tokenEngine.ts) — su modelo de coste está
 * anclado a `token_rules` con alcance venue+producto ("este producto cuesta
 * N tokens"), no al modelo real aquí ("aplica hasta N tokens contra ESTE
 * precio bruto, sea cual sea"). En su lugar se llama a
 * `postLedgerMovementInTx` directamente — el mismo primitivo atómico que
 * `benefitPurchaseService.ts` ya usa por el mismo motivo (ver su cabecera).
 *
 * CICLO DE VIDA (spec §2/§15): RESERVED → CAPTURED (mueve el ledger de
 * verdad) | RELEASED | EXPIRED | REVERSED (post-captura). Reservar NUNCA
 * toca el ledger — solo resta del saldo disponible de futuras reservas
 * (countActiveReservedTokens), dentro de la MISMA transacción que bloquea
 * la fila de token_wallets vía FOR UPDATE (mismo patrón exacto que
 * postLedgerMovementInTx) — así dos reservas concurrentes del mismo wallet
 * quedan serializadas por MySQL, nunca por lectura-luego-escritura en
 * memoria. El ledger solo se mueve al CAPTURAR — un pago externo fallido
 * nunca necesita revertir nada del ledger, solo liberar la reserva.
 *
 * DINERO: siempre céntimos enteros. TASA: ratio entero
 * (tokensPerUnit/valueCentsPerUnit), nunca float — ver
 * drizzle/schema.ts, comentario de token_redemption_policies.
 */
import { eq, and, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  tokenRedemptionPolicies, tokenSpendReservations, tokenWallets,
  type TokenRedemptionPolicy, type TokenSpendReservation,
} from "../../../drizzle/schema";
import { postLedgerMovementInTx, reverseTransaction, type AnyDbHandle } from "./tokenLedgerService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];

async function getDb(): Promise<DbHandle> {
  return _db;
}

export const RESERVATION_TTL_MINUTES = 15;
export const UNIVERSAL_SPEND_SOURCE_TYPE = "universal_spend";

export type TokenSpendErrorCode =
  | "NO_POLICY" | "INVALID_AMOUNT" | "NOT_FOUND" | "ALREADY_CAPTURED" | "ALREADY_RELEASED"
  | "ALREADY_REVERSED" | "INVALID_STATE" | "RESERVATION_EXPIRED" | "INSUFFICIENT_BALANCE" | "REASON_REQUIRED";

export class TokenSpendError extends Error {
  code: TokenSpendErrorCode;
  constructor(code: TokenSpendErrorCode, message: string) {
    super(message);
    this.name = "TokenSpendError";
    this.code = code;
  }
}

// ─── 1. RESOLUCIÓN DE POLÍTICA (spec §5/§6) ─────────────────────────────────
// A diferencia de benefit_rules (TODAS las que encajan aplican, aditivo),
// aquí gana LA MÁS ESPECÍFICA — una sola política aplica, nunca varias.
// Especificidad = nº de campos de alcance no-nulos que coinciden
// (event > venue > community > global). Empate → priority explícito, luego
// id (determinista, nunca ambiguo).

export interface PolicyContext {
  communityId?: number | null;
  venueId?: number | null;
  eventId?: number | null;
}

function policySpecificity(p: TokenRedemptionPolicy): number {
  return (p.eventId != null ? 1 : 0) + (p.venueId != null ? 1 : 0) + (p.communityId != null ? 1 : 0);
}

function policyMatchesContext(p: TokenRedemptionPolicy, ctx: PolicyContext, at: Date): boolean {
  if (!p.active) return false;
  if (p.startsAt && p.startsAt > at) return false;
  if (p.endsAt && p.endsAt < at) return false;
  if (p.eventId != null && p.eventId !== ctx.eventId) return false;
  if (p.venueId != null && p.venueId !== ctx.venueId) return false;
  if (p.communityId != null && p.communityId !== ctx.communityId) return false;
  return true;
}

export async function resolveRedemptionPolicy(ctx: PolicyContext, at: Date = new Date(), db?: AnyDbHandle): Promise<TokenRedemptionPolicy | null> {
  const conn = db ?? (await getDb());
  const rows = await conn.select().from(tokenRedemptionPolicies).where(eq(tokenRedemptionPolicies.active, true));
  const candidates = rows.filter(p => policyMatchesContext(p, ctx, at));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const specDiff = policySpecificity(b) - policySpecificity(a);
    if (specDiff !== 0) return specDiff;
    const prioDiff = b.priority - a.priority;
    if (prioDiff !== 0) return prioDiff;
    return a.id - b.id;
  });
  return candidates[0];
}

// ─── 2. VALORACIÓN — ratio entero, nunca float (spec §12) ──────────────────

/**
 * Exportada (Fase 10.6, spec §27) — studentRewardPreviewService.ts la reutiliza
 * TAL CUAL para traducir "cuánto vas a ganar" a "cuánto vale eso en €" en el
 * read model de Student, sin reimplementar esta fórmula en ningún otro sitio.
 * Trunca siempre — nunca da más valor promocional del matemáticamente permitido.
 */
export function tokensToValueCents(tokens: number, policy: Pick<TokenRedemptionPolicy, "tokensPerUnit" | "valueCentsPerUnit">): number {
  return Math.floor((tokens * policy.valueCentsPerUnit) / policy.tokensPerUnit);
}
/** El MAYOR nº de tokens cuyo valor NO supera maxValueCents — inverso de tokensToValueCents, también conservador. */
function maxTokensForValueCents(maxValueCents: number, policy: Pick<TokenRedemptionPolicy, "tokensPerUnit" | "valueCentsPerUnit">): number {
  return Math.floor((maxValueCents * policy.tokensPerUnit) / policy.valueCentsPerUnit);
}

async function countActiveReservedTokens(userId: number, conn: AnyDbHandle): Promise<number> {
  const rows = await conn.select({ tokens: tokenSpendReservations.tokensReserved }).from(tokenSpendReservations)
    .where(and(
      eq(tokenSpendReservations.userId, userId),
      eq(tokenSpendReservations.status, "reserved"),
      gt(tokenSpendReservations.expiresAt, new Date())
    ));
  return rows.reduce((sum, r) => sum + r.tokens, 0);
}

export interface QuoteInput {
  userId: number;
  venueId?: number | null;
  eventId?: number | null;
  communityId?: number | null;
  grossAmountCents: number;
  requestedTokens: number;
}

export type TokenSpendQuote =
  | { eligible: false; reason: "NO_POLICY" | "INVALID_AMOUNT" }
  | {
      eligible: true;
      policy: TokenRedemptionPolicy;
      availableBalance: number;
      maxRedeemableTokens: number;
      tokensToSpend: number;
      grossAmountCents: number;
      promotionalValueCents: number;
      moneyDueCents: number;
    };

/** Cálculo puro (spec §11/§12) dado un saldo/reservado ya resuelto — compartido por quoteTokenSpend (lectura suelta, para previsualizar) y reserveTokenSpend (bajo lock, para comprometer). */
function computeAllocation(policy: TokenRedemptionPolicy, availableBalance: number, input: Pick<QuoteInput, "grossAmountCents" | "requestedTokens">): TokenSpendQuote {
  const effectiveMaxPercentage = policy.allowFullTokenPayment ? 100 : (policy.maxPercentage ?? 100);
  const percentageCapCents = Math.floor((input.grossAmountCents * effectiveMaxPercentage) / 100);
  const maxByPercentage = maxTokensForValueCents(percentageCapCents, policy);
  const maxByPolicyCap = policy.maxTokenSpend ?? Number.MAX_SAFE_INTEGER;

  const maxRedeemableTokens = Math.max(0, Math.min(maxByPercentage, maxByPolicyCap, availableBalance));

  let tokensToSpend = Math.max(0, Math.min(input.requestedTokens, maxRedeemableTokens));
  if (policy.minTokenSpend != null && tokensToSpend > 0 && tokensToSpend < policy.minTokenSpend) {
    tokensToSpend = 0; // no alcanza el mínimo configurado — nunca se redondea al alza sin que el Student lo pidiera
  }

  const promotionalValueCents = Math.min(tokensToValueCents(tokensToSpend, policy), input.grossAmountCents); // nunca supera el bruto (defensivo, spec §11)
  const moneyDueCents = Math.max(0, input.grossAmountCents - promotionalValueCents);

  return {
    eligible: true, policy, availableBalance, maxRedeemableTokens, tokensToSpend,
    grossAmountCents: input.grossAmountCents, promotionalValueCents, moneyDueCents,
  };
}

/**
 * Punto de entrada de solo lectura (spec §3) — nunca escribe nada, puede
 * llamarse repetidamente para previsualizar (checkout UI). El servidor
 * NUNCA confía en un quote que el cliente haya guardado — reserveTokenSpend
 * vuelve a calcular esto mismo bajo lock, nunca acepta un quote ya hecho.
 */
export async function quoteTokenSpend(input: QuoteInput, db?: AnyDbHandle): Promise<TokenSpendQuote> {
  if (!Number.isInteger(input.grossAmountCents) || input.grossAmountCents < 0) return { eligible: false, reason: "INVALID_AMOUNT" };
  const conn = db ?? (await getDb());
  const policy = await resolveRedemptionPolicy({ venueId: input.venueId, eventId: input.eventId, communityId: input.communityId }, new Date(), conn);
  if (!policy) return { eligible: false, reason: "NO_POLICY" };

  const [wallet] = await conn.select({ balance: tokenWallets.balance }).from(tokenWallets).where(eq(tokenWallets.userId, input.userId)).limit(1);
  const reservedTotal = await countActiveReservedTokens(input.userId, conn);
  const availableBalance = Math.max(0, (wallet?.balance ?? 0) - reservedTotal);

  return computeAllocation(policy, availableBalance, input);
}

// ─── 3. RESERVA (spec §14/§15/§16) ──────────────────────────────────────────

export interface ReserveTokenSpendInput extends QuoteInput {
  referenceType: string;
  referenceId?: number | null;
  idempotencyKey: string;
  createdByUserId?: number | null;
}

export type ReserveTokenSpendResult =
  | { status: "reserved"; reservation: TokenSpendReservation }
  | { status: "no_policy" }
  | { status: "invalid_amount" };

async function reserveTokenSpendInTx(tx: TxHandle, input: ReserveTokenSpendInput): Promise<ReserveTokenSpendResult> {
  const [existing] = await tx.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing) return { status: "reserved", reservation: existing };

  const policy = await resolveRedemptionPolicy({ venueId: input.venueId, eventId: input.eventId, communityId: input.communityId }, new Date(), tx);
  if (!policy) return { status: "no_policy" };
  if (!Number.isInteger(input.grossAmountCents) || input.grossAmountCents < 0) return { status: "invalid_amount" };

  // Lock de la fila del wallet — mismo patrón exacto que postLedgerMovementInTx
  // (spec §14 CRITICAL): serializa dos reservas concurrentes del mismo Student,
  // nunca lectura-luego-escritura sin protección.
  let [wallet] = await tx.select().from(tokenWallets).where(eq(tokenWallets.userId, input.userId)).limit(1).for("update");
  if (!wallet) {
    await tx.insert(tokenWallets).values({ userId: input.userId });
    [wallet] = await tx.select().from(tokenWallets).where(eq(tokenWallets.userId, input.userId)).limit(1).for("update");
  }
  const reservedTotal = await countActiveReservedTokens(input.userId, tx);
  const availableBalance = Math.max(0, wallet.balance - reservedTotal);

  const allocation = computeAllocation(policy, availableBalance, input);
  if (!allocation.eligible) return { status: "invalid_amount" };

  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);
  const [insertResult] = await tx.insert(tokenSpendReservations).values({
    userId: input.userId,
    walletId: wallet.id,
    policyId: policy.id,
    venueId: input.venueId ?? null,
    eventId: input.eventId ?? null,
    communityId: input.communityId ?? null,
    referenceType: input.referenceType,
    referenceId: input.referenceId ?? null,
    grossAmountCents: allocation.grossAmountCents,
    tokensReserved: allocation.tokensToSpend,
    promotionalValueCents: allocation.promotionalValueCents,
    moneyDueCents: allocation.moneyDueCents,
    status: "reserved",
    idempotencyKey: input.idempotencyKey,
    expiresAt,
    createdByUserId: input.createdByUserId ?? null,
  });
  const insertId = (insertResult as unknown as { insertId: number }).insertId;
  const [reservation] = await tx.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.id, insertId)).limit(1);
  return { status: "reserved", reservation };
}

export async function reserveTokenSpend(input: ReserveTokenSpendInput, db?: AnyDbHandle): Promise<ReserveTokenSpendResult> {
  const conn = (db ?? (await getDb())) as DbHandle;
  return conn.transaction(tx => reserveTokenSpendInTx(tx, input));
}

// ─── 4. CAPTURA (spec §17/§26) — mueve el ledger de verdad, una sola vez ───

export interface CaptureTokenSpendResult {
  reservation: TokenSpendReservation;
  alreadyCaptured: boolean;
}

async function captureTokenSpendInTx(tx: TxHandle, reservationId: number): Promise<CaptureTokenSpendResult> {
  const [reservation] = await tx.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.id, reservationId)).limit(1).for("update");
  if (!reservation) throw new TokenSpendError("NOT_FOUND", "Reserva no encontrada");
  if (reservation.status === "captured") return { reservation, alreadyCaptured: true }; // idempotente
  if (reservation.status !== "reserved") throw new TokenSpendError("INVALID_STATE", `No se puede capturar una reserva en estado '${reservation.status}'`);
  if (reservation.expiresAt.getTime() < Date.now()) throw new TokenSpendError("RESERVATION_EXPIRED", "La reserva ha expirado");

  let ledgerId: number | null = null;
  if (reservation.tokensReserved > 0) {
    const { ledger } = await postLedgerMovementInTx(tx, {
      userId: reservation.userId,
      direction: "debit",
      amount: reservation.tokensReserved,
      reason: `SegoTokens aplicados — ${reservation.referenceType}${reservation.referenceId != null ? ` #${reservation.referenceId}` : ""}`,
      sourceType: UNIVERSAL_SPEND_SOURCE_TYPE,
      sourceId: reservation.id,
      venueId: reservation.venueId,
      eventId: reservation.eventId,
      idempotencyKey: `token_spend_capture:${reservation.id}`,
    });
    ledgerId = ledger.id;
  }

  await tx.update(tokenSpendReservations).set({ status: "captured", ledgerId, capturedAt: new Date() }).where(eq(tokenSpendReservations.id, reservation.id));
  const [updated] = await tx.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.id, reservation.id)).limit(1);
  return { reservation: updated, alreadyCaptured: false };
}

export async function captureTokenSpend(reservationId: number, db?: AnyDbHandle): Promise<CaptureTokenSpendResult> {
  const conn = (db ?? (await getDb())) as DbHandle;
  return conn.transaction(tx => captureTokenSpendInTx(tx, reservationId));
}

// ─── 5. LIBERACIÓN (spec §16/§30) — idempotente, sin efecto en el ledger ───

async function releaseTokenSpendInTx(tx: TxHandle, reservationId: number, reason: string): Promise<TokenSpendReservation> {
  const [reservation] = await tx.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.id, reservationId)).limit(1).for("update");
  if (!reservation) throw new TokenSpendError("NOT_FOUND", "Reserva no encontrada");
  if (reservation.status === "released" || reservation.status === "expired") return reservation; // idempotente
  if (reservation.status !== "reserved") throw new TokenSpendError("INVALID_STATE", `No se puede liberar una reserva en estado '${reservation.status}'`);

  await tx.update(tokenSpendReservations).set({ status: "released", releasedAt: new Date() }).where(eq(tokenSpendReservations.id, reservationId));
  const [updated] = await tx.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.id, reservationId)).limit(1);
  void reason; // motivo solo para logs/observabilidad — la reserva no persiste el porqué de la liberación
  return updated;
}

export async function releaseTokenSpend(reservationId: number, reason: string, db?: AnyDbHandle): Promise<TokenSpendReservation> {
  const conn = (db ?? (await getDb())) as DbHandle;
  return conn.transaction(tx => releaseTokenSpendInTx(tx, reservationId, reason));
}

// ─── 6. REVERSIÓN (spec §27/§29) — solo sobre reservas ya CAPTURADAS ───────
// Reutiliza reverseTransaction() del ledger (nunca earn, nunca dispara
// recurrencia/campañas — sourceType='reversal' allí, ver tokenLedgerService.ts).

export interface ReverseTokenSpendInput {
  reservationId: number;
  reason: string;
  adminUserId: number | null;
}

async function reverseTokenSpendInTx(tx: TxHandle, input: ReverseTokenSpendInput): Promise<TokenSpendReservation> {
  if (!input.reason || !input.reason.trim()) throw new TokenSpendError("REASON_REQUIRED", "La reversión requiere un motivo");
  const [reservation] = await tx.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.id, input.reservationId)).limit(1).for("update");
  if (!reservation) throw new TokenSpendError("NOT_FOUND", "Reserva no encontrada");
  if (reservation.status === "reversed") return reservation; // idempotente
  if (reservation.status !== "captured") throw new TokenSpendError("INVALID_STATE", `No se puede revertir una reserva en estado '${reservation.status}'`);

  let reversalLedgerId: number | null = null;
  if (reservation.ledgerId != null) {
    const { ledger } = await reverseTransaction({ ledgerId: reservation.ledgerId, reason: input.reason, adminUserId: input.adminUserId }, tx);
    reversalLedgerId = ledger.id;
  }
  await tx.update(tokenSpendReservations).set({ status: "reversed", reversalLedgerId, reversedAt: new Date() }).where(eq(tokenSpendReservations.id, input.reservationId));
  const [updated] = await tx.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.id, input.reservationId)).limit(1);
  return updated;
}

export async function reverseTokenSpend(input: ReverseTokenSpendInput, db?: AnyDbHandle): Promise<TokenSpendReservation> {
  const conn = (db ?? (await getDb())) as DbHandle;
  return conn.transaction(tx => reverseTokenSpendInTx(tx, input));
}

// ─── 7. RESERVA + CAPTURA ATÓMICA (spec §2: flujos inmediatos/staff-confirmados) ──
// Para operaciones donde el staff ya presenció el cobro del dinero restante
// en el momento (POS/puerta) — reserva y captura en la MISMA transacción, sin
// dejar una ventana "reservado pero no capturado" que nadie va a resolver.

export async function reserveAndCaptureTokenSpend(input: ReserveTokenSpendInput, db?: AnyDbHandle): Promise<ReserveTokenSpendResult | CaptureTokenSpendResult> {
  const conn = (db ?? (await getDb())) as DbHandle;
  return conn.transaction(async (tx) => {
    const reserved = await reserveTokenSpendInTx(tx, input);
    if (reserved.status !== "reserved") return reserved;
    return captureTokenSpendInTx(tx, reserved.reservation.id);
  });
}

export type { TokenRedemptionPolicy, TokenSpendReservation };
