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
import { reserveTokenSpend, captureTokenSpend, releaseTokenSpend, type TokenSpendReservation } from "../tokens/tokenSpendService";

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
/** Exportada (Fase 9, Commerce Core §14): doorSaleService.ts reutiliza la MISMA recompensa de compra "ticket" — una venta de puerta es, económicamente, una compra nativa más, solo confirmada por staff en vez de por PaymentProvider. */
export async function grantNativePurchaseReward(order: TicketOrder, conn: DbHandle): Promise<void> {
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
 * LIQUIDACIÓN TRAS DINERO CONFIRMADO (Pre-16.2, gate de seguridad
 * económica §1/§2) — punto ÚNICO donde un order pasa a `paid`, compartido
 * entre initiatePayment() (éxito síncrono) y confirmPaymentByWebhook()
 * (éxito asíncrono). Sustituye el "best-effort, nunca bloquea" original:
 * un dinero real confirmado por el provider NUNCA puede terminar en un
 * ticket emitido si el tramo de SegoTokens no se pudo capturar de verdad.
 *
 * FUENTE DE VERDAD PARA "¿sigue siendo válido honrar este pedido?": el
 * propio `order.expiresAt` — el MISMO campo que
 * inventoryHoldService.ts::committedQuantity ya usa para decidir si este
 * hold sigue contando como aforo comprometido de cara a OTROS compradores.
 * Si ya pasó, el aforo pudo haberse vendido a otra persona mientras este
 * pago hospedado seguía en curso — por eso se comprueba ANTES de intentar
 * capturar cualquier SegoToken, nunca después: capturar tokens para un
 * pedido cuyo aforo ya no es seguro sería gastar el saldo del Student sin
 * ninguna garantía de que el ticket pueda emitirse.
 *
 * DOS DESENLACES si no se puede honrar (hold caducado y/o captura de
 * SegoTokens fallida):
 *  - Si NUNCA hubo dinero real de por medio (compra 100% SegoTokens): no
 *    hay nada que compensar — se libera la reserva (si sigue "reserved") y
 *    el pedido simplemente no se completa (vuelve a `pending`), igual que
 *    cualquier otro intento de pago fallido — el Student puede reintentar.
 *  - Si SÍ hubo dinero real confirmado por el provider: ese cobro es un
 *    hecho externo que NUNCA se ignora. Se reconoce (`paid`) y de
 *    inmediato: (a) si el provider soporta reembolsos
 *    (`capabilities.supportsRefunds`) y hay una referencia real, se
 *    compensa automáticamente — el order termina en `refunded`, mismo
 *    estado que un reembolso normal; (b) si no hay compensación automática
 *    segura disponible, el order termina en `reconciliation_required` —
 *    estado YA EXISTENTE en la máquina de estados (mismo que usa
 *    ticketCancellationService.ts para casos que no puede resolver solo),
 *    nunca una máquina de estados nueva. En ningún caso de estos dos se
 *    emite ticket, se concede recompensa ni se notifica compra lista.
 */
async function settleAfterMoneyConfirmed(
  order: TicketOrder,
  conn: DbHandle,
  opts: { externalPaymentId: string | null; realMoneyCollectedCents: number; tokenReservationId: number | null; paymentMethod: string | null },
): Promise<InitiatePaymentResult> {
  const holdStillValid = order.expiresAt == null || order.expiresAt.getTime() >= Date.now();

  let tokenCaptured = false;
  if (holdStillValid && opts.tokenReservationId != null) {
    try {
      await captureTokenSpend(opts.tokenReservationId, conn);
      tokenCaptured = true;
    } catch (err) {
      console.error(`[checkoutService] No se pudo capturar la reserva de SegoTokens al liquidar (orderId=${order.id}, reservationId=${opts.tokenReservationId}):`, err);
    }
  }
  const tokenLegOk = opts.tokenReservationId == null || tokenCaptured;

  if (holdStillValid && tokenLegOk) {
    const paidOrder = await transitionOrderStatus(order.id, ["awaiting_payment"], "paid", {
      purchasedAt: new Date(),
      externalPaymentId: opts.externalPaymentId,
      paymentMethod: opts.paymentMethod,
      tokenReservationId: opts.tokenReservationId,
    }, conn);
    const tickets = await finalizePaidOrder(paidOrder, conn);
    return { order: paidOrder, paymentStatus: "succeeded", tickets };
  }

  // No se puede honrar — nunca se captura un SegoToken para un pedido que
  // no va a completarse. Si por algún motivo ya se había capturado justo
  // antes de comprobar `holdStillValid` (no debería, el orden de arriba lo
  // impide, pero se cubre igual por defensa en profundidad),
  // releaseTokenSpend lanzaría INVALID_STATE sobre una reserva ya
  // "captured" — capturado por el catch, nunca deja el sistema peor.
  const reason = !holdStillValid ? "inventory_hold_expired_before_settlement" : "token_reservation_capture_failed";
  if (opts.tokenReservationId != null && !tokenCaptured) {
    await releaseTokenSpend(opts.tokenReservationId, reason, conn).catch(() => {});
  }

  if (opts.realMoneyCollectedCents === 0) {
    // Nunca hubo dinero real de por medio (compra 100% SegoTokens) — nada
    // que compensar, el pedido simplemente no se completa.
    await transitionOrderStatus(order.id, ["awaiting_payment"], "pending", {}, conn).catch(() => null);
    return { order, paymentStatus: "failed", error: `No se pudo completar la compra (${reason})` };
  }

  // Dinero real confirmado por el provider — hecho externo que no se
  // ignora: se reconoce primero (paid) y de inmediato se intenta la
  // compensación segura disponible. paymentMethod/tokenReservationId se
  // dejan igualmente registrados aunque el pedido no vaya a quedarse en
  // "paid" — auditoría (spec Pre-16.2 gate §7): administración debe poder
  // ver que este era un pedido mixto/con SegoTokens al revisar el caso.
  const paidOrder = await transitionOrderStatus(order.id, ["awaiting_payment"], "paid", {
    purchasedAt: new Date(),
    externalPaymentId: opts.externalPaymentId,
    paymentMethod: opts.paymentMethod,
    tokenReservationId: opts.tokenReservationId,
  }, conn);

  const provider = getPaymentProvider();
  const [payment] = await conn.select().from(ticketPayments).where(eq(ticketPayments.orderId, order.id)).limit(1);
  const canAutoRefund = provider.capabilities.supportsRefunds && !!payment?.externalPaymentId && (payment?.amountCents ?? 0) > 0;

  if (canAutoRefund) {
    const refundResult = await provider
      .refundPayment({ externalPaymentId: payment!.externalPaymentId!, amountCents: payment!.amountCents, reason: `Compensación automática — ${reason}` })
      .catch((err): { status: "failed"; error: string } => { console.error(`[checkoutService] refundPayment lanzó durante la compensación automática (orderId=${order.id}):`, err); return { status: "failed", error: "refund_threw" }; });
    if (refundResult.status === "refunded") {
      const refunded = await transitionOrderStatus(order.id, ["paid"], "refunded", { refundedAt: new Date() }, conn);
      await conn.update(ticketPayments).set({ status: "refunded" }).where(eq(ticketPayments.orderId, order.id));
      return { order: refunded, paymentStatus: "failed", error: `La compra no se pudo completar (${reason}) — el dinero se ha reembolsado automáticamente.` };
    }
  }

  // Sin compensación automática segura disponible — nunca "paid" silencioso
  // ni "failed" que esconda que ya se cobró: reconciliation_required deja
  // el dinero cobrado visible y accionable para administración.
  await conn.update(ticketPayments).set({ status: "succeeded", externalPaymentId: opts.externalPaymentId }).where(eq(ticketPayments.orderId, order.id));
  const reconciled = await transitionOrderStatus(order.id, ["paid"], "reconciliation_required", {
    metadata: { ...(order.metadata ?? {}), reconciliationReason: reason },
  }, conn);
  return { order: reconciled, paymentStatus: "failed", error: `La compra no se pudo completar (${reason}) — el dinero ya cobrado requiere revisión manual.` };
}

/**
 * Inicia el pago de un hold `pending`. Si el provider confirma
 * inmediatamente (p.ej. MockPaymentProvider en dev/test), completa todo el
 * flujo hasta emitir tickets en la misma llamada. Con
 * UnconfiguredPaymentProvider (producción sin proveedor real) SIEMPRE
 * devuelve `paymentStatus: "failed"` para cualquier importe en dinero
 * pendiente — nunca hay tickets, nunca se finge un pago (spec punto 45.5).
 *
 * TICKET GRATUITO (spec §33): si `totalCents === 0`, NUNCA se llama al
 * PaymentProvider (ni siquiera al mock/unconfigured) — se confirma mediante
 * una transición interna directa. Sigue creándose una fila en
 * `ticket_payments` (amountCents=0, provider="segolife_native_free") para
 * que el registro financiero del pedido quede completo y la comprobación
 * de idempotencia de más abajo (`existingPayment?.status === "succeeded"`)
 * funcione exactamente igual que para un pago real.
 */
/**
 * `tokensToApply` (Pre-16.2, "Online Event Checkout — SegoTokens + Money"):
 * PARCIAL o TOTAL — el servidor recalcula/clama según la política de canje
 * vigente, nunca confía en que el cliente ya "sabe" cuánto cubre. Reutiliza
 * el motor de dos pasos ya construido para el pago presencial (Pre-16.1,
 * `reserveTokenSpend()`/`captureTokenSpend()`/`releaseTokenSpend()`) —
 * NUNCA `reserveAndCaptureTokenSpend()` (atómico): aquí la captura debe
 * diferirse hasta que el dinero restante también esté confirmado (patrón A,
 * spec §16/§13 de Pre-16.1, "reserve → capture after remaining payment
 * succeeds"). A diferencia del pago presencial, aquí NO hace falta un paso
 * de confirmación separado del Student — el propio Student, ya autenticado,
 * es quien inicia y ejecuta este checkout; su clic en "Pagar" ES la
 * autorización, no hace falta pedírsela dos veces.
 *
 * Solo se llama al PaymentProvider por `moneyDueCents` (el resto tras
 * aplicar SegoTokens), NUNCA por `order.totalCents` bruto — así, sin
 * pasarela real conectada (hoy: UnconfiguredPaymentProvider, siempre
 * "failed"), un pedido 100% cubierto por SegoTokens sigue completándose sin
 * tocar el provider (moneyDueCents=0), y uno con dinero pendiente falla
 * honestamente por el importe REAL que faltaría cobrar, nunca por el bruto.
 */
export async function initiatePayment(orderId: number, tokensToApply?: number, db?: DbHandle): Promise<InitiatePaymentResult> {
  const conn = db ?? (await getDb());
  const [order] = await conn.select().from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);
  if (!order) throw new CheckoutError("NOT_FOUND", "Order no encontrado");

  let tokenReservation: TokenSpendReservation | null = null;
  if (tokensToApply != null && tokensToApply > 0 && order.totalCents > 0) {
    if (!order.userId) throw new CheckoutError("STUDENT_REQUIRED", "Se necesita un Student identificado para aplicar SegoTokens");
    const [event] = await conn.select({ venueId: events.venueId }).from(events).where(eq(events.id, order.eventId)).limit(1);
    const reserveResult = await reserveTokenSpend({
      userId: order.userId,
      venueId: event?.venueId ?? null,
      eventId: order.eventId,
      grossAmountCents: order.totalCents,
      requestedTokens: tokensToApply,
      referenceType: "ticket_order",
      referenceId: order.id,
      idempotencyKey: `ticket_order_tokens:${orderId}`,
      createdByUserId: order.userId,
    }, conn);
    if (reserveResult.status !== "reserved") {
      throw new CheckoutError("TOKEN_SPEND_FAILED", "No se pudo aplicar SegoTokens a esta compra");
    }
    tokenReservation = reserveResult.reservation;
  }

  const moneyDueCents = tokenReservation ? tokenReservation.moneyDueCents : order.totalCents;
  const isFree = moneyDueCents === 0;
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
    if (tokenReservation) await releaseTokenSpend(tokenReservation.id, "order_could_not_transition_to_awaiting_payment", conn).catch(() => {});
    if (err instanceof OrderStateError) throw new CheckoutError(err.code, err.message);
    throw err;
  }

  const result = isFree
    ? { status: "succeeded" as const, externalPaymentId: null, redirectUrl: null, error: null }
    : await provider.createPayment({
        orderId,
        amountCents: moneyDueCents,
        currency: order.currency,
        idempotencyKey: paymentIdempotencyKey,
      });

  if (!existingPayment) {
    await conn.insert(ticketPayments).ignore().values({
      orderId,
      provider: isFree && tokenReservation ? "segolife_native_segotokens" : isFree ? "segolife_native_free" : provider.providerKey,
      externalPaymentId: result.externalPaymentId ?? null,
      amountCents: moneyDueCents,
      currency: order.currency,
      status: result.status === "succeeded" ? "succeeded" : result.status === "failed" ? "failed" : "pending",
      idempotencyKey: paymentIdempotencyKey,
      failureReason: result.error ?? null,
      metadata: {},
    });
  }

  if (result.status === "succeeded") {
    // La captura real del ledger ocurre AQUÍ, una única vez, ahora que el
    // dinero restante (si lo había) ya está confirmado — nunca antes. Si el
    // dinero acaba de confirmarse pero la captura falla (p.ej. la reserva
    // expiró en el tramo hospedado del provider, ventana de 15 min — spec
    // §12 "TTL alignment", igual que HOLD_DURATION_MINUTES), el pedido
    // completa igual: el dinero ya es real, no se le puede negar el ticket
    // al Student por un detalle interno del ledger sin más comprobación — se
    // delega en settleAfterMoneyConfirmed(), que ANTES de capturar nada
    // verifica que el hold siga siendo válido (gate de seguridad económica
    // Pre-16.2 §1/§2: nunca aforo vendido dos veces, nunca ticket emitido
    // sin que el tramo de SegoTokens se haya capturado de verdad — si algo
    // de esto falla con dinero real ya cobrado, se compensa o se deja en
    // reconciliation_required, nunca "paid" silencioso).
    return settleAfterMoneyConfirmed(order, conn, {
      externalPaymentId: result.externalPaymentId ?? null,
      realMoneyCollectedCents: isFree ? 0 : moneyDueCents,
      tokenReservationId: tokenReservation?.id ?? null,
      paymentMethod: tokenReservation ? (moneyDueCents === 0 ? "segotokens" : "mixed") : null,
    });
  }

  if (result.status === "pending" && result.redirectUrl) {
    // Proveedor con checkout hospedado (futuro real) — el order queda
    // awaiting_payment hasta que un webhook llame a confirmPaymentByWebhook().
    // La reserva de SegoTokens sigue "reserved" (nunca capturada todavía) —
    // se enlaza al order YA, sin esperar al webhook, para que
    // confirmPaymentByWebhook() pueda encontrarla y capturarla cuando el
    // dinero se confirme. A diferencia de los enlaces "best-effort" del
    // resto de este dominio (p.ej. tokenReservationId en el pago
    // presencial), este SÍ debe propagar el error si falla — sin él, el
    // webhook no podría capturar nunca y el pedido quedaría pagado sin que
    // el dinero recibiera su parte en SegoTokens de vuelta al Student ni al
    // ledger (ni capturado ni liberado).
    if (tokenReservation) {
      await conn.update(ticketOrders).set({ tokenReservationId: tokenReservation.id }).where(eq(ticketOrders.id, orderId));
    }
    return { order: awaitingOrder, paymentStatus: "pending", redirectUrl: result.redirectUrl };
  }

  // Sin proveedor real (o rechazo) — vuelve a pending para no dejar el hold
  // atrapado en awaiting_payment sin ninguna vía de completar el pago; el
  // hold sigue vigente hasta expiresAt, el estudiante puede reintentar.
  // Libera (nunca revierte) — la reserva nunca llegó a capturarse en este
  // camino.
  if (tokenReservation) await releaseTokenSpend(tokenReservation.id, "money_leg_failed_or_no_provider", conn).catch(() => {});
  await transitionOrderStatus(orderId, ["awaiting_payment"], "pending", {}, conn).catch(() => null);
  return { order, paymentStatus: "failed", error: result.error ?? "No se pudo iniciar el pago" };
}

/**
 * Punto de entrada para un futuro webhook de un proveedor real — nunca se
 * llama sin `provider.verifyWebhook()` haber validado la firma primero.
 *
 * IDEMPOTENCIA (Pre-16.2 gate §4/§7 "webhook duplicado/tardío"): un
 * reintento del provider (o una redundancia real del propio webhook)
 * después de que una llamada anterior ya resolvió este order — a `paid`,
 * `refunded` o `reconciliation_required` — nunca se reprocesa. Solo
 * `awaiting_payment` es un estado accionable aquí; cualquier otro implica
 * que ya se resolvió (con éxito o mediante la compensación/reconciliación
 * de settleAfterMoneyConfirmed) y esta llamada es un no-op seguro.
 */
export async function confirmPaymentByWebhook(orderId: number, externalPaymentId: string, db?: DbHandle): Promise<InitiatePaymentResult> {
  const conn = db ?? (await getDb());
  const [order] = await conn.select().from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);
  if (!order) throw new CheckoutError("NOT_FOUND", "Order no encontrado");

  if (order.status === "paid") {
    const tickets = await issueTicketsForOrder(order, conn);
    return { order, paymentStatus: "succeeded", tickets };
  }
  if (order.status !== "awaiting_payment") {
    return { order, paymentStatus: "failed", error: `El pedido ya está en estado '${order.status}' — no admite una nueva confirmación de pago` };
  }

  // El webhook solo confirma orderId+externalPaymentId (payload verificado,
  // ver ticketPaymentWebhookRoutes.ts) — el importe real cobrado se lee del
  // registro propio ya creado por initiatePayment() al pasar a
  // awaiting_payment (siempre > 0 aquí: el camino 100% SegoTokens/gratuito
  // nunca llega a awaiting_payment con un provider real de por medio, ver
  // cabecera de initiatePayment).
  const [payment] = await conn.select().from(ticketPayments).where(eq(ticketPayments.orderId, orderId)).limit(1);
  return settleAfterMoneyConfirmed(order, conn, {
    externalPaymentId,
    realMoneyCollectedCents: payment?.amountCents ?? 0,
    tokenReservationId: order.tokenReservationId,
    paymentMethod: order.tokenReservationId != null ? "mixed" : null,
  });
}
