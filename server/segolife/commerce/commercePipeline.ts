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
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { commerceTransactions, commerceTransactionItems, type CommerceTransaction } from "../../../drizzle/schema";
import { earnTokens } from "../tokens/tokenEngine";
import { evaluateBenefitsForOrigin } from "../benefits/benefitRuleEngine";
import { resolveIdentity, persistIdentityMapping, isConfirmedResolutionMethod } from "../integrations/identityResolver";
import { recordUnresolvedOperation } from "../integrations/unresolvedOperationsService";
import type { NormalizedCommerceTransaction } from "../integrations/externalTicketingProvider";

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

/** Procesa loyalty para una transacción YA CREADA con user_id resuelto — llamado tanto en el flujo automático como al vincular manualmente desde /admin/integrations/unresolved. */
export async function processCommerceLoyalty(transaction: CommerceTransaction, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  if (transaction.loyaltyProcessedAt || !transaction.userId || transaction.status !== "confirmed") return;

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
  }, conn).catch(() => null);

  await evaluateBenefitsForOrigin({
    type: "consumption",
    userId: transaction.userId,
    venueId: transaction.venueId,
    eventId: transaction.eventId,
    amountCents: transaction.totalCents,
    communityId: null,
    sourceId: transaction.id,
    ledgerId: tokenResult?.ledger.id ?? null,
    occurredAt: transaction.occurredAt,
  }, conn).catch(() => []);

  await conn.update(commerceTransactions)
    .set({ loyaltyProcessedAt: new Date(), loyaltyLedgerId: tokenResult?.ledger.id ?? null })
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
