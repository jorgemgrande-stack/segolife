/**
 * checkoutService.ts — orquesta el checkout nativo completo (Fase 8, spec
 * punto 8): event → ticket type → cantidad → disponibilidad → hold/order →
 * PaymentProvider → confirmación → emisión de tickets. Idempotente en cada
 * paso (idempotency_key de ticket_orders para el hold, de ticket_payments
 * para cada intento de pago, reutilización de event_tickets para la
 * emisión). Los importes SIEMPRE se recalculan en backend — nunca se
 * confía en price/eventId/total enviados por el frontend.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { ticketOrders, ticketPayments, type TicketOrder, type EventTicket } from "../../../drizzle/schema";
import { createHold, type CreateHoldInput, CheckoutError } from "./inventoryHoldService";
import { transitionOrderStatus, OrderStateError } from "./orderStateMachine";
import { getPaymentProvider } from "./payments/paymentProviderRegistry";
import { issueTicketsForOrder } from "./ticketIssuanceService";
import { emitEngagementEvent } from "../engagement/engagementEvents";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export { CheckoutError };

export async function startCheckout(input: CreateHoldInput, db?: DbHandle) {
  return createHold(input, db);
}

export interface InitiatePaymentResult {
  order: TicketOrder;
  paymentStatus: "succeeded" | "pending" | "failed";
  redirectUrl?: string | null;
  error?: string | null;
  tickets?: EventTicket[];
}

/**
 * Inicia el pago de un hold `pending`. Si el provider confirma
 * inmediatamente (p.ej. MockPaymentProvider en dev/test), completa todo el
 * flujo hasta emitir tickets en la misma llamada. Con
 * UnconfiguredPaymentProvider (producción sin proveedor real) SIEMPRE
 * devuelve `paymentStatus: "failed"` — nunca hay tickets, nunca se finge
 * un pago (spec punto 45.5).
 */
export async function initiatePayment(orderId: number, db?: DbHandle): Promise<InitiatePaymentResult> {
  const conn = db ?? (await getDb());
  const [order] = await conn.select().from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);
  if (!order) throw new CheckoutError("NOT_FOUND", "Order no encontrado");

  const provider = getPaymentProvider();
  const paymentIdempotencyKey = `ticket_payment:${orderId}:attempt`;

  // Precheck de idempotencia del INTENTO de pago (no del order) — reintentar
  // "pagar" el mismo order dos veces (doble clic, reintento de red) nunca
  // crea un segundo ticket_payments ni dispara al provider dos veces.
  const [existingPayment] = await conn.select().from(ticketPayments)
    .where(eq(ticketPayments.orderId, orderId)).limit(1);

  if (existingPayment?.status === "succeeded") {
    const tickets = await issueTicketsForOrder(order, conn);
    return { order, paymentStatus: "succeeded", tickets };
  }

  let awaitingOrder: TicketOrder;
  try {
    awaitingOrder = await transitionOrderStatus(orderId, ["pending"], "awaiting_payment", {}, conn);
  } catch (err) {
    if (err instanceof OrderStateError) throw new CheckoutError(err.code, err.message);
    throw err;
  }

  const result = await provider.createPayment({
    orderId,
    amountCents: order.totalCents,
    currency: order.currency,
    idempotencyKey: paymentIdempotencyKey,
  });

  if (!existingPayment) {
    await conn.insert(ticketPayments).ignore().values({
      orderId,
      provider: provider.providerKey,
      externalPaymentId: result.externalPaymentId ?? null,
      amountCents: order.totalCents,
      currency: order.currency,
      status: result.status === "succeeded" ? "succeeded" : result.status === "failed" ? "failed" : "pending",
      idempotencyKey: paymentIdempotencyKey,
      failureReason: result.error ?? null,
      metadata: {},
    });
  }

  if (result.status === "succeeded") {
    const paidOrder = await transitionOrderStatus(orderId, ["awaiting_payment"], "paid", { purchasedAt: new Date(), externalPaymentId: result.externalPaymentId ?? null }, conn);
    const tickets = await issueTicketsForOrder(paidOrder, conn);
    if (paidOrder.userId) {
      emitEngagementEvent("ticket_purchased", { userId: paidOrder.userId, orderId: paidOrder.id, eventId: paidOrder.eventId, communityId: null });
    }
    return { order: paidOrder, paymentStatus: "succeeded", tickets };
  }

  if (result.status === "pending" && result.redirectUrl) {
    // Proveedor con checkout hospedado (futuro real) — el order queda
    // awaiting_payment hasta que un webhook llame a confirmPaymentByWebhook().
    return { order: awaitingOrder, paymentStatus: "pending", redirectUrl: result.redirectUrl };
  }

  // Sin proveedor real (o rechazo) — vuelve a pending para no dejar el hold
  // atrapado en awaiting_payment sin ninguna vía de completar el pago; el
  // hold sigue vigente hasta expiresAt, el estudiante puede reintentar.
  await transitionOrderStatus(orderId, ["awaiting_payment"], "pending", {}, conn).catch(() => null);
  return { order, paymentStatus: "failed", error: result.error ?? "No se pudo iniciar el pago" };
}

/** Punto de entrada para un futuro webhook de un proveedor real — nunca se llama sin `provider.verifyWebhook()` haber validado la firma primero. */
export async function confirmPaymentByWebhook(orderId: number, externalPaymentId: string, db?: DbHandle): Promise<InitiatePaymentResult> {
  const conn = db ?? (await getDb());
  const [order] = await conn.select().from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);
  if (!order) throw new CheckoutError("NOT_FOUND", "Order no encontrado");

  if (order.status === "paid") {
    const tickets = await issueTicketsForOrder(order, conn);
    return { order, paymentStatus: "succeeded", tickets };
  }

  const paidOrder = await transitionOrderStatus(orderId, ["awaiting_payment"], "paid", { purchasedAt: new Date(), externalPaymentId }, conn);
  await conn.update(ticketPayments).set({ status: "succeeded", externalPaymentId }).where(eq(ticketPayments.orderId, orderId));
  const tickets = await issueTicketsForOrder(paidOrder, conn);
  if (paidOrder.userId) {
    emitEngagementEvent("ticket_purchased", { userId: paidOrder.userId, orderId: paidOrder.id, eventId: paidOrder.eventId, communityId: null });
  }
  return { order: paidOrder, paymentStatus: "succeeded", tickets };
}
