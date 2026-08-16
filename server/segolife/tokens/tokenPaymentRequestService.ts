/**
 * tokenPaymentRequestService.ts — SEGOLIFE PRE-16.1: PRESENTIAL SEGOTOKENS
 * PAYMENTS (Venue TPV + Door Ticketing). Motor de AUTORIZACIÓN del Student
 * sobre un gasto presencial de SegoTokens — envuelve tokenSpendService.ts,
 * nunca lo reimplementa: reservar/capturar/liberar siguen siendo
 * exactamente reserveTokenSpend()/captureTokenSpend()/releaseTokenSpend(),
 * llamados TAL CUAL desde aquí.
 *
 * REGLA DE SEGURIDAD FUNDAMENTAL (spec §2): identificar a un Student
 * (escaneo de su QR permanente) NUNCA autoriza un gasto por sí solo. Un
 * operador de venue solo puede SOLICITAR (requestTokenPayment) — el gasto
 * real (captureTokenSpend, dentro de settleTokenPaymentRequest) solo ocurre
 * si el Student, desde su propio teléfono, confirmó primero. Este archivo es
 * la ÚNICA vía para que un flujo presencial (POS/puerta) mueva SegoTokens —
 * nativeCommerceService.ts/doorSaleService.ts nunca vuelven a llamar
 * reserveAndCaptureTokenSpend() para un Student identificado por staff.
 *
 * CICLO DE VIDA (ver comentario de la tabla en drizzle/schema.ts):
 *   pending → confirmed → settled   (Student aprueba, operador liquida)
 *   pending → rejected              (Student rechaza — libera al instante)
 *   pending|confirmed → cancelled   (operador aborta — libera al instante)
 *   pending|confirmed → expired     (nadie respondió a tiempo — libera al instante)
 *
 * La CAPTURA real del ledger se difiere hasta settleTokenPaymentRequest —
 * nunca ocurre en confirm(). Esto implementa el patrón A del spec §16
 * ("reserve ST → capture after remaining payment succeeds"): si el cobro del
 * dinero restante falla tras la confirmación del Student, el operador solo
 * necesita cancelar (libera la reserva, nunca revertida porque nunca se
 * capturó) — no hace falta ninguna lógica de compensación nueva.
 */
import { eq, and, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { tokenPaymentRequests, tokenSpendReservations, venues, userCommunities, communities, type TokenPaymentRequest, type TokenSpendReservation } from "../../../drizzle/schema";
import { reserveTokenSpend, captureTokenSpend, releaseTokenSpend, type QuoteInput } from "./tokenSpendService";
import type { AnyDbHandle } from "./tokenLedgerService";
import { createNotification } from "../engagement/notificationService";
import { renderTemplate } from "../engagement/templates";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type OrderContextType = "pos" | "door";

export type TokenPaymentRequestErrorCode =
  | "NO_POLICY" | "INVALID_AMOUNT" | "NOT_FOUND" | "INVALID_STATE" | "EXPIRED" | "NOT_OWNER" | "CONTEXT_MISMATCH";

export class TokenPaymentRequestError extends Error {
  code: TokenPaymentRequestErrorCode;
  constructor(code: TokenPaymentRequestErrorCode, message: string) {
    super(message);
    this.name = "TokenPaymentRequestError";
    this.code = code;
  }
}

export interface RequestTokenPaymentInput extends QuoteInput {
  orderContextType: OrderContextType;
  idempotencyKey: string;
  /** Operador que solicita — igual que createdByUserId en reserveTokenSpend (spec §18: nunca confiar en un venueId/operatorId del navegador, el router ya lo resolvió vía RBAC/venue_staff antes de llegar aquí). */
  operatorUserId: number;
}

export interface RequestTokenPaymentResult {
  request: TokenPaymentRequest;
  reservation: TokenSpendReservation;
}

/** Fila + reserva juntas, tal como las pantallas de operador/Student necesitan mostrarlas — nunca se duplica ningún campo económico, todo se lee de la reserva vía join. */
export interface TokenPaymentRequestView {
  request: TokenPaymentRequest;
  reservation: TokenSpendReservation;
  /** Estado EFECTIVO — puede diferir de request.status si la reserva expiró y nadie ha vuelto a leerla todavía (expiración perezosa, spec §13: sin cron activo). */
  effectiveStatus: TokenPaymentRequest["status"];
}

function deriveEffectiveStatus(request: TokenPaymentRequest, reservation: TokenSpendReservation): TokenPaymentRequest["status"] {
  if ((request.status === "pending" || request.status === "confirmed") && reservation.expiresAt.getTime() < Date.now()) {
    return "expired";
  }
  return request.status;
}

/** Lectura simple, sin lock — para polling (spec §7: cada 10-20s desde operador y Student, nunca debe serializar escrituras). */
async function loadViewReadOnly(tx: AnyDbHandle, requestId: number): Promise<TokenPaymentRequestView> {
  const [request] = await tx.select().from(tokenPaymentRequests).where(eq(tokenPaymentRequests.id, requestId)).limit(1);
  if (!request) throw new TokenPaymentRequestError("NOT_FOUND", "Solicitud de pago no encontrada");
  const [reservation] = await tx.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.id, request.tokenReservationId)).limit(1);
  if (!reservation) throw new TokenPaymentRequestError("NOT_FOUND", "Reserva asociada no encontrada");
  return { request, reservation, effectiveStatus: deriveEffectiveStatus(request, reservation) };
}

/** Lectura con FOR UPDATE — solo para mutaciones (confirm/reject/cancel/settle), mismo patrón exacto que tokenSpendService.ts (spec §11 CRITICAL: serializa dos acciones concurrentes sobre la misma solicitud). */
async function loadViewLocked(tx: TxHandle, requestId: number): Promise<TokenPaymentRequestView> {
  const [request] = await tx.select().from(tokenPaymentRequests).where(eq(tokenPaymentRequests.id, requestId)).limit(1).for("update");
  if (!request) throw new TokenPaymentRequestError("NOT_FOUND", "Solicitud de pago no encontrada");
  const [reservation] = await tx.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.id, request.tokenReservationId)).limit(1).for("update");
  if (!reservation) throw new TokenPaymentRequestError("NOT_FOUND", "Reserva asociada no encontrada");
  return { request, reservation, effectiveStatus: deriveEffectiveStatus(request, reservation) };
}

/**
 * Si el estado efectivo es "expired" pero la fila todavía dice
 * pending/confirmed, persiste la transición y libera la reserva —
 * expiración perezosa (spec §13), nunca un worker/cron activo. Cualquier
 * lectura (poll del operador, poll del Student, intento de confirmar)
 * dispara esto — así el estado en BD converge solo, sin depender de que
 * nadie lo cancele a mano.
 */
async function reconcileExpiry(tx: TxHandle, view: TokenPaymentRequestView): Promise<TokenPaymentRequestView> {
  if (view.effectiveStatus !== "expired" || view.request.status === "expired") return view;
  await tx.update(tokenPaymentRequests).set({ status: "expired", respondedAt: view.request.respondedAt ?? new Date() }).where(eq(tokenPaymentRequests.id, view.request.id));
  if (view.reservation.status === "reserved") {
    await releaseTokenSpend(view.reservation.id, "expired", tx);
  }
  const [request] = await tx.select().from(tokenPaymentRequests).where(eq(tokenPaymentRequests.id, view.request.id)).limit(1);
  return { ...view, request, effectiveStatus: "expired" };
}

// ─── 1. SOLICITAR (operador) ────────────────────────────────────────────────

export async function requestTokenPayment(input: RequestTokenPaymentInput, db?: DbHandle): Promise<RequestTokenPaymentResult> {
  const conn = db ?? (await getDb());
  const wasIdempotentRetry = await conn.select().from(tokenPaymentRequests).where(eq(tokenPaymentRequests.idempotencyKey, input.idempotencyKey)).limit(1).then(r => r.length > 0);

  const result = await conn.transaction(async (tx) => {
    // Idempotencia de la SOLICITUD misma (doble tap del operador, spec §12)
    // — reserveTokenSpend ya es idempotente por su propia idempotencyKey,
    // pero necesitamos la fila de request existente, no solo la reserva.
    const [existingRequest] = await tx.select().from(tokenPaymentRequests).where(eq(tokenPaymentRequests.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existingRequest) {
      const [reservation] = await tx.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.id, existingRequest.tokenReservationId)).limit(1);
      return { request: existingRequest, reservation: reservation! };
    }

    const reserveResult = await reserveTokenSpend({
      userId: input.userId,
      venueId: input.venueId,
      eventId: input.eventId,
      communityId: input.communityId,
      grossAmountCents: input.grossAmountCents,
      requestedTokens: input.requestedTokens,
      referenceType: "token_payment_request",
      idempotencyKey: `token_payment_request_reserve:${input.idempotencyKey}`,
      createdByUserId: input.operatorUserId,
    }, tx);

    if (reserveResult.status === "no_policy") throw new TokenPaymentRequestError("NO_POLICY", "No hay ninguna política de canje de SegoTokens activa");
    if (reserveResult.status === "invalid_amount") throw new TokenPaymentRequestError("INVALID_AMOUNT", "Importe de SegoTokens no válido (saldo insuficiente o por debajo del mínimo)");

    const [insertResult] = await tx.insert(tokenPaymentRequests).values({
      tokenReservationId: reserveResult.reservation.id,
      status: "pending",
      idempotencyKey: input.idempotencyKey,
      orderContextType: input.orderContextType,
    });
    const insertId = (insertResult as unknown as { insertId: number }).insertId;
    const [request] = await tx.select().from(tokenPaymentRequests).where(eq(tokenPaymentRequests.id, insertId)).limit(1);

    return { request, reservation: reserveResult.reservation };
  });

  // Notificar al Student (spec §5/§6) — SIEMPRE fuera de la transacción de
  // arriba: un fallo al notificar nunca debe hacer rollback de una reserva
  // ya comprometida contra el saldo del Student. Solo en la creación real
  // (nunca en un reintento idempotente — ya se notificó la primera vez).
  if (!wasIdempotentRetry) {
    await notifyStudentOfPaymentRequest(result).catch(() => {});
  }

  return result;
}

async function notifyStudentOfPaymentRequest(result: RequestTokenPaymentResult): Promise<void> {
  const conn = await getDb();
  const [venue] = result.reservation.venueId != null
    ? await conn.select({ name: venues.name }).from(venues).where(eq(venues.id, result.reservation.venueId)).limit(1)
    : [null];
  const [membership] = await conn.select({ communityId: userCommunities.communityId })
    .from(userCommunities).where(eq(userCommunities.userId, result.reservation.userId)).orderBy(asc(userCommunities.joinedAt)).limit(1);
  let communitySlug: string | null = null;
  if (membership?.communityId != null) {
    const [community] = await conn.select({ slug: communities.slug }).from(communities).where(eq(communities.id, membership.communityId)).limit(1);
    communitySlug = community?.slug ?? null;
  }
  if (!communitySlug) return; // sin comunidad resuelta no hay deep_link válido (sanitizeDeepLink exige prefijo /:slug) — el Student sigue viendo la solicitud vía polling (myPending)

  const rendered = renderTemplate(
    "token_payment_requested",
    { venueName: venue?.name ?? "Un venue", requestedTokens: String(result.reservation.tokensReserved) },
    `/${communitySlug}/payment-requests/${result.request.id}`,
  );
  await createNotification({
    userId: result.reservation.userId,
    communityId: membership?.communityId ?? null,
    type: "token_payment_requested",
    category: "account",
    audienceType: "transactional",
    rendered,
    templateKey: "token_payment_requested",
    templateVersion: 1,
    sourceType: "token_payment_request",
    sourceId: result.request.id,
    idempotencyKey: `token_payment_requested:${result.request.id}`,
    additionalChannels: [],
    sendImmediately: true,
  });
}

// ─── 2. CONSULTAR (operador Y Student, cada uno con su propia comprobación de propiedad en el router) ──

export async function getTokenPaymentRequestView(requestId: number, db?: DbHandle): Promise<TokenPaymentRequestView> {
  const conn = db ?? (await getDb());
  return conn.transaction(async (tx) => reconcileExpiry(tx, await loadViewReadOnly(tx, requestId)));
}

/** Solicitudes pendientes/confirmadas-sin-liquidar de un Student — puede haber más de una a la vez (spec §11: dos venues compitiendo por el mismo saldo es un caso real, no un bug). */
export async function listMyOpenTokenPaymentRequests(userId: number, db?: DbHandle): Promise<TokenPaymentRequestView[]> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({ request: tokenPaymentRequests, reservation: tokenSpendReservations })
    .from(tokenPaymentRequests)
    .innerJoin(tokenSpendReservations, eq(tokenPaymentRequests.tokenReservationId, tokenSpendReservations.id))
    .where(and(eq(tokenSpendReservations.userId, userId), eq(tokenPaymentRequests.status, "pending")));
  return rows
    .map(({ request, reservation }) => ({
      request, reservation,
      effectiveStatus: (reservation.expiresAt.getTime() < Date.now() ? "expired" : request.status) as TokenPaymentRequest["status"],
    }))
    .filter(v => v.effectiveStatus === "pending"); // las ya expiradas se reconcilian de forma perezosa cuando el Student intenta abrirlas, no aquí (lectura de lista, sin escritura)
}

// ─── 3. CONFIRMAR (Student — nunca captura el ledger todavía, spec §16 patrón A) ──

export async function confirmTokenPaymentRequest(requestId: number, studentUserId: number, db?: DbHandle): Promise<TokenPaymentRequestView> {
  const conn = db ?? (await getDb());
  return conn.transaction(async (tx) => {
    let view = await reconcileExpiry(tx, await loadViewLocked(tx, requestId));
    if (view.reservation.userId !== studentUserId) throw new TokenPaymentRequestError("NOT_OWNER", "Esta solicitud no pertenece a este Student");
    if (view.effectiveStatus === "expired") throw new TokenPaymentRequestError("EXPIRED", "La solicitud ha caducado");
    if (view.request.status !== "pending") throw new TokenPaymentRequestError("INVALID_STATE", `No se puede confirmar una solicitud en estado '${view.request.status}'`);

    await tx.update(tokenPaymentRequests).set({ status: "confirmed", respondedAt: new Date() }).where(eq(tokenPaymentRequests.id, requestId));
    const [request] = await tx.select().from(tokenPaymentRequests).where(eq(tokenPaymentRequests.id, requestId)).limit(1);
    return { ...view, request, effectiveStatus: "confirmed" };
  });
}

// ─── 4. RECHAZAR (Student — libera de inmediato, nunca espera al operador) ──

export async function rejectTokenPaymentRequest(requestId: number, studentUserId: number, db?: DbHandle): Promise<TokenPaymentRequestView> {
  const conn = db ?? (await getDb());
  return conn.transaction(async (tx) => {
    let view = await reconcileExpiry(tx, await loadViewLocked(tx, requestId));
    if (view.reservation.userId !== studentUserId) throw new TokenPaymentRequestError("NOT_OWNER", "Esta solicitud no pertenece a este Student");
    if (view.effectiveStatus === "expired") return view; // idempotente — ya liberada por reconcileExpiry
    if (view.request.status !== "pending") throw new TokenPaymentRequestError("INVALID_STATE", `No se puede rechazar una solicitud en estado '${view.request.status}'`);

    await tx.update(tokenPaymentRequests).set({ status: "rejected", respondedAt: new Date() }).where(eq(tokenPaymentRequests.id, requestId));
    if (view.reservation.status === "reserved") {
      await releaseTokenSpend(view.reservation.id, "student_rejected", tx);
    }
    const [request] = await tx.select().from(tokenPaymentRequests).where(eq(tokenPaymentRequests.id, requestId)).limit(1);
    return { ...view, request, effectiveStatus: "rejected" };
  });
}

// ─── 5. CANCELAR (operador — spec §14/§16: antes O después de que el Student confirme, p.ej. el cobro del dinero restante falla) ──

export async function cancelTokenPaymentRequest(requestId: number, operatorUserId: number, db?: DbHandle): Promise<TokenPaymentRequestView> {
  const conn = db ?? (await getDb());
  return conn.transaction(async (tx) => {
    let view = await reconcileExpiry(tx, await loadViewLocked(tx, requestId));
    if (view.effectiveStatus === "expired") return view; // idempotente
    if (view.request.status !== "pending" && view.request.status !== "confirmed") {
      throw new TokenPaymentRequestError("INVALID_STATE", `No se puede cancelar una solicitud en estado '${view.request.status}'`);
    }

    await tx.update(tokenPaymentRequests).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(tokenPaymentRequests.id, requestId));
    if (view.reservation.status === "reserved") {
      await releaseTokenSpend(view.reservation.id, `operator_cancelled:${operatorUserId}`, tx);
    }
    const [request] = await tx.select().from(tokenPaymentRequests).where(eq(tokenPaymentRequests.id, requestId)).limit(1);
    return { ...view, request, effectiveStatus: "cancelled" };
  });
}

// ─── 6. LIQUIDAR (paso de la venta final en nativeCommerceService/doorSaleService, ANTES de crear la orden — mismo orden que el flujo síncrono ya existente: capturar primero, crear la orden después, para que la compensación catch-and-reverse ya existente en esos servicios siga funcionando sin cambios si la orden falla después) ──

export interface SettleResult {
  request: TokenPaymentRequest;
  reservation: TokenSpendReservation;
}

/**
 * Captura el ledger (única vez que esto ocurre en todo el flujo presencial).
 * Deliberadamente NO recibe el id de la orden todavía — la orden
 * (commerce_transactions/ticket_orders) se crea DESPUÉS de esto, igual que
 * hoy reserveAndCaptureTokenSpend() ya se llama antes de ingestCommerceTransaction
 * (nativeCommerceService.ts) — así, si la creación de la orden falla luego,
 * el catch-and-reverse ya existente en esos servicios seguía sin cambios.
 * El enlace `settledOrderId` se rellena aparte, best-effort, con
 * linkSettledOrder() — mismo criterio exacto que el enlace ya existente de
 * `commerceTransactions.tokenReservationId` (best-effort, nunca la fuente de
 * verdad económica).
 */
export async function settleTokenPaymentRequest(requestId: number, orderContextType: OrderContextType, db?: DbHandle): Promise<SettleResult> {
  const conn = db ?? (await getDb());
  return conn.transaction(async (tx) => {
    const view = await loadViewLocked(tx, requestId);
    if (view.request.orderContextType !== orderContextType) throw new TokenPaymentRequestError("CONTEXT_MISMATCH", "Esta solicitud no corresponde a este tipo de venta");
    // Idempotente (spec §12 "network retry"/"duplicate request"): un
    // reintento del operador tras un fallo a mitad de camino (la orden no
    // llegó a crearse la primera vez) no debe volver a intentar capturar —
    // devuelve el mismo resultado ya liquidado, sin tocar el ledger de nuevo.
    if (view.request.status === "settled") return { request: view.request, reservation: view.reservation };
    if (view.reservation.expiresAt.getTime() < Date.now()) throw new TokenPaymentRequestError("EXPIRED", "La solicitud ha caducado");
    if (view.request.status !== "confirmed") throw new TokenPaymentRequestError("INVALID_STATE", `No se puede liquidar una solicitud en estado '${view.request.status}' — el Student debe confirmar primero`);

    const captureResult = await captureTokenSpend(view.reservation.id, tx);

    await tx.update(tokenPaymentRequests).set({ status: "settled", settledAt: new Date() }).where(eq(tokenPaymentRequests.id, requestId));
    const [request] = await tx.select().from(tokenPaymentRequests).where(eq(tokenPaymentRequests.id, requestId)).limit(1);
    return { request, reservation: captureResult.reservation };
  });
}

/** Enlace best-effort al pedido ya creado — mismo criterio que el enlace `commerceTransactions.tokenReservationId` (nunca la fuente de verdad económica, solo un atajo de navegación/auditoría). Nunca debe lanzar. */
export async function linkSettledOrder(requestId: number, orderId: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(tokenPaymentRequests).set({ settledOrderId: orderId }).where(eq(tokenPaymentRequests.id, requestId)).catch(() => {});
}
