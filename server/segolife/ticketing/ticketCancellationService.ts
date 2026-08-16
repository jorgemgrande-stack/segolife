/**
 * ticketCancellationService.ts — cancelación/reembolso de un ticket_order
 * nativo (Fase 8, spec punto 18). Nunca DELETE. Dos casos bien distintos:
 *
 *  - Cancelar ANTES de pagar (pending/awaiting_payment): libera el hold sin
 *    más consecuencias — todavía no existen event_tickets ni loyalty.
 *  - Reembolsar DESPUÉS de pagado (paid): si NINGÚN ticket del order se ha
 *    usado (check-in), la única loyalty asociada es la recompensa de
 *    COMPRA (spec §18/§21, `checkoutService.grantNativePurchaseReward`) —
 *    se revierte automáticamente vía `reverseTransaction()` (Fase 2), el
 *    mismo mecanismo probado que ya usa `ticketPurchasePipeline.ts` para
 *    refunds Fourvenues, idempotente por `isLedgerEntryReversed`. Si YA hay
 *    algún ticket `used`, el estudiante ya asistió y puede haber SegoTokens/
 *    Benefits concedidos por esa asistencia además de por la compra — ni
 *    esa reversión ni la política de Benefits están definidas hoy para
 *    "entrada ya disfrutada", así que NUNCA se improvisa — el order queda
 *    en `reconciliation_required` para resolución manual (sin tocar nada).
 */
import { eq, and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { ticketOrders, eventTickets, ticketPayments, tokenLedger, type TicketOrder } from "../../../drizzle/schema";
import { transitionOrderStatus, OrderStateError } from "./orderStateMachine";
import { getPaymentProvider } from "./payments/paymentProviderRegistry";
import { emitEngagementEvent } from "../engagement/engagementEvents";
import { CheckoutError } from "./inventoryHoldService";
import { reverseTransaction, isLedgerEntryReversed } from "../tokens/tokenLedgerService";
import { reverseTokenSpend } from "../tokens/tokenSpendService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export async function cancelOrder(orderId: number, _cancelledByUserId: number, db?: DbHandle): Promise<TicketOrder> {
  const conn = db ?? (await getDb());
  try {
    return await transitionOrderStatus(orderId, ["pending", "awaiting_payment"], "cancelled", { cancelledAt: new Date() }, conn);
  } catch (err) {
    if (err instanceof OrderStateError) throw new CheckoutError(err.code, err.message);
    throw err;
  }
}

export interface RefundOrderResult {
  order: TicketOrder;
  reconciliationRequired: boolean;
}

export async function refundOrder(orderId: number, refundedByUserId: number, reason: string, db?: DbHandle): Promise<RefundOrderResult> {
  const conn = db ?? (await getDb());
  const [order] = await conn.select().from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);
  if (!order) throw new CheckoutError("NOT_FOUND", "Order no encontrado");
  if (order.status !== "paid") throw new CheckoutError("INVALID_STATE", "Solo se puede reembolsar un order pagado");

  const tickets = await conn.select().from(eventTickets).where(eq(eventTickets.orderId, orderId));
  const anyUsed = tickets.some(t => t.status === "used");

  if (anyUsed) {
    const reconciled = await transitionOrderStatus(orderId, ["paid"], "reconciliation_required", {
      metadata: { ...(order.metadata ?? {}), refundBlockedReason: "ticket_already_used", requestedBy: refundedByUserId, reason },
    }, conn);
    return { order: reconciled, reconciliationRequired: true };
  }

  const [payment] = await conn.select().from(ticketPayments)
    .where(and(eq(ticketPayments.orderId, orderId), eq(ticketPayments.status, "succeeded"))).limit(1);

  // Pre-16.2: `payment.amountCents` es el importe REAL cobrado por el
  // provider (el dinero restante tras aplicar SegoTokens, si los hubo —
  // nunca el bruto del pedido, ver checkoutService.ts). Si no hubo nada que
  // cobrar en dinero (100% SegoTokens, o ticket gratuito), no se llama al
  // provider en absoluto — nada que reembolsar por esa vía.
  const moneyToRefundCents = payment?.amountCents ?? 0;
  const provider = getPaymentProvider();
  const refundResult = moneyToRefundCents === 0
    ? { status: "refunded" as const, externalPaymentId: payment?.externalPaymentId ?? null, error: null }
    : payment?.externalPaymentId
      ? await provider.refundPayment({ externalPaymentId: payment.externalPaymentId, amountCents: moneyToRefundCents, reason })
      : { status: "failed" as const, error: "Sin referencia de pago real que reembolsar (provider no configurado)" };

  if (refundResult.status !== "refunded") {
    const reconciled = await transitionOrderStatus(orderId, ["paid"], "reconciliation_required", {
      metadata: { ...(order.metadata ?? {}), refundBlockedReason: refundResult.error ?? "payment_provider_refund_failed", requestedBy: refundedByUserId, reason },
    }, conn);
    return { order: reconciled, reconciliationRequired: true };
  }

  const refunded = await transitionOrderStatus(orderId, ["paid"], "refunded", { refundedAt: new Date() }, conn);
  if (payment) await conn.update(ticketPayments).set({ status: "refunded" }).where(eq(ticketPayments.id, payment.id));

  const unusedTicketIds = tickets.filter(t => t.status === "issued").map(t => t.id);
  if (unusedTicketIds.length) {
    await conn.update(eventTickets).set({ status: "refunded", refundedAt: new Date() }).where(inArray(eventTickets.id, unusedTicketIds));
  }

  await reverseNativePurchaseReward(refunded, refundedByUserId, conn);

  // Pre-16.2: si la compra se pagó (total o parcialmente) con SegoTokens,
  // devolverlos al wallet — mismo primitivo y mismo criterio best-effort
  // que ya usa doorSaleService.refundDoorSale (Pre-16.1) para el reembolso
  // presencial; un fallo aquí nunca deshace el reembolso de dinero ya
  // confirmado con el provider.
  if (refunded.tokenReservationId != null) {
    try {
      await reverseTokenSpend({ reservationId: refunded.tokenReservationId, reason, adminUserId: refundedByUserId }, conn);
    } catch (err) {
      console.error(`[ticketCancellationService] No se pudieron revertir los SegoTokens (orderId=${orderId}):`, err);
    }
  }

  if (refunded.userId) {
    emitEngagementEvent("order_refunded", { userId: refunded.userId, communityId: null, orderId: refunded.id, eventId: refunded.eventId, amountCents: order.totalCents, partial: false });
  }

  return { order: refunded, reconciliationRequired: false };
}

/** Reversión automática (spec §21) de la recompensa de COMPRA concedida por `checkoutService.grantNativePurchaseReward` — nunca llamada si algún ticket ya se usó (ese caso queda en reconciliation_required más arriba). Best-effort: un fallo aquí nunca deshace el reembolso real ya confirmado con el provider. Exportada (Fase 9 §20/§56): doorSaleService.ts reutiliza la MISMA reversión — mismo origin="ticket" del ledger, misma idempotencia por sourceId=orderId. */
export async function reverseNativePurchaseReward(order: TicketOrder, refundedByUserId: number, conn: DbHandle): Promise<void> {
  if (!order.userId) return;
  try {
    const [purchaseLedgerEntry] = await conn.select().from(tokenLedger)
      .where(and(eq(tokenLedger.sourceType, "ticket"), eq(tokenLedger.sourceId, order.id), eq(tokenLedger.direction, "credit")))
      .limit(1);
    if (!purchaseLedgerEntry) return; // ticket gratuito, o la recompensa nunca se concedió (p.ej. NO_RULE_FOUND) — nada que revertir
    if (await isLedgerEntryReversed(purchaseLedgerEntry.id, conn)) return;
    await reverseTransaction({
      ledgerId: purchaseLedgerEntry.id,
      reason: `Reembolso de entrada — pedido #${order.id}`,
      adminUserId: refundedByUserId,
    }, conn);
  } catch (err) {
    console.error(`[ticketCancellationService] No se pudo revertir la recompensa de compra (orderId=${order.id}):`, err);
  }
}
