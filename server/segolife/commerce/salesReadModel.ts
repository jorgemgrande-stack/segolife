/**
 * salesReadModel.ts — SEGOLIFE COMMERCE CORE (Fase 9, spec §24/§26/§72/§90).
 * "Single operational truth" de VENTAS — pero NUNCA una tabla nueva de
 * almacenamiento (spec §90: "prefer adapters/read models... no rewriting
 * 20k+ Fourvenues history for architectural purity"). Normaliza en el
 * momento de leer, sobre las fuentes reales ya existentes:
 *
 *  - `ticket_orders` (entradas nativas online + venta de puerta +
 *    Fourvenues, distinguidas por `provider`/`channel`)
 *  - `commerce_transactions` (POS nativo de venue)
 *  - `event_tickets` con `orderId IS NULL` y `metadata.paymentless=true`
 *    (evidencia Fourvenues sin order real — spec §52, nunca se cuenta como
 *    dinero cobrado, solo como evidencia externa)
 *
 * Paginación acotada por fuente (spec §83: "Fourvenues ya tiene >20k
 * tickets históricos — nunca cargar todo") — cada fuente se pagina de forma
 * independiente y se fusiona en memoria solo la página resultante, nunca el
 * histórico completo.
 */
import { eq, and, gte, lte, desc, sql, isNull, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  ticketOrders, commerceTransactions, eventTickets, events, venues, users, commerceRefunds,
} from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type SalesSource = "SEGOLIFE" | "FOURVENUES";
export type SalesType = "event_ticket" | "door_entry" | "venue_product" | "paymentless_evidence";

export interface SalesRow {
  id: string;
  reference: string;
  occurredAt: Date;
  venueId: number | null;
  venueName: string | null;
  eventId: number | null;
  eventName: string | null;
  studentUserId: number | null;
  studentName: string | null;
  type: SalesType;
  source: SalesSource;
  channel: "online" | "door" | "pos" | null;
  grossAmountCents: number;
  tokensPromotionalValueCents: number;
  moneyDueCents: number;
  status: string;
  /** spec §52/§53 — evidencia sin orden real: nunca se suma como "dinero cobrado" real. */
  isPaymentlessEvidence: boolean;
}

export interface SalesFilters {
  from?: Date;
  to?: Date;
  venueId?: number;
  eventId?: number;
  source?: SalesSource;
  studentUserId?: number;
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// Techo de sobre-pedido por fuente al fusionar 3 orígenes distintos en una
// sola página ordenada por fecha — nunca "cargar todo", solo un poco más
// del límite pedido para poder ordenar/recortar con seguridad.
const PER_SOURCE_FETCH_MULTIPLIER = 2;

function clampLimit(limit?: number): number {
  return Math.min(MAX_LIMIT, Math.max(1, limit ?? DEFAULT_LIMIT));
}

async function fetchTicketOrderSales(filters: SalesFilters, fetchLimit: number, conn: DbHandle): Promise<SalesRow[]> {
  const conditions: SQL[] = [];
  if (filters.from) conditions.push(gte(ticketOrders.createdAt, filters.from));
  if (filters.to) conditions.push(lte(ticketOrders.createdAt, filters.to));
  if (filters.eventId) conditions.push(eq(ticketOrders.eventId, filters.eventId));
  if (filters.studentUserId) conditions.push(eq(ticketOrders.userId, filters.studentUserId));
  if (filters.source === "SEGOLIFE") conditions.push(eq(ticketOrders.provider, "segolife"));
  if (filters.source === "FOURVENUES") conditions.push(eq(ticketOrders.provider, "fourvenues_integrations"));

  const rows = await conn.select({ order: ticketOrders, event: events, venue: venues, studentName: users.name })
    .from(ticketOrders)
    .innerJoin(events, eq(ticketOrders.eventId, events.id))
    .leftJoin(venues, eq(events.venueId, venues.id))
    .leftJoin(users, eq(ticketOrders.userId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ticketOrders.createdAt))
    .limit(fetchLimit);

  // venueId es un filtro POST-join (events.venueId no es columna de ticketOrders) — acotado igualmente por fetchLimit, coherente con "nunca cargar todo".
  const filtered = filters.venueId ? rows.filter(r => r.venue?.id === filters.venueId) : rows;

  return filtered.map(r => ({
    id: `ticket_order:${r.order.id}`,
    reference: `SG-${r.order.id}`,
    occurredAt: r.order.createdAt,
    venueId: r.venue?.id ?? null,
    venueName: r.venue?.name ?? null,
    eventId: r.event.id,
    eventName: r.event.name,
    studentUserId: r.order.userId,
    studentName: r.studentName ?? null,
    type: r.order.channel === "door" ? "door_entry" as const : "event_ticket" as const,
    source: r.order.provider === "fourvenues_integrations" ? "FOURVENUES" as const : "SEGOLIFE" as const,
    channel: r.order.channel,
    grossAmountCents: r.order.totalCents,
    tokensPromotionalValueCents: 0, // resuelto aparte (spec §53, ver resolveTokenPromoValues) — evita un join costoso por fila
    moneyDueCents: r.order.totalCents,
    status: r.order.status,
    isPaymentlessEvidence: false,
  }));
}

async function fetchCommerceSales(filters: SalesFilters, fetchLimit: number, conn: DbHandle): Promise<SalesRow[]> {
  if (filters.source === "FOURVENUES") return []; // POS nativo es siempre provider="segolife" hoy — nunca hay venta de venue externa a filtrar

  const conditions: SQL[] = [];
  if (filters.from) conditions.push(gte(commerceTransactions.occurredAt, filters.from));
  if (filters.to) conditions.push(lte(commerceTransactions.occurredAt, filters.to));
  if (filters.venueId) conditions.push(eq(commerceTransactions.venueId, filters.venueId));
  if (filters.eventId) conditions.push(eq(commerceTransactions.eventId, filters.eventId));
  if (filters.studentUserId) conditions.push(eq(commerceTransactions.userId, filters.studentUserId));

  const rows = await conn.select({ tx: commerceTransactions, venue: venues, studentName: users.name })
    .from(commerceTransactions)
    .leftJoin(venues, eq(commerceTransactions.venueId, venues.id))
    .leftJoin(users, eq(commerceTransactions.userId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(commerceTransactions.occurredAt))
    .limit(fetchLimit);

  return rows.map(r => ({
    id: `commerce_transaction:${r.tx.id}`,
    reference: `SG-C${r.tx.id}`,
    occurredAt: r.tx.occurredAt,
    venueId: r.venue?.id ?? null,
    venueName: r.venue?.name ?? null,
    eventId: r.tx.eventId,
    eventName: null,
    studentUserId: r.tx.userId,
    studentName: r.studentName ?? null,
    type: "venue_product" as const,
    source: "SEGOLIFE" as const,
    channel: "pos" as const,
    grossAmountCents: r.tx.totalCents,
    tokensPromotionalValueCents: 0,
    moneyDueCents: r.tx.totalCents - r.tx.refundedAmountCents,
    status: r.tx.status,
    isPaymentlessEvidence: false,
  }));
}

/** Evidencia Fourvenues sin order real (spec §52) — SOLO si no hay filtro de estudiante/comunidad incompatible; nunca contribuye a "dinero cobrado". */
async function fetchPaymentlessEvidence(filters: SalesFilters, fetchLimit: number, conn: DbHandle): Promise<SalesRow[]> {
  if (filters.source === "SEGOLIFE") return [];
  const conditions: SQL[] = [isNull(eventTickets.orderId), eq(eventTickets.provider, "fourvenues_integrations")];
  if (filters.from) conditions.push(gte(eventTickets.issuedAt, filters.from));
  if (filters.to) conditions.push(lte(eventTickets.issuedAt, filters.to));
  if (filters.eventId) conditions.push(eq(eventTickets.eventId, filters.eventId));
  if (filters.studentUserId) conditions.push(eq(eventTickets.userId, filters.studentUserId));

  const rows = await conn.select({ ticket: eventTickets, event: events, venue: venues, studentName: users.name })
    .from(eventTickets)
    .innerJoin(events, eq(eventTickets.eventId, events.id))
    .leftJoin(venues, eq(events.venueId, venues.id))
    .leftJoin(users, eq(eventTickets.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(eventTickets.issuedAt))
    .limit(fetchLimit);

  const filtered = filters.venueId ? rows.filter(r => r.venue?.id === filters.venueId) : rows;

  return filtered.map(r => {
    const meta = (r.ticket.metadata ?? {}) as { amountPaidCents?: number };
    return {
      id: `paymentless:${r.ticket.id}`,
      reference: r.ticket.externalTicketId ?? `FV-${r.ticket.id}`,
      occurredAt: r.ticket.issuedAt ?? r.ticket.createdAt,
      venueId: r.venue?.id ?? null,
      venueName: r.venue?.name ?? null,
      eventId: r.event.id,
      eventName: r.event.name,
      studentUserId: r.ticket.userId,
      studentName: r.studentName ?? null,
      type: "paymentless_evidence" as const,
      source: "FOURVENUES" as const,
      channel: null,
      grossAmountCents: meta.amountPaidCents ?? 0,
      tokensPromotionalValueCents: 0,
      moneyDueCents: 0, // NUNCA "dinero cobrado" real — solo evidencia externa (spec §52/§53)
      status: r.ticket.status,
      isPaymentlessEvidence: true,
    };
  });
}

export interface ListUnifiedSalesResult {
  items: SalesRow[];
  hasMore: boolean;
}

/**
 * Fusiona las 3 fuentes en una sola página ordenada por fecha desc. Cada
 * fuente se pide acotada (fetchLimit = límite pedido × multiplicador) —
 * nunca el histórico completo — se fusiona, ordena y recorta EN MEMORIA
 * solo esa página, nunca más. Suficiente para uso operativo real (spec
 * §71: "not final BI"); una paginación profunda exacta cruzando fuentes
 * mixtas queda documentada como limitación conocida.
 */
export async function listUnifiedSales(filters: SalesFilters = {}, db?: DbHandle): Promise<ListUnifiedSalesResult> {
  const conn = db ?? (await getDb());
  const limit = clampLimit(filters.limit);
  const offset = filters.offset ?? 0;
  const fetchLimit = (limit + offset) * PER_SOURCE_FETCH_MULTIPLIER;

  const [ticketRows, commerceRows, paymentlessRows] = await Promise.all([
    fetchTicketOrderSales(filters, fetchLimit, conn),
    fetchCommerceSales(filters, fetchLimit, conn),
    fetchPaymentlessEvidence(filters, fetchLimit, conn),
  ]);

  const merged = [...ticketRows, ...commerceRows, ...paymentlessRows].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const page = merged.slice(offset, offset + limit);
  return { items: page, hasMore: merged.length > offset + limit };
}

// ─── Agregados — Overview / Daily Operations (spec §31/§71) ────────────────

export interface SalesAggregate {
  grossSalesCents: number;
  tokensPromotionalValueCents: number;
  moneyDueCents: number;
  ordersCount: number;
  refundsCount: number;
  bySource: Record<SalesSource, number>;
  byVenue: Array<{ venueId: number; venueName: string; grossCents: number }>;
}

/** Suma real (no cacheada) sobre una ventana acotada — pensado para "hoy"/"7 días"/"30 días" (spec §71), nunca todo el histórico sin fecha. */
export async function getSalesAggregate(filters: SalesFilters & { from: Date; to: Date }, db?: DbHandle): Promise<SalesAggregate> {
  const conn = db ?? (await getDb());

  const ticketConditions: SQL[] = [gte(ticketOrders.createdAt, filters.from), lte(ticketOrders.createdAt, filters.to), eq(ticketOrders.status, "paid")];
  if (filters.eventId) ticketConditions.push(eq(ticketOrders.eventId, filters.eventId));

  const commerceConditions: SQL[] = [gte(commerceTransactions.occurredAt, filters.from), lte(commerceTransactions.occurredAt, filters.to)];
  if (filters.venueId) commerceConditions.push(eq(commerceTransactions.venueId, filters.venueId));
  if (filters.eventId) commerceConditions.push(eq(commerceTransactions.eventId, filters.eventId));

  const [ticketRows, commerceRows, refundRows] = await Promise.all([
    conn.select({ order: ticketOrders, venue: venues }).from(ticketOrders)
      .innerJoin(events, eq(ticketOrders.eventId, events.id)).leftJoin(venues, eq(events.venueId, venues.id))
      .where(and(...ticketConditions)),
    conn.select({ tx: commerceTransactions, venue: venues }).from(commerceTransactions)
      .leftJoin(venues, eq(commerceTransactions.venueId, venues.id))
      .where(and(...commerceConditions, sql`${commerceTransactions.status} IN ('confirmed','partially_refunded','refunded')`)),
    conn.select({ id: commerceRefunds.id }).from(commerceRefunds).where(and(gte(commerceRefunds.createdAt, filters.from), lte(commerceRefunds.createdAt, filters.to))),
  ]);

  const ticketRowsScoped = filters.venueId ? ticketRows.filter(r => r.venue?.id === filters.venueId) : ticketRows;

  const byVenueMap = new Map<number, { venueName: string; grossCents: number }>();
  let grossSalesCents = 0;
  let ordersCount = 0;
  const bySource: Record<SalesSource, number> = { SEGOLIFE: 0, FOURVENUES: 0 };

  for (const r of ticketRowsScoped) {
    grossSalesCents += r.order.totalCents;
    ordersCount += 1;
    bySource[r.order.provider === "fourvenues_integrations" ? "FOURVENUES" : "SEGOLIFE"] += r.order.totalCents;
    if (r.venue) {
      const acc = byVenueMap.get(r.venue.id) ?? { venueName: r.venue.name, grossCents: 0 };
      acc.grossCents += r.order.totalCents;
      byVenueMap.set(r.venue.id, acc);
    }
  }
  for (const r of commerceRows) {
    grossSalesCents += r.tx.totalCents;
    ordersCount += 1;
    bySource.SEGOLIFE += r.tx.totalCents;
    if (r.venue) {
      const acc = byVenueMap.get(r.venue.id) ?? { venueName: r.venue.name, grossCents: 0 };
      acc.grossCents += r.tx.totalCents;
      byVenueMap.set(r.venue.id, acc);
    }
  }

  return {
    grossSalesCents,
    tokensPromotionalValueCents: 0, // resuelto en la vista Overview vía tokenSpendService cuando haga falta un desglose exacto — evita duplicar aquí una agregación cara sobre token_spend_reservations en cada carga
    moneyDueCents: grossSalesCents,
    ordersCount,
    refundsCount: refundRows.length,
    bySource,
    byVenue: Array.from(byVenueMap.entries()).map(([venueId, v]) => ({ venueId, ...v })).sort((a, b) => b.grossCents - a.grossCents),
  };
}

// ─── Vista de Devoluciones (spec §59) ────────────────────────────────────────

export interface RefundListFilters {
  venueId?: number;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface RefundRow {
  id: number;
  sourceType: "commerce_transaction" | "ticket_order";
  sourceId: number;
  reference: string;
  venueName: string | null;
  eventName: string | null;
  studentName: string | null;
  amountCents: number;
  tokensRestored: number;
  moneyRefundStatus: "completed" | "provider_unavailable";
  partial: boolean;
  reason: string;
  createdAt: Date;
}

export async function listRefunds(filters: RefundListFilters = {}, db?: DbHandle): Promise<RefundRow[]> {
  const conn = db ?? (await getDb());
  const conditions: SQL[] = [];
  if (filters.venueId) conditions.push(eq(commerceRefunds.venueId, filters.venueId));
  if (filters.from) conditions.push(gte(commerceRefunds.createdAt, filters.from));
  if (filters.to) conditions.push(lte(commerceRefunds.createdAt, filters.to));

  const rows = await conn.select({ refund: commerceRefunds, venue: venues, event: events, studentName: users.name })
    .from(commerceRefunds)
    .leftJoin(venues, eq(commerceRefunds.venueId, venues.id))
    .leftJoin(events, eq(commerceRefunds.eventId, events.id))
    .leftJoin(users, eq(commerceRefunds.userId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(commerceRefunds.createdAt))
    .limit(clampLimit(filters.limit))
    .offset(filters.offset ?? 0);

  return rows.map(r => ({
    id: r.refund.id,
    sourceType: r.refund.sourceType,
    sourceId: r.refund.sourceId,
    reference: r.refund.sourceType === "ticket_order" ? `SG-${r.refund.sourceId}` : `SG-C${r.refund.sourceId}`,
    venueName: r.venue?.name ?? null,
    eventName: r.event?.name ?? null,
    studentName: r.studentName ?? null,
    amountCents: r.refund.amountCents,
    tokensRestored: r.refund.tokensRestored,
    moneyRefundStatus: r.refund.moneyRefundStatus,
    partial: r.refund.partial,
    reason: r.refund.reason,
    createdAt: r.refund.createdAt,
  }));
}
