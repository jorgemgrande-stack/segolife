/**
 * refundOrchestrator.ts — SEGOLIFE COMMERCE CORE (Fase 9, spec §20-22/§55/
 * §59). Punto de entrada ÚNICO para "reembolsar algo" desde el admin — pero
 * NUNCA reimplementa la reversión real: cada dominio (`commerce_transactions`,
 * `ticket_orders`/venta de puerta) conserva su propio servicio de reversión
 * ya existente y probado (spec §55: "Commerce orchestrates; domain services
 * perform domain-safe reversals"). Esta capa aporta dos cosas que NO
 * existían antes de esta fase:
 *
 *  1. REEMBOLSO PARCIAL determinista para ventas de POS (spec §21) — línea
 *     a línea, la unidad de reembolso más pequeña que ya existe en el
 *     modelo (`commerce_transaction_items.quantity`). Política documentada
 *     explícitamente (spec: "document exact algorithm"): el importe
 *     monetario SIEMPRE se calcula y libera proporcionalmente al momento;
 *     los SegoTokens aplicados y la recompensa de compra SOLO se revierten
 *     cuando el reembolso acumulado alcanza el 100% de la venta — no existe
 *     ningún primitivo seguro para revertir una FRACCIÓN de una reserva de
 *     SegoTokens ya capturada (`tokenSpendService.reverseTokenSpend` es
 *     todo-o-nada por diseño, Fase 7), así que nunca se improvisa aritmética
 *     de ledger parcial nueva.
 *  2. UN FEED ÚNICO auditable de "reembolsos reales" (`commerce_refunds`,
 *     spec §59 "Refunds View") — ni commerce_transactions ni ticket_orders
 *     guardan un histórico de CADA reembolso, solo su estado actual.
 *
 * Reembolso de entradas online (`ticket_orders` no-puerta) sigue usando
 * `ticketCancellationService.refundOrder` sin cambios (spec §55) — esta
 * fase NO añade reembolso parcial a nivel de unidad de entrada individual
 * (limitación documentada en el informe final, spec permite PARTIAL en la
 * gate de REFUNDS).
 */
import { eq, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  commerceTransactions, commerceTransactionItems, commerceRefunds,
  type CommerceTransaction, type InsertCommerceRefund,
} from "../../../drizzle/schema";
import { reverseTransaction, isLedgerEntryReversed } from "../tokens/tokenLedgerService";
import { reverseTokenSpend } from "../tokens/tokenSpendService";
import { emitEngagementEvent } from "../engagement/engagementEvents";
import { recordRefundRestock } from "../stock/stockService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class RefundOrchestratorError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "RefundOrchestratorError";
  }
}

/** Idempotente por idempotencyKey (spec §22) — un mismo reembolso reintentado (doble clic admin, retry de red) nunca duplica el registro de auditoría. Nunca es la fuente de verdad del reembolso en sí (esa es commerce_transactions/ticket_orders/event_tickets, ya revertidos por su propio dominio antes de llamar aquí). */
export async function recordCommerceRefund(input: Omit<InsertCommerceRefund, "id" | "createdAt">, db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.insert(commerceRefunds).ignore().values(input);
}

// ─── POS (commerce_transactions) — reembolso total o parcial por línea ──────

export interface RefundPosLine {
  itemId: number;
  quantity: number;
}

export interface RefundPosSaleInput {
  transactionId: number;
  lines: RefundPosLine[];
  reason: string;
  refundedByUserId: number;
  /** SEGOLIFE — FASE 10 (spec §33): "Refund does NOT always mean stock physically returned" — el operador decide explícitamente, nunca automático. false por defecto (producto consumido, ej. una bebida ya servida). */
  restock?: boolean;
}

export interface RefundPosSaleResult {
  transaction: CommerceTransaction;
  refundedAmountCents: number;
  isFullRefund: boolean;
  tokensReversed: boolean;
  purchaseRewardReversed: boolean;
}

export async function refundPosSale(input: RefundPosSaleInput, db?: DbHandle): Promise<RefundPosSaleResult> {
  if (!input.reason || !input.reason.trim()) throw new RefundOrchestratorError("REASON_REQUIRED", "El reembolso requiere un motivo");
  if (!input.lines.length) throw new RefundOrchestratorError("EMPTY_LINES", "No se ha seleccionado ninguna línea a reembolsar");
  const conn = db ?? (await getDb());

  return conn.transaction(async (tx) => {
    const [transaction] = await tx.select().from(commerceTransactions).where(eq(commerceTransactions.id, input.transactionId)).limit(1).for("update");
    if (!transaction) throw new RefundOrchestratorError("NOT_FOUND", "Transacción no encontrada");
    if (transaction.status !== "confirmed" && transaction.status !== "partially_refunded") {
      throw new RefundOrchestratorError("INVALID_STATE", `Solo se puede reembolsar una transacción confirmada o ya parcialmente reembolsada (estado actual: ${transaction.status})`);
    }

    const items = await tx.select().from(commerceTransactionItems).where(eq(commerceTransactionItems.transactionId, input.transactionId));
    const itemById = new Map(items.map(i => [i.id, i]));

    let refundAmountCents = 0;
    for (const line of input.lines) {
      const item = itemById.get(line.itemId);
      if (!item || item.transactionId !== input.transactionId) throw new RefundOrchestratorError("INVALID_LINE", `Línea ${line.itemId} no pertenece a esta transacción`);
      const remaining = item.quantity - item.refundedQuantity;
      if (line.quantity < 1 || line.quantity > remaining) {
        throw new RefundOrchestratorError("INVALID_QUANTITY", `Cantidad no válida para "${item.description}" (quedan ${remaining} por reembolsar)`);
      }
      refundAmountCents += line.quantity * item.unitAmountCents;
    }

    for (const line of input.lines) {
      await tx.update(commerceTransactionItems)
        .set({ refundedQuantity: sql`${commerceTransactionItems.refundedQuantity} + ${line.quantity}` })
        .where(eq(commerceTransactionItems.id, line.itemId));
    }

    if (input.restock) {
      // `key` usa el refundedQuantity PRE-actualización de cada línea (leído
      // arriba, antes del UPDATE de este bloque) — único por evento de
      // reembolso, estable si esta misma llamada se reintenta (spec §22).
      const restockLines = input.lines
        .map(line => {
          const item = itemById.get(line.itemId);
          return item?.venueProductId != null
            ? { venueProductId: item.venueProductId, quantity: line.quantity, key: `${item.id}:${item.refundedQuantity}:${line.quantity}` }
            : null;
        })
        .filter((l): l is { venueProductId: number; quantity: number; key: string } => l != null);
      if (restockLines.length) {
        await recordRefundRestock(restockLines, transaction.venueId, "commerce_transaction", transaction.id, input.refundedByUserId, tx);
      }
    }

    const newRefundedTotal = transaction.refundedAmountCents + refundAmountCents;
    const isFullRefund = newRefundedTotal >= transaction.totalCents;

    await tx.update(commerceTransactions).set({
      refundedAmountCents: newRefundedTotal,
      status: isFullRefund ? "refunded" : "partially_refunded",
      metadata: {
        ...(transaction.metadata ?? {}),
        lastRefund: { reason: input.reason, refundedByUserId: input.refundedByUserId, refundedAt: new Date().toISOString(), amountCents: refundAmountCents, isFullRefund },
      },
    }).where(eq(commerceTransactions.id, input.transactionId));

    // SegoTokens/recompensa de compra: SOLO se revierten cuando el
    // reembolso acumulado cubre el 100% de la venta (política documentada
    // en la cabecera de este archivo) — nunca una reversión parcial
    // improvisada de una reserva ya capturada.
    let tokensReversed = false;
    let purchaseRewardReversed = false;
    if (isFullRefund) {
      if (transaction.loyaltyLedgerId != null && !(await isLedgerEntryReversed(transaction.loyaltyLedgerId, tx))) {
        await reverseTransaction({ ledgerId: transaction.loyaltyLedgerId, reason: `Reembolso de consumición — transacción #${transaction.id}: ${input.reason}`, adminUserId: input.refundedByUserId }, tx);
        purchaseRewardReversed = true;
      }
      if (transaction.tokenReservationId != null) {
        await reverseTokenSpend({ reservationId: transaction.tokenReservationId, reason: `Reembolso de consumición — transacción #${transaction.id}: ${input.reason}`, adminUserId: input.refundedByUserId }, tx);
        tokensReversed = true;
      }
    }

    await recordCommerceRefund({
      sourceType: "commerce_transaction",
      sourceId: transaction.id,
      venueId: transaction.venueId,
      eventId: transaction.eventId,
      userId: transaction.userId,
      amountCents: refundAmountCents,
      tokensRestored: 0, // el importe exacto de tokens ya vive en token_spend_reservations; aquí solo se audita si se revirtió (tokensReversed)
      moneyRefundStatus: "completed", // venta de POS SIEMPRE confirmada en efectivo por staff — nunca dependía de un PaymentProvider
      reason: input.reason,
      partial: !isFullRefund,
      refundedByUserId: input.refundedByUserId,
      idempotencyKey: `pos_refund:${transaction.id}:${Date.now()}`,
    }, tx);

    const [refreshed] = await tx.select().from(commerceTransactions).where(eq(commerceTransactions.id, input.transactionId)).limit(1);

    if (refreshed.userId) {
      emitEngagementEvent("order_refunded", { userId: refreshed.userId, communityId: null, orderId: refreshed.id, eventId: refreshed.eventId ?? 0, amountCents: refundAmountCents, partial: !isFullRefund });
    }

    return { transaction: refreshed, refundedAmountCents: refundAmountCents, isFullRefund, tokensReversed, purchaseRewardReversed };
  });
}

export { commerceRefunds };
