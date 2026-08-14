/**
 * checkoutService.ts — orquesta el checkout nativo completo (Fase 8, spec
 * punto 8): event → ticket type → cantidad → disponibilidad → hold/order →
 * PaymentProvider → confirmación → emisión de tickets. Idempotente en cada
 * paso (idempotency_key de ticket_orders para el hold, de ticket_payments
 * para cada intento de pago, reutilización de event_tickets para la
 * emisión). Los importes SIEMPRE se recalculan en backend — nunca se
 * confía en price/eventId/total enviados por el frontend.
 *
 * SEGOTOKENS — COMPRA (SEGOLIFE — Native Ticket Sales, spec §18): al llegar
 * a `paid` (por cualquiera de las dos vías, éxito inmediato o webhook) se
 * concede la recompensa de compra vía `earnTokens({origin:"ticket",...})` —
 * la MISMA regla LIVE "Compra de entrada" que ya usan las compras
 * Fourvenues (`ticketPurchasePipeline.ts::grantPurchaseLoyalty`), nunca una
 * regla nueva. A diferencia de esa función (diseñada para reintentos de
 * sync repetidos de Fourvenues, con su propio RewardAttempt/generación), un
 * order nativo solo llega a `paid` UNA VEZ en su ciclo de vida — tanto
 * `initiatePayment` como `confirmPaymentByWebhook` comprueban el estado
 * actual antes de transicionar, así que este bloque nunca se ejecuta dos
 * veces para el mismo order — pero se pasa igualmente un idempotencyKey
 * real (defensa en profundidad, nunca confiar solo en "no debería pasar").
 * Best-effort: un fallo del motor de tokens nunca debe impedir que el
 * pedido quede pagado ni que se emitan los tickets.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { ticketOrders, ticketPayments, events, type TicketOrder, type EventTicket } from "../../../drizzle/schema";
import { createHold, type CreateHoldInput, CheckoutError } from "./inventoryHoldService";
import { transitionOrderStatus, OrderStateError } from "./orderStateMachine";
import { getPaymentProvider } from "./payments/paymentProviderRegistry";
import { issueTicketsForOrder } from "./ticketIssuanceService";
import { emitEngagementEvent } from "../engagement/engagementEvents";
import { earnTokens } from "../tokens/tokenEngine";
import { evaluateBenefitsForOrigin } from "../benefits/benefitRuleEngine";

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

/**
 * Recompensa de compra (spec §18) — misma regla LIVE "Compra de entrada"
 * (origin="ticket", 1 token/€ pagado real) que ya usan las compras
 * Fourvenues, vía el mismo `earnTokens()`. Un ticket gratuito (totalCents=0)
 * genera 0 tokens de forma natural por el cálculo per_euro — no hace falta
 * ningún caso especial aquí (spec §33). Best-effort: nunca bloquea el
 * pedido ya pagado ni la emisión de tickets.
 */
async function grantNativePurchaseReward(order: TicketOrder, conn: DbHandle): Promise<void> {
  if (!order.userId) return;
  const [event] = await conn.select({ venueId: events.venueId }).from(events).where(eq(events.id, order.eventId)).limit(1);
  const venueId = event?.venueId ?? null;

  let ledgerId: number | null = null;
  try {
    const result = await earnTokens({
      userId: order.userId,
      origin: "ticket",
      eventId: order.eventId,
      venueId,
      amountSpent: order.totalCents / 100,
      sourceId: order.id,
      idempotencyKey: `ticket_purchase:segolife_native:${order.id}`,
    }, conn);
    ledgerId = result.ledger.id;
  } catch (err) {
    console.error(`[checkoutService] No se concedió recompensa de compra (orderId=${order.id}):`, err);
  }

  try {
    await evaluateBenefitsForOrigin({
      type: "ticket",
      userId: order.userId,
      venueId,
      eventId: order.eventId,
      amountCents: order.totalCents,
      sourceId: order.id,
      ledgerId,
      occurredAt: order.purchasedAt ?? new Date(),
    }, conn);
  } catch (err) {
    console.error(`[checkoutService] No se evaluaron Benefits de compra (orderId=${order.id}):`, err);
  }
}

/** Secuencia común tras confirmar un pago real (spec §12/§18) — emitir tickets, conceder recompensa, emitir el evento de engagement. Compartida entre initiatePayment y confirmPaymentByWebhook para no duplicar la lógica de recompensa en dos sitios. */
async function finalizePaidOrder(order: TicketOrder, conn: DbHandle): Promise<EventTicket[]> {
  const tickets = await issueTicketsForOrder(order, conn);
  if (order.userId) {
    await grantNativePurchaseReward(order, conn);
    emitEngagementEvent("ticket_purchased", { userId: order.userId, orderId: order.id, eventId: order.eventId, communityId: null });
  }
  return tickets;
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
 *
 * TICKET GRATUITO (spec §33): si `totalCents === 0`, NUNCA se llama al
 * PaymentProvider (ni siquiera al mock/unconfigured) — se confirma mediante
 * una transición interna directa. Sigue creándose una fila en
 * `ticket_payments` (amountCents=0, provider="segolife_native_free") para
 * que el registro financiero del pedido quede completo y la comprobación
 * de idempotencia de más abajo (`existingPayment?.status === "succeeded"`)
 * funcione exactamente igual que para un pago real.
 */
export async function initiatePayment(orderId: number, db?: DbHandle): Promise<InitiatePaymentResult> {
  const conn = db ?? (await getDb());
  const [order] = await conn.select().from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);
  if (!order) throw new CheckoutError("NOT_FOUND", "Order no encontrado");

  const isFree = order.totalCents === 0;
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

  const result = isFree
    ? { status: "succeeded" as const, externalPaymentId: null, redirectUrl: null, error: null }
    : await provider.createPayment({
        orderId,
        amountCents: order.totalCents,
        currency: order.currency,
        idempotencyKey: paymentIdempotencyKey,
      });

  if (!existingPayment) {
    await conn.insert(ticketPayments).ignore().values({
      orderId,
      provider: isFree ? "segolife_native_free" : provider.providerKey,
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
    const tickets = await finalizePaidOrder(paidOrder, conn);
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
  const tickets = await finalizePaidOrder(paidOrder, conn);
  return { order: paidOrder, paymentStatus: "succeeded", tickets };
}
