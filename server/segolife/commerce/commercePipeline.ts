/**
 * commercePipeline.ts — ÚNICO punto de entrada para convertir una
 * consumición/operación de venta normalizada (de cualquier proveedor, o de
 * un futuro POS propio con provider='segolife') en `commerce_transactions` +
 * loyalty (Fase 5, puntos 38-43). Igual que attendancePipeline.ts: ningún
 * adapter llama a earnTokens/evaluateBenefitsForOrigin directamente.
 *
 * A diferencia de Attendance, una CommerceTransaction SIEMPRE se crea aunque
 * la identidad no se resuelva (user_id es nullable — spec punto 41: "una
 * operación puede llegar sin usuario Segolife") — el loyalty se procesa
 * cuando se vincula, no antes. `loyalty_processed_at` marca si ya se
 * intentó, evitando doble-procesado si se reprocesa por error.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { commerceTransactions, commerceTransactionItems, type CommerceTransaction } from "../../../drizzle/schema";
import { earnTokens } from "../tokens/tokenEngine";
import { evaluateBenefitsForOrigin } from "../benefits/benefitRuleEngine";
import { emitBenefitGranted, buildBenefitGrantedPayload } from "../benefits/benefitEvents";
import { resolveIdentity, persistIdentityMapping, isConfirmedResolutionMethod } from "../integrations/identityResolver";
import { recordUnresolvedOperation } from "../integrations/unresolvedOperationsService";
import type { NormalizedCommerceTransaction } from "../integrations/externalTicketingProvider";
import { TokenEngineError, reverseTransaction, isLedgerEntryReversed } from "../tokens/tokenLedgerService";
import { resolveLoyaltyCutoff, isBeforeCutoff } from "../tokens/loyaltyCutoffService";
import { buildNextAttempt, shouldAttemptReward, type RewardAttempt, type DenialReasonCode } from "../tokens/rewardStateMachine";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface IngestCommerceTransactionInput {
  provider: string;
  integrationType?: "venue_integration" | "event_integration" | null;
  integrationId?: number | null;
  venueId: number;
  eventId?: number | null;
  communityId?: number | null;
  salesChannelId?: number | null;
  transaction: NormalizedCommerceTransaction;
  externalCustomerId?: string | null;
  /** Fase 8 — POS nativo: el staff ya identificó al estudiante (QR de identidad, ver studentIdentityService.ts) con certeza — se salta resolveIdentity()/persistIdentityMapping() por completo, mismo criterio que attendancePipeline.ts. */
  resolvedUserId?: number | null;
}

export type IngestCommerceResult =
  | { status: "processed_with_loyalty"; transaction: CommerceTransaction }
  | { status: "processed_unresolved"; transaction: CommerceTransaction }
  | { status: "already_exists"; transaction: CommerceTransaction };

function buildIdempotencyKey(input: IngestCommerceTransactionInput): string {
  return `${input.provider}:${input.integrationType ?? "native"}:${input.integrationId ?? 0}:${input.transaction.externalTransactionId}`;
}

function toDenialReason(code: string): DenialReasonCode | null {
  return code === "NO_RULE_FOUND" || code === "RULE_LIMIT_EXCEEDED" || code === "OUTSIDE_SCHEDULE" || code === "GLOBAL_LIVE_DISABLED" ? code : null;
}

/**
 * Procesa loyalty para una transacción YA CREADA con user_id resuelto —
 * llamado tanto en el flujo automático como al vincular manualmente desde
 * /admin/integrations/unresolved (ese segundo camino es, de hecho, el punto
 * de reintento real — spec §5: una denegación temporal en el primer intento
 * ya no queda "fire-once" para siempre, se reevalúa cada vez que esta
 * función se vuelve a llamar sobre la misma fila).
 */
export async function processCommerceLoyalty(transaction: CommerceTransaction, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  if (!transaction.userId || transaction.status !== "confirmed") return;

  const existingAttempt = (transaction.metadata as { rewardAttempt?: RewardAttempt } | null)?.rewardAttempt ?? null;
  if (!shouldAttemptReward(existingAttempt)) return;

  const persistedCutoff = await resolveLoyaltyCutoff(transaction.integrationId ?? null, conn);
  let attempt: RewardAttempt;
  if (isBeforeCutoff(transaction.occurredAt, persistedCutoff)) {
    attempt = { status: "DENIED_PERMANENT", reason: "CUTOFF_BLOCKED", attempts: (existingAttempt?.attempts ?? 0) + 1, lastAttemptAt: transaction.occurredAt.toISOString(), ledgerId: null, generation: existingAttempt?.generation ?? 0, retryable: false };
  } else {
    let outcome: { ledgerId: number | null; reason: DenialReasonCode | null };
    try {
      const tokenResult = await earnTokens({
        userId: transaction.userId,
        communityId: null,
        venueId: transaction.venueId,
        eventId: transaction.eventId,
        amountSpent: transaction.totalCents / 100,
        origin: "consumption",
        sourceId: transaction.id,
        idempotencyKey: `commerce_transaction:${transaction.idempotencyKey}`,
        at: transaction.occurredAt,
      }, conn);
      outcome = { ledgerId: tokenResult.ledger.id, reason: null };
    } catch (err) {
      outcome = { ledgerId: null, reason: err instanceof TokenEngineError ? toDenialReason(err.code) : null };
    }
    attempt = buildNextAttempt(outcome, existingAttempt, transaction.occurredAt);

    // SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6): igual que en
    // attendancePipeline.ts — el resultado se descartaba por completo,
    // así que un Benefit desbloqueado por consumo nunca notificaba al
    // Student. Se emite tras la confirmación real de grantBenefit().
    const unlockedBenefits = await evaluateBenefitsForOrigin({
      type: "consumption",
      userId: transaction.userId,
      venueId: transaction.venueId,
      eventId: transaction.eventId,
      amountCents: transaction.totalCents,
      communityId: null,
      sourceId: transaction.id,
      ledgerId: attempt.ledgerId,
      occurredAt: transaction.occurredAt,
    }, conn).catch(() => []);
    for (const u of unlockedBenefits) emitBenefitGranted(buildBenefitGrantedPayload(u.userBenefit, u.definition));
  }

  await conn.update(commerceTransactions)
    .set({
      loyaltyProcessedAt: new Date(),
      loyaltyLedgerId: attempt.ledgerId,
      metadata: { ...(transaction.metadata ?? {}), rewardAttempt: attempt },
    })
    .where(eq(commerceTransactions.id, transaction.id));
}

export async function ingestCommerceTransaction(input: IngestCommerceTransactionInput, db?: DbHandle): Promise<IngestCommerceResult> {
  const conn = db ?? (await getDb());
  const idempotencyKey = buildIdempotencyKey(input);

  const [existing] = await conn.select().from(commerceTransactions).where(eq(commerceTransactions.idempotencyKey, idempotencyKey)).limit(1);
  if (existing) return { status: "already_exists", transaction: existing };

  const identity = input.resolvedUserId != null
    ? { userId: input.resolvedUserId, method: null }
    : await resolveIdentity({
        provider: input.provider,
        externalCustomerId: input.externalCustomerId,
        participant: null,
        buyer: input.transaction.buyer,
      }, conn);

  const [insertResult] = await conn.insert(commerceTransactions).ignore().values({
    userId: identity.userId,
    venueId: input.venueId,
    eventId: input.eventId ?? null,
    provider: input.provider,
    integrationType: input.integrationType ?? null,
    integrationId: input.integrationId ?? null,
    salesChannelId: input.salesChannelId ?? null,
    externalTransactionId: input.transaction.externalTransactionId,
    status: input.transaction.status,
    subtotalCents: input.transaction.subtotalCents,
    feesCents: input.transaction.feesCents,
    totalCents: input.transaction.totalCents,
    currency: input.transaction.currency,
    paymentMethod: input.transaction.paymentMethod ?? null,
    occurredAt: input.transaction.occurredAt,
    idempotencyKey,
    metadata: {},
  });
  const insertId = (insertResult as unknown as { insertId: number }).insertId;

  if (input.transaction.items.length) {
    await conn.insert(commerceTransactionItems).values(
      input.transaction.items.map(item => ({
        transactionId: insertId,
        venueProductId: item.venueProductId ?? null,
        externalProductId: item.externalProductId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitAmountCents: item.unitAmountCents,
        totalAmountCents: item.totalAmountCents,
      }))
    );
  }

  const [row] = await conn.select().from(commerceTransactions).where(eq(commerceTransactions.id, insertId)).limit(1);

  if (!identity.userId) {
    await recordUnresolvedOperation({
      operationType: "commerce",
      provider: input.provider,
      integrationType: input.integrationType ?? null,
      integrationId: input.integrationId ?? null,
      referenceType: "commerce_transaction",
      referenceId: row.id,
      externalReferenceId: input.transaction.externalTransactionId,
      eventId: input.eventId ?? null,
      venueId: input.venueId,
      occurredAt: input.transaction.occurredAt,
      identityHintEmail: input.transaction.buyer.email ?? null,
      identityHintPhone: input.transaction.buyer.phone ?? null,
      identityHintName: input.transaction.buyer.name ?? null,
      amountCents: input.transaction.totalCents,
    }, conn);
    return { status: "processed_unresolved", transaction: row };
  }

  if (isConfirmedResolutionMethod(identity.method) && identity.method !== "previous_mapping") {
    await persistIdentityMapping({
      provider: input.provider,
      externalCustomerId: input.externalCustomerId,
      participant: null,
      buyer: input.transaction.buyer,
      userId: identity.userId,
      method: identity.method,
    }, conn);
  }

  await processCommerceLoyalty(row, conn);
  const [processedRow] = await conn.select().from(commerceTransactions).where(eq(commerceTransactions.id, insertId)).limit(1);
  return { status: "processed_with_loyalty", transaction: processedRow };
}

// ─── REEMBOLSO (SEGOLIFE — Venue Commerce, Consumption QR & SegoTokens, spec §31-33/§72/§96) ──

export type CommerceErrorCode = "NOT_FOUND" | "INVALID_STATE" | "REASON_REQUIRED";

export class CommerceError extends Error {
  code: CommerceErrorCode;
  constructor(code: CommerceErrorCode, message: string) {
    super(message);
    this.name = "CommerceError";
    this.code = code;
  }
}

export interface RefundCommerceTransactionInput {
  transactionId: number;
  reason: string;
  refundedByUserId: number;
}

export interface RefundCommerceTransactionResult {
  transaction: CommerceTransaction;
  /** false si la transacción nunca llegó a conceder tokens (identidad no resuelta, NO_RULE_FOUND, cutoff...) — no hay nada que revertir, y eso es correcto, no un fallo. */
  tokensReversed: boolean;
}

/**
 * Reembolso de una commerce_transaction CONFIRMADA — venta de POS nativo ya
 * cobrada en efectivo por el venue. Transición atómica confirmed→refunded
 * (UPDATE condicional, mismo patrón que consumptionQrService.ts) seguida de
 * la reversión EXACTA del movimiento de ledger original vía
 * `reverseTransaction()` (Fase 2) — nunca recalculado, se usa
 * `loyaltyLedgerId` ya persistido por `processCommerceLoyalty`. Nunca borra
 * el ledger original, crea una entrada compensatoria; idempotente (una
 * transacción ya `refunded` es INVALID_STATE en el segundo intento, nunca se
 * reinterpreta silenciosamente).
 */
export async function refundCommerceTransaction(input: RefundCommerceTransactionInput, db?: DbHandle): Promise<RefundCommerceTransactionResult> {
  if (!input.reason || !input.reason.trim()) {
    throw new CommerceError("REASON_REQUIRED", "El reembolso requiere un motivo");
  }
  const conn = db ?? (await getDb());

  const [transaction] = await conn.select().from(commerceTransactions).where(eq(commerceTransactions.id, input.transactionId)).limit(1);
  if (!transaction) throw new CommerceError("NOT_FOUND", "Transacción no encontrada");
  if (transaction.status !== "confirmed") {
    throw new CommerceError("INVALID_STATE", `Solo se puede reembolsar una transacción confirmada (estado actual: ${transaction.status})`);
  }

  const [updateResult] = await conn.update(commerceTransactions)
    .set({
      status: "refunded",
      metadata: { ...(transaction.metadata ?? {}), refund: { reason: input.reason, refundedByUserId: input.refundedByUserId, refundedAt: new Date().toISOString() } },
    })
    .where(and(eq(commerceTransactions.id, input.transactionId), eq(commerceTransactions.status, "confirmed")));
  if ((updateResult as unknown as { affectedRows: number }).affectedRows === 0) {
    throw new CommerceError("INVALID_STATE", "La transacción cambió de estado antes de poder reembolsarse");
  }

  let tokensReversed = false;
  if (transaction.loyaltyLedgerId != null && !(await isLedgerEntryReversed(transaction.loyaltyLedgerId, conn))) {
    await reverseTransaction({
      ledgerId: transaction.loyaltyLedgerId,
      reason: `Reembolso de consumición — transacción #${transaction.id}: ${input.reason}`,
      adminUserId: input.refundedByUserId,
    }, conn);
    tokensReversed = true;
  }

  const [refunded] = await conn.select().from(commerceTransactions).where(eq(commerceTransactions.id, input.transactionId)).limit(1);
  return { transaction: refunded, tokensReversed };
}
