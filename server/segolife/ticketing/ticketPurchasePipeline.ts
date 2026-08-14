/**
 * ticketPurchasePipeline.ts — ÚNICO punto de entrada para convertir un
 * PEDIDO normalizado de un proveedor externo (Fourvenues hoy) en
 * `ticket_orders` + `ticket_order_items` + `event_tickets` + loyalty (Fase
 * "Fourvenues Operational Sync"). Mismo criterio arquitectónico que
 * attendancePipeline.ts/commercePipeline.ts: ningún adapter llama a
 * earnTokens/evaluateBenefitsForOrigin directamente, solo este pipeline —
 * FOURVENUES → normalized operation → identity resolution → este pipeline →
 * TOKEN ENGINE, nunca un atajo.
 *
 * SEMÁNTICA DE "ORDER" (spec §18): la Integrations API de Fourvenues NO
 * tiene endpoint nativo de pedido — un `NormalizedOrder` es un GRUPO DE
 * TICKETS QUE COMPARTEN `payment_id` (ver fourvenuesIntegrationsAdapter.ts).
 * `externalOrderId` = ese `payment_id`, nunca un id inventado.
 *
 * BUYER vs PARTICIPANT (spec §24, CRÍTICO): la identidad del COMPRADOR
 * (`order.userId`) solo determina a quién pertenece el pedido y quién recibe
 * el reward de COMPRA (origin="ticket", ver `grantPurchaseLoyalty` — es un
 * hecho a nivel de PEDIDO, no de entrada individual). La identidad de cada
 * PARTICIPANTE se resuelve por separado, por ticket — nunca se hereda del
 * comprador salvo que sean semánticamente la misma persona (mismo criterio
 * que identityResolver.ts ya aplica). Esto es lo que evita premiar al
 * comprador de 4 entradas 4 veces por asistencia (esa protección vive en
 * attendancePipeline.ts, Case B) — aquí solo se resuelve identidad de
 * compra/participante, sin conceder tokens de asistencia.
 *
 * IDEMPOTENCIA:
 *  - Pedido: UNIQUE (provider, external_order_id) en ticket_orders — un
 *    mismo pedido re-sincronizado nunca duplica items/tickets, solo
 *    actualiza estado (ver `updateExistingOrder`).
 *  - Ticket: UNIQUE (provider, external_ticket_id) en event_tickets.
 *  - Reward de compra: idempotency_key = `ticket_purchase:${provider}:
 *    ${integrationType}:${integrationId}:${eventId}:${buyerUserId}` — SIN
 *    external_order_id, a propósito (spec §33 V1: máximo UNA recompensa de
 *    compra por Student+Event, sin importar cuántos pedidos/tickets compre).
 *
 * CUTOFF HISTÓRICO (spec §39-40): `loyaltyEffectiveFrom` (si se pasa) evita
 * conceder tokens/Benefits por compras anteriores a esa fecha — el pedido,
 * los tickets y el Student 360 derivado SIEMPRE se persisten igual.
 *
 * `suppressLoyalty` (Casanova Historical Validation, spec §22/§27) es un
 * override EXPLÍCITO por encima de `loyaltyEffectiveFrom` — para un import
 * histórico deliberado no queremos depender solo de una comparación de
 * fechas (que podría tener un bug de zona horaria o un `purchasedAt` nulo);
 * `suppressLoyalty: true` fuerza el modo histórico sin condiciones.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  ticketOrders, ticketOrderItems, eventTickets,
  type TicketOrder, type EventTicket,
} from "../../../drizzle/schema";
import { earnTokens } from "../tokens/tokenEngine";
import { evaluateBenefitsForOrigin } from "../benefits/benefitRuleEngine";
import { resolveIdentity, persistIdentityMapping, isConfirmedResolutionMethod } from "../integrations/identityResolver";
import { recordUnresolvedOperation } from "../integrations/unresolvedOperationsService";
import { transitionOrderStatus, OrderStateError, type TicketOrderStatus } from "./orderStateMachine";
import { emitEngagementEvent } from "../engagement/engagementEvents";
import type { NormalizedOrder, NormalizedTicket } from "../integrations/externalTicketingProvider";
import { TokenEngineError, reverseTransaction, isLedgerEntryReversed } from "../tokens/tokenLedgerService";
import { resolveLoyaltyCutoff, isBeforeCutoff } from "../tokens/loyaltyCutoffService";
import {
  buildNextAttempt, buildRegeneratedAttempt, shouldAttemptReward,
  type RewardAttempt, type DenialReasonCode,
} from "../tokens/rewardStateMachine";
import { observeShadow } from "../tokens/loyaltyShadowService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface IngestTicketPurchaseInput {
  provider: string;
  integrationType: "venue_integration" | "event_integration";
  integrationId: number;
  eventId: number;
  venueId?: number | null;
  communityId?: number | null;
  salesChannelId?: number | null;
  order: NormalizedOrder;
  /** Tickets de ESTE pedido (mismo externalOrderId) — ya normalizados por el adapter. */
  tickets: NormalizedTicket[];
  /** Mapeo externalTicketTypeId → event_ticket_types.id, ya resuelto por eventCatalogSync (sync). Sin I/O aquí. */
  resolveTicketTypeId: (externalTicketTypeId: string | null | undefined) => number | null;
  /** spec §39 — compras anteriores a esta fecha NUNCA generan tokens/Benefits, aunque sí se persisten. */
  loyaltyEffectiveFrom?: Date | null;
  /** Import histórico — override explícito, ver nota arriba. Nunca concede tokens/Benefits; sí persiste order/tickets. */
  suppressLoyalty?: boolean;
  /**
   * LOYALTY SHADOW MODE — distinto de `suppressLoyalty` (spec §9). Ver nota
   * gemela en attendancePipeline.ts: `suppressLoyalty` puede ser `true` solo
   * porque el venue tiene `loyalty_enabled=false` en un sync EN VIVO (Shadow
   * SÍ debe observar ese caso); `isHistoricalImport=true` marca en cambio
   * una reconstrucción retroactiva de datos ya viejos — Shadow NUNCA debe
   * observarla. Por defecto `false` (tráfico en vivo).
   */
  isHistoricalImport?: boolean;
}

export type IngestTicketPurchaseResult =
  | { status: "created"; order: TicketOrder; ticketsCreated: number; unresolvedTickets: number }
  | { status: "updated"; order: TicketOrder; reconciliationRequired: boolean }
  | { status: "unchanged"; order: TicketOrder };

function mapOrderStatus(status: NormalizedOrder["status"]): TicketOrderStatus {
  switch (status) {
    case "pending": return "pending";
    case "paid": return "paid";
    case "cancelled": return "cancelled";
    case "refunded": return "refunded";
    case "failed": return "failed";
  }
}

/**
 * `generation` (Loyalty Production Hardening, spec §3) — 0 en el primer
 * intento (formato IDÉNTICO al histórico, sin sufijo, retrocompatible con
 * cualquier idempotency_key real ya escrita), incrementa solo cuando una
 * recompensa ya concedida fue revertida (refund) y el pedido vuelve a
 * "paid" — permite un re-grant legítimo sin arriesgar una doble recompensa
 * (el UNIQUE de idempotency_key sigue protegiendo dentro de cada generación).
 */
function buildPurchaseIdempotencyKey(input: IngestTicketPurchaseInput, buyerUserId: number, generation: number): string {
  const base = `ticket_purchase:${input.provider}:${input.integrationType}:${input.integrationId}:${input.eventId}:${buyerUserId}`;
  return generation > 0 ? `${base}:gen${generation}` : base;
}

function toDenialReason(code: string): DenialReasonCode | null {
  return code === "NO_RULE_FOUND" || code === "RULE_LIMIT_EXCEEDED" || code === "OUTSIDE_SCHEDULE" || code === "GLOBAL_LIVE_DISABLED" ? code : null;
}

/**
 * LOYALTY SHADOW MODE — construye la observación para el pedido, sea cual
 * sea `order.userId` (incluido `null`: identity gate real, spec §2 — nunca
 * se llama a evaluateReward para una identidad histórica sin Student
 * resuelto, loyaltyShadowService.ts registra NO_STUDENT y se detiene ahí).
 * `observeShadow()` nunca lanza y es un no-op inmediato si Shadow está OFF —
 * seguro llamarlo incondicionalmente en cada punto de transición real.
 */
function buildPurchaseShadowInput(
  input: IngestTicketPurchaseInput, order: TicketOrder, trigger: "EVENT_PURCHASE" | "PENDING_TO_PAID" | "EVENT_REFUND", operationState: string
) {
  return {
    provider: input.provider, externalOperationId: input.order.externalId, trigger, operationState,
    userId: order.userId, venueId: input.venueId ?? null, eventId: input.eventId, communityId: input.communityId ?? null,
    amountSpent: order.totalCents / 100, origin: "ticket" as const, occurredAt: order.purchasedAt ?? new Date(),
    integrationId: input.integrationId, loyaltyCutoffAt: input.loyaltyEffectiveFrom ?? null,
  };
}

/**
 * Concede el reward de COMPRA (origin="ticket") — a lo sumo una vez por
 * Student+Event+generación, sin regla activa = 0 tokens (nunca falla el
 * pedido). `previousAttempt` (spec §4-5) alimenta la Reward State Machine —
 * null en la primera evaluación de un pedido nuevo; el intento previo
 * (posiblemente regenerado tras una reversión, ver `updateExistingOrder`)
 * en cualquier reintento posterior. `attempt` en el resultado es `null`
 * SOLO cuando la operación es histórica (nunca se evalúa, spec: ni siquiera
 * se registra un intento).
 */
async function grantPurchaseLoyalty(
  input: IngestTicketPurchaseInput,
  order: TicketOrder,
  buyerUserId: number,
  previousAttempt: RewardAttempt | null,
  conn: AnyDbHandle
): Promise<{ attempt: RewardAttempt | null; historical: boolean }> {
  const at = order.purchasedAt ?? new Date();
  const persistedCutoff = await resolveLoyaltyCutoff(input.integrationId, conn);
  const isHistorical = !!input.suppressLoyalty
    || (!!input.loyaltyEffectiveFrom && !!order.purchasedAt && order.purchasedAt < input.loyaltyEffectiveFrom)
    || isBeforeCutoff(at, persistedCutoff);
  if (isHistorical) return { attempt: null, historical: true };

  const generation = previousAttempt?.generation ?? 0;
  let outcome: { ledgerId: number | null; reason: DenialReasonCode | null };
  let ledgerId: number | null = null;
  try {
    const tokenResult = await earnTokens({
      userId: buyerUserId,
      communityId: input.communityId ?? null,
      venueId: input.venueId ?? null,
      eventId: input.eventId,
      amountSpent: order.totalCents / 100,
      origin: "ticket",
      sourceId: order.id,
      idempotencyKey: buildPurchaseIdempotencyKey(input, buyerUserId, generation),
      at,
    }, conn);
    ledgerId = tokenResult.ledger.id;
    outcome = { ledgerId, reason: null };
  } catch (err) {
    // sin regla origin="ticket" activa → NO_RULE_FOUND, comportamiento esperado (spec §31: "sin regla activa: 0 tokens") — igual que cualquier otra denegación, se registra en la Reward State Machine para poder explicar/reintentar.
    outcome = { ledgerId: null, reason: err instanceof TokenEngineError ? toDenialReason(err.code) : null };
  }

  await evaluateBenefitsForOrigin({
    type: "ticket",
    userId: buyerUserId,
    venueId: input.venueId ?? null,
    eventId: input.eventId,
    amountCents: order.totalCents,
    communityId: input.communityId ?? null,
    sourceId: order.id,
    ledgerId,
    occurredAt: at,
  }, conn).catch(() => []); // un fallo en Benefits nunca revierte el pedido ya registrado. Idempotente por sí solo — seguro en cada reintento.

  const attempt = buildNextAttempt(outcome, previousAttempt, at);
  return { attempt, historical: false };
}

/** Resuelve identidad de participante por ticket y persiste event_tickets + unresolved_operations (operationType="order", spec §46). */
async function persistTicketsForNewOrder(
  input: IngestTicketPurchaseInput,
  orderId: number,
  conn: AnyDbHandle
): Promise<{ created: EventTicket[]; unresolvedCount: number }> {
  const created: EventTicket[] = [];
  let unresolvedCount = 0;

  // `conn` puede ser el TxHandle de db.transaction() (tipo MySqlTransaction) — estructuralmente compatible en runtime con el DbHandle que esperan
  // identityResolver.ts/unresolvedOperationsService.ts (misma API de drizzle-orm), pero TypeScript no unifica ambos tipos a través de módulos
  // distintos — mismo workaround de cast que ya usa este archivo para insertResult (ver comentario de ticketingDb.ts, "mismo workaround").
  const identityDb = conn as unknown as Parameters<typeof resolveIdentity>[1];

  for (const t of input.tickets) {
    const identity = await resolveIdentity({
      provider: input.provider,
      participant: t.participant,
      buyer: input.order.buyer,
    }, identityDb);

    const [insertResult] = await conn.insert(eventTickets).ignore().values({
      eventId: input.eventId,
      ticketTypeId: input.resolveTicketTypeId(t.externalTicketTypeId),
      orderId,
      userId: identity.userId,
      salesChannel: "external",
      provider: input.provider,
      externalTicketId: t.externalId,
      status: t.status,
      issuedAt: t.purchasedAt ?? new Date(),
      metadata: {},
    });
    const insertId = (insertResult as unknown as { insertId: number }).insertId;
    if (!insertId) continue; // ya existía (carrera/reintento) — no duplicar

    const [row] = await conn.select().from(eventTickets).where(eq(eventTickets.id, insertId)).limit(1);
    created.push(row);

    if (!identity.userId) {
      unresolvedCount++;
      await recordUnresolvedOperation({
        operationType: "order",
        provider: input.provider,
        integrationType: input.integrationType,
        integrationId: input.integrationId,
        referenceType: "event_ticket",
        referenceId: row.id,
        externalReferenceId: t.externalId,
        eventId: input.eventId,
        venueId: input.venueId ?? null,
        occurredAt: t.purchasedAt ?? input.order.purchasedAt ?? new Date(),
        identityHintEmail: t.participant.email ?? null,
        identityHintPhone: t.participant.phone ?? null,
        identityHintName: t.participant.name ?? null,
        amountCents: t.amountPaidCents ?? null,
      }, conn as unknown as Parameters<typeof recordUnresolvedOperation>[1]);
    } else if (isConfirmedResolutionMethod(identity.method) && identity.method !== "previous_mapping") {
      await persistIdentityMapping({
        provider: input.provider,
        participant: t.participant,
        buyer: input.order.buyer,
        userId: identity.userId,
        method: identity.method,
      }, identityDb);
    }
  }

  return { created, unresolvedCount };
}

function groupItemsByTicketType(input: IngestTicketPurchaseInput): Array<{ ticketTypeId: number | null; quantity: number; totalPriceCents: number }> {
  const groups = new Map<number | null, { quantity: number; totalPriceCents: number }>();
  for (const t of input.tickets) {
    const ticketTypeId = input.resolveTicketTypeId(t.externalTicketTypeId);
    const g = groups.get(ticketTypeId) ?? { quantity: 0, totalPriceCents: 0 };
    g.quantity += 1;
    g.totalPriceCents += t.amountPaidCents ?? 0;
    groups.set(ticketTypeId, g);
  }
  return Array.from(groups.entries()).map(([ticketTypeId, g]) => ({
    ticketTypeId,
    quantity: g.quantity,
    totalPriceCents: g.totalPriceCents,
  }));
}

async function createNewOrder(input: IngestTicketPurchaseInput, db: DbHandle): Promise<IngestTicketPurchaseResult> {
  const buyerIdentity = await resolveIdentity({ provider: input.provider, participant: null, buyer: input.order.buyer }, db);
  if (isConfirmedResolutionMethod(buyerIdentity.method) && buyerIdentity.method !== "previous_mapping" && buyerIdentity.userId) {
    await persistIdentityMapping({ provider: input.provider, participant: null, buyer: input.order.buyer, userId: buyerIdentity.userId, method: buyerIdentity.method }, db);
  }

  const { orderId, unresolvedCount } = await db.transaction(async (tx) => {
    const [insertResult] = await tx.insert(ticketOrders).values({
      userId: buyerIdentity.userId,
      eventId: input.eventId,
      salesChannelId: input.salesChannelId ?? null,
      provider: input.provider,
      externalOrderId: input.order.externalId,
      externalPaymentId: input.order.externalPaymentId ?? null,
      status: mapOrderStatus(input.order.status),
      subtotalCents: input.order.subtotalCents,
      feesCents: input.order.feesCents,
      totalCents: input.order.totalCents,
      currency: input.order.currency,
      buyerName: input.order.buyer.name ?? null,
      buyerEmail: input.order.buyer.email ?? null,
      buyerPhone: input.order.buyer.phone ?? null,
      purchasedAt: input.order.purchasedAt ?? null,
      refundedAt: input.order.status === "refunded" ? new Date() : null,
      metadata: {},
    });
    const newOrderId = (insertResult as unknown as { insertId: number }).insertId;

    const items = groupItemsByTicketType(input);
    if (items.length > 0) {
      await tx.insert(ticketOrderItems).values(items.map(g => ({
        orderId: newOrderId,
        ticketTypeId: g.ticketTypeId,
        quantity: g.quantity,
        unitPriceCents: g.quantity > 0 ? Math.round(g.totalPriceCents / g.quantity) : 0,
        totalPriceCents: g.totalPriceCents,
      })));
    }

    const { unresolvedCount: uc } = await persistTicketsForNewOrder(input, newOrderId, tx);
    return { orderId: newOrderId, unresolvedCount: uc };
  });

  const [order] = await db.select().from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);

  if (buyerIdentity.userId && order.status === "paid") {
    const { attempt, historical } = await grantPurchaseLoyalty(input, order, buyerIdentity.userId, null, db);
    if (attempt) {
      await db.update(ticketOrders).set({
        metadata: {
          ...(order.metadata ?? {}),
          rewardAttempt: attempt,
          ...(attempt.ledgerId ? { purchaseLoyaltyLedgerId: attempt.ledgerId, purchaseLoyaltyGrantedAt: new Date().toISOString() } : {}),
        },
      }).where(eq(ticketOrders.id, orderId));
    }
    // Import histórico (spec §39-40): ni tokens/Benefits NI el domain event "en vivo" — evita que el Communication Center (aunque siga inactivo) llegue a tratar un backfill antiguo como una compra recién hecha.
    if (!historical) {
      emitEngagementEvent("ticket_purchased", { userId: buyerIdentity.userId, communityId: input.communityId ?? null, orderId, eventId: input.eventId });
    }
  }
  if (order.status === "paid" && !input.isHistoricalImport) {
    await observeShadow(buildPurchaseShadowInput(input, order, "EVENT_PURCHASE", order.status));
  }

  const [finalOrder] = await db.select().from(ticketOrders).where(eq(ticketOrders.id, orderId)).limit(1);
  return { status: "created", order: finalOrder, ticketsCreated: input.tickets.length, unresolvedTickets: unresolvedCount };
}

/**
 * Pedido ya existente (provider+externalOrderId) — spec §58: solo se
 * actualiza estado (nunca se recrean items/tickets).
 *
 * PENDING→PAID Y RETRY (spec §3): cualquier transición hacia "paid" desde
 * un estado no-paid intenta la recompensa de compra — nunca depende
 * exclusivamente de que el pedido sea nuevo (createNewOrder). Si el intento
 * previo (guardado en metadata.rewardAttempt) sigue siendo reintentable
 * (spec §5), se reintenta con la MISMA generación; si ya estaba GRANTED
 * pero el ledger fue revertido (refund anterior, ahora vuelve a paid), se
 * regenera (nueva generación, spec §3 test "refunded → paid").
 *
 * REVERSIÓN AUTOMÁTICA (spec §6): un refund sobre un pedido con recompensa
 * ya concedida y AÚN NO revertida dispara `reverseTransaction()`
 * automáticamente — `isLedgerEntryReversed` la hace idempotente (dos syncs
 * del mismo refund nunca generan una segunda reversión). Si la reversión
 * falla, se preserva el comportamiento histórico (loyaltyReconciliationRequired)
 * para resolución manual, en vez de perder el fallo silenciosamente.
 */
async function updateExistingOrder(input: IngestTicketPurchaseInput, existing: TicketOrder, db: DbHandle): Promise<IngestTicketPurchaseResult> {
  const newStatus = mapOrderStatus(input.order.status);
  const statusChanged = newStatus !== existing.status;

  const existingMeta = (existing.metadata ?? {}) as { rewardAttempt?: RewardAttempt; purchaseLoyaltyLedgerId?: number };
  const existingAttempt: RewardAttempt | null = existingMeta.rewardAttempt ?? null;
  const existingLedgerId = existingMeta.purchaseLoyaltyLedgerId ?? existingAttempt?.ledgerId ?? null;

  const becomingRefunded = statusChanged && (newStatus === "refunded" || newStatus === "partially_refunded");
  // isPaidNow (no solo "becomingPaid"): spec §3 pide reintentar también en un
  // "paid → paid" repetido si quedó una denegación temporal pendiente — no
  // solo en la transición. Un GRANTED ya concedido nunca se re-evalúa
  // (shouldAttemptReward lo filtra), así que esto es seguro para el caso
  // común (paid→paid sin nada pendiente) — no añade coste real.
  const isPaidNow = newStatus === "paid";

  let reconciliationRequired = false;
  const metadataPatch: Record<string, unknown> = {};

  // 1) Reversión automática — un refund sobre una recompensa ya concedida y aún no revertida.
  if (becomingRefunded && existingLedgerId != null) {
    const alreadyReversed = await isLedgerEntryReversed(existingLedgerId, db);
    if (!alreadyReversed) {
      try {
        await reverseTransaction({
          ledgerId: existingLedgerId,
          reason: `Fourvenues: pedido ${input.order.externalId} reembolsado — reversión automática`,
          adminUserId: null,
        }, db);
      } catch (err) {
        reconciliationRequired = true;
        metadataPatch.loyaltyReversalError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  // 2) Retry / regeneración — cualquier vez que el pedido esté "paid" reevalúa la recompensa si procede (spec §3: no depende solo de la transición).
  if (isPaidNow && existing.userId) {
    let attemptForRetry = existingAttempt;
    const wasReversed = !!existingAttempt && existingAttempt.status === "GRANTED" && existingAttempt.ledgerId != null
      && await isLedgerEntryReversed(existingAttempt.ledgerId, db);
    if (wasReversed) {
      attemptForRetry = buildRegeneratedAttempt(existingAttempt!);
    }
    if (shouldAttemptReward(attemptForRetry)) {
      const { attempt, historical } = await grantPurchaseLoyalty(input, existing, existing.userId, attemptForRetry, db);
      if (attempt) {
        metadataPatch.rewardAttempt = attempt;
        if (attempt.ledgerId) {
          metadataPatch.purchaseLoyaltyLedgerId = attempt.ledgerId;
          metadataPatch.purchaseLoyaltyGrantedAt = new Date().toISOString();
        }
        if (!historical && attempt.ledgerId) {
          emitEngagementEvent("ticket_purchased", { userId: existing.userId, communityId: input.communityId ?? null, orderId: existing.id, eventId: existing.eventId });
        }
      }
    }
  }
  // Shadow PENDING→PAID (spec §9) — solo en una transición REAL hacia "paid"
  // (statusChanged ya implica esto, ver definición de isPaidNow arriba: si
  // existing.status ya era "paid" esto nunca se cumple de nuevo).
  if (isPaidNow && existing.status !== "paid" && !input.isHistoricalImport) {
    await observeShadow(buildPurchaseShadowInput(input, existing, "PENDING_TO_PAID", newStatus));
  }

  if (!statusChanged) {
    // Ni transición de estado real ni ningún intento de recompensa nuevo — no-op real, sin tocar la fila.
    if (Object.keys(metadataPatch).length === 0) {
      await syncTicketStatuses(input, db);
      return { status: "unchanged", order: existing };
    }
    // Reintento sin transición de estado (p.ej. "paid → paid" con una denegación temporal que ahora sí se concede).
    await db.update(ticketOrders).set({ metadata: { ...(existing.metadata ?? {}), ...metadataPatch } }).where(eq(ticketOrders.id, existing.id));
    await syncTicketStatuses(input, db);
    const [refreshed] = await db.select().from(ticketOrders).where(eq(ticketOrders.id, existing.id)).limit(1);
    return { status: "unchanged", order: refreshed ?? existing };
  }

  let updated: TicketOrder;
  try {
    updated = await transitionOrderStatus(existing.id, [existing.status], newStatus, {
      refundedAt: becomingRefunded ? new Date() : existing.refundedAt,
      metadata: {
        ...(existing.metadata ?? {}),
        ...metadataPatch,
        ...(reconciliationRequired ? { loyaltyReconciliationRequired: true } : {}),
      },
    }, db);
  } catch (err) {
    if (!(err instanceof OrderStateError)) throw err;
    // Transición no reconocida (p.ej. datos del proveedor fuera de orden) — se marca para revisión manual, NUNCA se pierde el pedido ni se lanza la excepción hacia el sync run completo.
    await db.update(ticketOrders)
      .set({ status: "reconciliation_required", metadata: { ...(existing.metadata ?? {}), ...metadataPatch, reconciliationReason: err.message } })
      .where(eq(ticketOrders.id, existing.id));
    const [row] = await db.select().from(ticketOrders).where(eq(ticketOrders.id, existing.id)).limit(1);
    updated = row;
  }

  await syncTicketStatuses(input, db);

  if (becomingRefunded && existing.userId) {
    emitEngagementEvent("order_refunded", {
      userId: existing.userId,
      communityId: input.communityId ?? null,
      orderId: existing.id,
      eventId: input.eventId,
      amountCents: existing.totalCents,
      partial: newStatus === "partially_refunded",
    });
  }
  if (becomingRefunded && !input.isHistoricalImport) {
    // Shadow REFUND (spec §7-8) — busca su propia observación GRANTED previa
    // (EVENT_PURCHASE/PENDING_TO_PAID) y produce una reversión simulada;
    // nunca llama a reverseTransaction() real (eso ya ocurrió, si procedía,
    // en el paso 1 de arriba, sobre el ledger REAL, sin relación con Shadow).
    await observeShadow(buildPurchaseShadowInput(input, existing, "EVENT_REFUND", newStatus));
  }

  return { status: "updated", order: updated, reconciliationRequired };
}

/** Refleja refunded/used a nivel de ticket individual sin recrear filas — UPDATE por (provider, externalTicketId). */
async function syncTicketStatuses(input: IngestTicketPurchaseInput, db: DbHandle): Promise<void> {
  for (const t of input.tickets) {
    await db.update(eventTickets)
      .set({ status: t.status, refundedAt: t.status === "refunded" ? new Date() : undefined })
      .where(and(eq(eventTickets.provider, input.provider), eq(eventTickets.externalTicketId, t.externalId)));
  }
}

export async function ingestTicketPurchase(input: IngestTicketPurchaseInput, db?: DbHandle): Promise<IngestTicketPurchaseResult> {
  const conn = db ?? (await getDb());

  const [existing] = await conn.select().from(ticketOrders)
    .where(and(eq(ticketOrders.provider, input.provider), eq(ticketOrders.externalOrderId, input.order.externalId)))
    .limit(1);

  if (existing) return updateExistingOrder(input, existing, conn);
  return createNewOrder(input, conn);
}

/**
 * ingestPaymentlessTicket — Paymentless Tickets & Admissions Hardening
 * (2026-08-13). Persiste una entrada real de Fourvenues que NO tiene
 * `payment_id` (por tanto ningún `NormalizedOrder` la agrupa — ver
 * `listOrders`/`listTickets` en fourvenuesIntegrationsAdapter.ts) SIN
 * inventar un pedido/pago falso. Investigación real sobre la ventana oficial
 * de Casanova (junio 2026): 188/929 tickets crudos con este perfil, 100% con
 * `status=used` (asistieron), 100% con `amountPaidCents>0` (SÍ pagaron), 0%
 * con email/teléfono/nombre — perfil consistente de venta/validación en
 * puerta sin checkout online, nunca invitación/cortesía (eso tendría
 * price=0). Fourvenues no expone un campo de "canal" explícito que lo
 * confirme literalmente — se documenta como inferencia con alta confianza
 * a partir de un patrón 100% consistente, no como dato crudo del proveedor.
 *
 * TICKET != PURCHASE (principio explícito del encargo): `event_tickets` con
 * `order_id=null` es un estado YA SOPORTADO por el schema real (confirmado
 * contra information_schema.columns de producción — `order_id`/`user_id`
 * nullable, sin FK) — 0 migraciones. `metadata.amountPaidCents` preserva la
 * evidencia económica real del ticket (viene de `total_paid` de Fourvenues,
 * el mismo campo que ya alimenta el revenue de los pedidos con order) SIN
 * crear un `ticket_order`/`ticket_order_items` ficticio ni sumarla al
 * revenue agregado de pedidos — queda como una evidencia aparte, explícita,
 * nunca mezclada silenciosamente con GMV de compras reales.
 *
 * LOYALTY: esta función NUNCA llama a earnTokens/evaluateBenefitsForOrigin
 * ni emite domain events — la sola existencia de una entrada no concede
 * nada (igual que crear un `event_tickets` dentro de un pedido tampoco lo
 * hace; el reward de compra vive en `grantPurchaseLoyalty`, a nivel de
 * ORDEN, nunca de ticket individual). La asistencia real (si la hay) se
 * sigue ingiriendo por separado vía `ingestAttendance` (con su propio
 * `suppressLoyalty`), exactamente igual que para un ticket con order — este
 * pipeline no necesita ni expone su propio flag de loyalty porque
 * estructuralmente no hay nada que suprimir.
 *
 * IDENTIDAD: mismo resolver que el resto del sistema (`resolveIdentity`,
 * sin fuzzy matching), con `buyer: null` — un ticket sin order no tiene
 * comprador que ofrecer como fallback, solo el participante del propio
 * ticket. Si no resuelve, el ticket se persiste igual (`userId: null`, spec
 * "conservar ticket") y se registra en `unresolved_operations` reutilizando
 * `operationType: "order"` (mismo valor que ya usa `persistTicketsForNewOrder`
 * para tickets sin identidad DENTRO de un pedido — no hace falta un nuevo
 * valor de enum, 0 migraciones también aquí).
 *
 * IDEMPOTENCIA: UNIQUE (provider, external_ticket_id) en event_tickets
 * (misma restricción que ya protege los tickets con order) — un re-sync
 * nunca duplica la fila ni vuelve a intentar `recordUnresolvedOperation`.
 */
export interface IngestPaymentlessTicketInput {
  provider: string;
  integrationType: "venue_integration" | "event_integration";
  integrationId: number;
  eventId: number;
  venueId?: number | null;
  /** Ticket YA filtrado por el llamador — `externalOrderId` se ignora deliberadamente aquí. */
  ticket: NormalizedTicket;
  resolveTicketTypeId: (externalTicketTypeId: string | null | undefined) => number | null;
}

export type IngestPaymentlessTicketResult =
  | { status: "created"; ticket: EventTicket; identityResolved: boolean }
  | { status: "already_exists"; ticket: EventTicket };

export async function ingestPaymentlessTicket(input: IngestPaymentlessTicketInput, db?: DbHandle): Promise<IngestPaymentlessTicketResult> {
  const conn = db ?? (await getDb());
  const t = input.ticket;

  const identity = await resolveIdentity({ provider: input.provider, participant: t.participant, buyer: null }, conn as unknown as Parameters<typeof resolveIdentity>[1]);

  const [insertResult] = await conn.insert(eventTickets).ignore().values({
    eventId: input.eventId,
    ticketTypeId: input.resolveTicketTypeId(t.externalTicketTypeId),
    orderId: null,
    userId: identity.userId,
    salesChannel: "external",
    provider: input.provider,
    externalTicketId: t.externalId,
    status: t.status,
    issuedAt: t.purchasedAt ?? new Date(),
    metadata: { paymentless: true, amountPaidCents: t.amountPaidCents ?? 0, feesCents: t.feesCents ?? 0 },
  });
  const insertId = (insertResult as unknown as { insertId: number }).insertId;

  if (!insertId) {
    // Ya existía (re-sync) — nunca se recrea ni se reintenta unresolved_operations (spec idempotencia).
    const [row] = await conn.select().from(eventTickets)
      .where(and(eq(eventTickets.provider, input.provider), eq(eventTickets.externalTicketId, t.externalId)))
      .limit(1);
    return { status: "already_exists", ticket: row };
  }

  const [row] = await conn.select().from(eventTickets).where(eq(eventTickets.id, insertId)).limit(1);

  if (!identity.userId) {
    await recordUnresolvedOperation({
      operationType: "order",
      provider: input.provider,
      integrationType: input.integrationType,
      integrationId: input.integrationId,
      referenceType: "event_ticket",
      referenceId: row.id,
      externalReferenceId: t.externalId,
      eventId: input.eventId,
      venueId: input.venueId ?? null,
      occurredAt: t.purchasedAt ?? new Date(),
      identityHintEmail: t.participant.email ?? null,
      identityHintPhone: t.participant.phone ?? null,
      identityHintName: t.participant.name ?? null,
      amountCents: t.amountPaidCents ?? null,
    }, conn as unknown as Parameters<typeof recordUnresolvedOperation>[1]);
  } else if (isConfirmedResolutionMethod(identity.method) && identity.method !== "previous_mapping") {
    await persistIdentityMapping({
      provider: input.provider, participant: t.participant, buyer: null, userId: identity.userId, method: identity.method,
    }, conn as unknown as Parameters<typeof resolveIdentity>[1]);
  }

  return { status: "created", ticket: row, identityResolved: !!identity.userId };
}
