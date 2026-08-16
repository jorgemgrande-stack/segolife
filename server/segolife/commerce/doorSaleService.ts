/**
 * doorSaleService.ts — SEGOLIFE COMMERCE CORE (Fase 9, spec §14-15/§44-45).
 * Venta de entrada EN PUERTA por staff — el hueco comercial confirmado
 * ausente por la auditoría previa (ver referralService.ts-equivalente de
 * esta fase para el resto del contexto): hasta ahora un walk-up solo podía
 * generar un `venue_visits` sin ningún dato de dinero.
 *
 * DECISIÓN ARQUITECTÓNICA (spec §18/§89/§90, documentada): NO se crea una
 * tabla `orders`/`door_sales` paralela. Una venta de puerta es, en todo lo
 * que importa, un pedido nativo de `ticket_orders` más — reutiliza
 * `inventoryHoldService.createHold` (mismo locking real anti-oversell),
 * `orderStateMachine.transitionOrderStatus` (misma máquina de estados),
 * `ticketIssuanceService.issueTicketsForOrder` (misma emisión con QR) y
 * `checkoutService.grantNativePurchaseReward`/`ticketCancellationService.
 * reverseNativePurchaseReward` (misma recompensa "ticket", nunca una
 * segunda regla). La única diferencia real es CÓMO se confirma el pago:
 * nunca un PaymentProvider online (que hoy no existe, spec §48) — el staff
 * YA presenció el cobro en persona (efectivo/tarjeta física/SegoTokens),
 * mismo criterio exacto que nativeCommerceService.recordNativeSale (POS).
 *
 * `event_ticket_types.isDoorEntry=true` marca los tipos de entrada
 * vendibles en puerta — nunca aparecen en el listado público de compra
 * online (spec §14, "Not: manual attendance with €15 written somewhere").
 *
 * ADMISIÓN INMEDIATA (spec §15): una venta de puerta completa SIEMPRE
 * admite en el mismo paso — el ticket se emite y se marca "used" a la vez,
 * y si hay Student identificado se registra la asistencia canónica vía
 * `ingestAttendance` (nunca escrito directamente, spec §15 "Do NOT write
 * event_attendance directly from Commerce"). Comprador anónimo (spec §17,
 * "Student optional") → se emite el ticket igualmente (control de aforo
 * real), pero sin fila de asistencia (no hay a quién atribuírsela) ni
 * SegoTokens (ni gasto ni recompensa — ninguno de los dos existe sin
 * identidad).
 *
 * SEGOTOKENS PRESENCIALES (Pre-16.1, spec §2 "IDENTIFICATION != PAYMENT
 * AUTHORIZATION"): este servicio YA NO llama a reserveAndCaptureTokenSpend()
 * directo — eso permitía a un operador de puerta aplicar tokens de un
 * Student identificado sin que el Student autorizara nada desde su
 * teléfono. Ahora solo acepta `confirmedTokenRequestId`: el id de un
 * token_payment_request ya CONFIRMADO por el Student
 * (tokenPaymentRequestService.ts, creado antes vía
 * `commerce.requestTokenPayment`). Sin ese id, la venta no lleva SegoTokens.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eventTicketTypes, events, eventTickets, ticketOrders, type TicketOrder, type EventTicket } from "../../../drizzle/schema";
import { createHold, CheckoutError } from "../ticketing/inventoryHoldService";
import { transitionOrderStatus, OrderStateError } from "../ticketing/orderStateMachine";
import { issueTicketsForOrder } from "../ticketing/ticketIssuanceService";
import { grantNativePurchaseReward } from "../ticketing/checkoutService";
import { reverseNativePurchaseReward } from "../ticketing/ticketCancellationService";
import { ingestAttendance } from "../ticketing/attendancePipeline";
import { isEventCurrentlyOpen } from "../ticketing/unifiedCheckinService";
import { emitEngagementEvent } from "../engagement/engagementEvents";
import { quoteTokenSpend, reverseTokenSpend, type TokenSpendReservation } from "../tokens/tokenSpendService";
import { settleTokenPaymentRequest, linkSettledOrder, TokenPaymentRequestError } from "../tokens/tokenPaymentRequestService";
import { recordCommerceRefund } from "./refundOrchestrator";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class DoorSaleError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DoorSaleError";
  }
}

/** Eventos "en curso ahora" del venue + sus tipos de entrada de puerta activos — el picker de Venue App nunca navega el catálogo global de eventos, solo lo que un operador de puerta necesita ver ahora mismo. */
export async function listDoorEntryTicketTypesForVenue(venueId: number, at: Date = new Date(), db?: DbHandle) {
  const conn = db ?? (await getDb());
  const venueEvents = await conn.select().from(events).where(and(eq(events.venueId, venueId), eq(events.status, "active")));
  const openEvents = venueEvents.filter(e => isEventCurrentlyOpen(e, at));
  if (!openEvents.length) return [];

  const rows = await Promise.all(openEvents.map(async (event) => {
    const types = await conn.select().from(eventTicketTypes).where(and(eq(eventTicketTypes.eventId, event.id), eq(eventTicketTypes.isDoorEntry, true), eq(eventTicketTypes.status, "active")));
    return { event, ticketTypes: types };
  }));
  return rows.filter(r => r.ticketTypes.length > 0);
}

async function resolveDoorTicketType(eventId: number, ticketTypeId: number, conn: DbHandle) {
  const [type] = await conn.select().from(eventTicketTypes).where(eq(eventTicketTypes.id, ticketTypeId)).limit(1);
  if (!type || type.eventId !== eventId) throw new DoorSaleError("NOT_FOUND", "Tipo de entrada de puerta no encontrado para este evento");
  if (!type.isDoorEntry) throw new DoorSaleError("NOT_DOOR_ENTRY", "Este tipo de entrada no está habilitado para venta en puerta");
  if (type.status !== "active") throw new DoorSaleError("INACTIVE", "Este tipo de entrada de puerta no está activo");
  return type;
}

export interface QuoteDoorEntryInput {
  eventId: number;
  ticketTypeId: number;
  quantity: number;
  identifiedUserId?: number | null;
  requestedTokens?: number;
}

export interface DoorEntryQuote {
  grossAmountCents: number;
  ticketTypeName: string;
  tokenQuote: Awaited<ReturnType<typeof quoteTokenSpend>> | null;
}

/** Solo lectura (spec §36 "checkout UX contract", mismo criterio que POS) — recalcula SIEMPRE desde event_ticket_types, nunca confía en un importe del cliente. */
export async function quoteDoorEntry(input: QuoteDoorEntryInput, db?: DbHandle): Promise<DoorEntryQuote> {
  const conn = db ?? (await getDb());
  const type = await resolveDoorTicketType(input.eventId, input.ticketTypeId, conn);
  const grossAmountCents = type.priceCents * input.quantity;

  let tokenQuote: DoorEntryQuote["tokenQuote"] = null;
  if (input.identifiedUserId && input.requestedTokens) {
    const [event] = await conn.select({ venueId: events.venueId }).from(events).where(eq(events.id, input.eventId)).limit(1);
    tokenQuote = await quoteTokenSpend({
      userId: input.identifiedUserId,
      venueId: event?.venueId ?? null,
      eventId: input.eventId,
      grossAmountCents,
      requestedTokens: input.requestedTokens,
    }, conn);
  }

  return { grossAmountCents, ticketTypeName: type.name, tokenQuote };
}

export interface RecordDoorSaleInput {
  eventId: number;
  ticketTypeId: number;
  quantity: number;
  /** Comprador identificado (QR de identidad) — opcional, spec §17. Sin esto: sin SegoTokens, sin asistencia atribuible, venta igualmente válida. */
  identifiedUserId?: number | null;
  operatorUserId: number;
  /**
   * SEGOLIFE — SEGOTOKENS PRESENCIALES (Pre-16.1): id de un
   * token_payment_request ya CONFIRMADO por el Student desde su propio
   * teléfono (creado antes vía `commerce.requestTokenPayment`). Sustituye al
   * antiguo `tokensToApply` directo.
   */
  confirmedTokenRequestId?: number | null;
  idempotencyKey: string;
}

export interface RecordDoorSaleResult {
  order: TicketOrder;
  tickets: EventTicket[];
}

export async function recordDoorSale(input: RecordDoorSaleInput, db?: DbHandle): Promise<RecordDoorSaleResult> {
  const conn = db ?? (await getDb());
  if (input.quantity < 1) throw new DoorSaleError("INVALID_QUANTITY", "Cantidad no válida");

  const type = await resolveDoorTicketType(input.eventId, input.ticketTypeId, conn);
  const [event] = await conn.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!event) throw new DoorSaleError("NOT_FOUND", "Evento no encontrado");

  // Reutiliza el hold real (aforo con FOR UPDATE, spec §63) — nunca un
  // segundo mecanismo de control de aforo paralelo. userId puede ser null
  // (comprador anónimo, spec §17); channel="door" + operatorUserId quedan
  // en la propia fila para la auditoría/lectura unificada de Ventas.
  const holdResult = await createHold({
    eventId: input.eventId,
    userId: input.identifiedUserId ?? null,
    items: [{ ticketTypeId: input.ticketTypeId, quantity: input.quantity }],
    idempotencyKey: input.idempotencyKey,
    channel: "door",
    operatorUserId: input.operatorUserId,
  }, conn);

  if (holdResult.status === "already_exists") {
    // Reintento (doble tap del staff, red inestable, spec §62) — el pedido
    // YA existe; si ya llegó a paid, sus tickets también, se devuelven tal
    // cual sin repetir ningún efecto (ST/recompensa/asistencia).
    const existingTickets = await conn.select().from(eventTickets).where(eq(eventTickets.orderId, holdResult.order.id));
    if (holdResult.order.status === "paid" && existingTickets.length) {
      return { order: holdResult.order, tickets: existingTickets };
    }
  }
  const order = holdResult.order;

  // ─── SegoTokens Presenciales (Pre-16.1) — liquida una autorización que el
  // Student ya confirmó, nunca decide/captura por cuenta propia. Dentro del
  // MISMO try que el resto de la venta (spec §16): si cualquier validación
  // de aquí en adelante falla DESPUÉS de haber capturado tokens reales, el
  // catch de abajo debe poder revertirlos — nunca dejar tokens gastados sin
  // ninguna venta asociada. ─────────────────────────────────────────────
  let reservation: TokenSpendReservation | null = null;
  try {
    if (input.confirmedTokenRequestId != null) {
      if (!input.identifiedUserId) throw new DoorSaleError("STUDENT_REQUIRED", "Se necesita identificar al Student para aplicar SegoTokens");
      let settleResult;
      try {
        settleResult = await settleTokenPaymentRequest(input.confirmedTokenRequestId, "door", conn);
      } catch (err) {
        if (err instanceof TokenPaymentRequestError) throw new DoorSaleError(err.code, err.message);
        throw err;
      }
      // Asignado ANTES de validar: los tokens ya se capturaron dentro de
      // settleTokenPaymentRequest — si algo de lo siguiente lanza, el catch
      // de más abajo debe poder revertirlo.
      reservation = settleResult.reservation;
      if (reservation.userId !== input.identifiedUserId) {
        throw new DoorSaleError("REQUEST_STUDENT_MISMATCH", "La solicitud de pago no corresponde al Student identificado para esta venta");
      }
      if (reservation.grossAmountCents !== order.totalCents) {
        throw new DoorSaleError("CART_CHANGED_SINCE_REQUEST", "El precio de la entrada cambió desde que se solicitó el pago con SegoTokens — vuelve a solicitarlo");
      }
    }

    const moneyDueCents = order.totalCents - (reservation?.promotionalValueCents ?? 0);
    const paymentMethod = reservation
      ? (moneyDueCents === 0 ? "segotokens" : "mixed")
      : "cash";

    // Confirmación SÍNCRONA — el staff ya cobró el remanente en persona
    // (spec §46: "staff-confirmed", nunca un PaymentProvider inexistente).
    // pending→awaiting_payment→paid en la MISMA llamada, mismas dos
    // transiciones que checkoutService.initiatePayment ya usa, solo sin
    // esperar a ningún webhook.
    await transitionOrderStatus(order.id, ["pending"], "awaiting_payment", {}, conn);
    const paidOrder = await transitionOrderStatus(order.id, ["awaiting_payment"], "paid", {
      purchasedAt: new Date(),
      paymentMethod,
      tokenReservationId: reservation?.id ?? null,
    }, conn);

    if (input.confirmedTokenRequestId != null) {
      await linkSettledOrder(input.confirmedTokenRequestId, paidOrder.id, conn);
    }

    const issued = await issueTicketsForOrder(paidOrder, conn);

    // Admisión inmediata (spec §15) — marca usado + asistencia canónica en
    // el mismo paso, nunca event_attendance escrito directamente.
    const admittedTickets: EventTicket[] = [];
    for (const ticket of issued) {
      const [updateResult] = await conn.update(eventTickets).set({ status: "used" }).where(and(eq(eventTickets.id, ticket.id), eq(eventTickets.status, "issued")));
      const affected = (updateResult as unknown as { affectedRows: number }).affectedRows ?? 0;
      const [refreshed] = await conn.select().from(eventTickets).where(eq(eventTickets.id, ticket.id)).limit(1);
      admittedTickets.push(refreshed ?? ticket);
      if (affected > 0 && input.identifiedUserId) {
        await ingestAttendance({
          provider: "segolife",
          eventId: input.eventId,
          venueId: event.venueId ?? null,
          communityId: null,
          ticketId: ticket.id,
          resolvedUserId: input.identifiedUserId,
          attendance: {
            externalAttendanceId: `door_sale:${ticket.id}`,
            externalEventId: String(input.eventId),
            externalTicketId: ticket.externalTicketId ?? null,
            participant: { email: null, phone: null, name: null },
            occurredAt: new Date(),
          },
        }, conn);
      }
    }

    if (input.identifiedUserId) {
      await grantNativePurchaseReward(paidOrder, conn);
      emitEngagementEvent("ticket_purchased", { userId: input.identifiedUserId, orderId: paidOrder.id, eventId: input.eventId, communityId: null });
      emitEngagementEvent("ticket_checked_in", { userId: input.identifiedUserId, communityId: null, ticketId: admittedTickets[0]?.id ?? 0, eventId: input.eventId, venueId: event.venueId ?? null });
    }

    return { order: paidOrder, tickets: admittedTickets };
  } catch (err) {
    // Compensación (mismo criterio que nativeCommerceService.recordNativeSale):
    // si algo falla tras capturar SegoTokens reales, revertir — nunca dejar
    // tokens gastados sin ninguna venta asociada.
    if (reservation) {
      await reverseTokenSpend({ reservationId: reservation.id, reason: "Venta de puerta no pudo completarse tras capturar SegoTokens", adminUserId: input.operatorUserId }, conn).catch(() => {});
    }
    if (err instanceof OrderStateError) throw new DoorSaleError(err.code, err.message);
    throw err;
  }
}

export interface RefundDoorSaleInput {
  orderId: number;
  refundedByUserId: number;
  reason: string;
}

/**
 * Reembolso de una venta de puerta (spec §20/§55) — servicio DEDICADO,
 * nunca `ticketCancellationService.refundOrder` sin más: esa función
 * bloquea con `reconciliation_required` en cuanto CUALQUIER ticket está
 * "used" — correcto para una entrada online (llevan horas disfrutando el
 * evento), pero incorrecto aquí: en una venta de puerta "used" significa
 * exactamente "se le admitió en el mismo instante de la venta", el
 * resultado ESPERADO e inmediato de la propia compra, no una señal de que
 * ya es tarde para reembolsar. Política documentada (spec §56): SÍ se
 * revierte dinero/SegoTokens/recompensa de compra; NUNCA se borra la fila
 * de `event_attendance` — el hecho "estuvo físicamente aquí" se conserva
 * (mismo criterio que Fase 6, "Behavioral Benefits no se revocan
 * automáticamente").
 */
export async function refundDoorSale(input: RefundDoorSaleInput, db?: DbHandle): Promise<TicketOrder> {
  if (!input.reason || !input.reason.trim()) throw new DoorSaleError("REASON_REQUIRED", "El reembolso requiere un motivo");
  const conn = db ?? (await getDb());

  const [order] = await conn.select().from(ticketOrders).where(eq(ticketOrders.id, input.orderId)).limit(1);
  if (!order) throw new DoorSaleError("NOT_FOUND", "Venta no encontrada");
  if (order.channel !== "door") throw new DoorSaleError("NOT_DOOR_SALE", "Esta operación solo aplica a ventas de puerta");
  if (order.status !== "paid") throw new DoorSaleError("INVALID_STATE", "Solo se puede reembolsar una venta ya pagada");

  const refunded = await transitionOrderStatus(input.orderId, ["paid"], "refunded", { refundedAt: new Date() }, conn);

  // PRE-16 overnight hardening (bug real encontrado en auditoría): antes se
  // registraba con venueId=null — cashSessionService.ts filtra sus
  // refunds por `eq(commerceRefunds.venueId, session.venueId)`, y SQL `=`
  // nunca hace match contra NULL, así que un reembolso real de puerta
  // desaparecía silenciosamente del arqueo de caja (expectedCashCents
  // quedaba de más, la caja cerraba con un "descuadre" fantasma exacto al
  // importe de cada reembolso de puerta). Mismo patrón de resolución que
  // recordDoorSale más arriba en este archivo.
  const [event] = await conn.select({ venueId: events.venueId }).from(events).where(eq(events.id, order.eventId)).limit(1);

  const tickets = await conn.select().from(eventTickets).where(eq(eventTickets.orderId, input.orderId));
  const admittedIds = tickets.filter(t => t.status === "used").map(t => t.id);
  if (admittedIds.length) {
    await conn.update(eventTickets).set({ status: "refunded", refundedAt: new Date() }).where(and(eq(eventTickets.orderId, input.orderId), eq(eventTickets.status, "used")));
  }

  await reverseNativePurchaseReward(refunded, input.refundedByUserId, conn);

  let tokensRestored = 0;
  if (order.tokenReservationId != null) {
    const reversed = await reverseTokenSpend({ reservationId: order.tokenReservationId, reason: input.reason, adminUserId: input.refundedByUserId }, conn);
    tokensRestored = reversed.tokensReserved;
  }

  await recordCommerceRefund({
    sourceType: "ticket_order",
    sourceId: order.id,
    venueId: event?.venueId ?? null,
    eventId: order.eventId,
    userId: order.userId,
    amountCents: order.totalCents,
    tokensRestored,
    moneyRefundStatus: "completed", // staff-confirmado, spec §46 — nunca dependía de un PaymentProvider
    reason: input.reason,
    partial: false,
    refundedByUserId: input.refundedByUserId,
    idempotencyKey: `door_refund:${order.id}`,
  }, conn);

  if (refunded.userId) {
    emitEngagementEvent("order_refunded", { userId: refunded.userId, communityId: null, orderId: refunded.id, eventId: refunded.eventId, amountCents: order.totalCents, partial: false });
  }

  return refunded;
}

export { CheckoutError };
