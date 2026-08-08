/**
 * ticketCancellationService.ts — cancelación/reembolso de un ticket_order
 * nativo (Fase 8, spec punto 18). Nunca DELETE. Dos casos bien distintos:
 *
 *  - Cancelar ANTES de pagar (pending/awaiting_payment): libera el hold sin
 *    más consecuencias — todavía no existen event_tickets ni loyalty.
 *  - Reembolsar DESPUÉS de pagado (paid): si NINGÚN ticket del order se ha
 *    usado (check-in), es un caso limpio — nada que compensar en
 *    SegoTokens/Benefits, porque ese loyalty solo se concede al hacer
 *    check-in (evento attendance), nunca al comprar. Si YA hay algún
 *    ticket `used`, el estudiante ya asistió y puede haber SegoTokens/
 *    Benefits concedidos por esa asistencia — auditado `reverseTransaction`
 *    de Fase 2 y la política de Benefits: ninguna de las dos define hoy
 *    una política comercial de "qué hacer si se reembolsa una entrada ya
 *    disfrutada", así que NUNCA se improvisa una reversión automática —
 *    el order queda en `reconciliation_required` para resolución manual.
 */
import { eq, and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { ticketOrders, eventTickets, ticketPayments, type TicketOrder } from "../../../drizzle/schema";
import { transitionOrderStatus, OrderStateError } from "./orderStateMachine";
import { getPaymentProvider } from "./payments/paymentProviderRegistry";
import { emitEngagementEvent } from "../engagement/engagementEvents";
import { CheckoutError } from "./inventoryHoldService";

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

  const provider = getPaymentProvider();
  const refundResult = payment?.externalPaymentId
    ? await provider.refundPayment({ externalPaymentId: payment.externalPaymentId, amountCents: order.totalCents, reason })
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

  if (refunded.userId) {
    emitEngagementEvent("order_refunded", { userId: refunded.userId, communityId: null, orderId: refunded.id, eventId: refunded.eventId, amountCents: order.totalCents, partial: false });
  }

  return { order: refunded, reconciliationRequired: false };
}
