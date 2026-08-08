/**
 * ticketingDb.ts — CRUD del Ticketing Core (Fase 5): sales_channels,
 * event_ticket_types, ticket_orders/items, event_tickets, event_attendance.
 * Inventory se calcula EN CALIENTE (spec punto 7) — nunca una tabla de
 * contadores mutable aparte.
 */
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  salesChannels, eventTicketTypes, ticketOrders, ticketOrderItems, eventTickets, eventAttendance, events,
  type SalesChannel, type EventTicketType, type InsertSalesChannel, type InsertEventTicketType,
  type TicketOrder, type EventTicket, type EventAttendance,
} from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

// ─── SALES CHANNELS ──────────────────────────────────────────────────────────

export async function listSalesChannels(eventId: number, db?: DbHandle): Promise<SalesChannel[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(salesChannels).where(eq(salesChannels.eventId, eventId)).orderBy(salesChannels.sortOrder);
}

export async function createSalesChannel(input: InsertSalesChannel, db?: DbHandle): Promise<SalesChannel> {
  const conn = db ?? (await getDb());
  const [result] = await conn.insert(salesChannels).values(input);
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(salesChannels).where(eq(salesChannels.id, insertId)).limit(1);
  return row;
}

export async function setSalesChannelStatus(id: number, status: "active" | "inactive", db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(salesChannels).set({ status }).where(eq(salesChannels.id, id));
}

/** "hybrid" nunca se guarda — se deriva aquí contando canales activos (ver ticketing-commerce-architecture.md). */
export async function isEventHybrid(eventId: number, db?: DbHandle): Promise<boolean> {
  const channels = await listSalesChannels(eventId, db);
  return channels.filter(c => c.status === "active").length > 1;
}

// ─── TICKET TYPES ─────────────────────────────────────────────────────────────

export async function listTicketTypes(eventId: number, db?: DbHandle): Promise<EventTicketType[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(eventTicketTypes).where(eq(eventTicketTypes.eventId, eventId));
}

export async function createTicketType(input: InsertEventTicketType, db?: DbHandle): Promise<EventTicketType> {
  const conn = db ?? (await getDb());
  const [result] = await conn.insert(eventTicketTypes).values(input);
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(eventTicketTypes).where(eq(eventTicketTypes.id, insertId)).limit(1);
  return row;
}

export interface TicketTypeInventory {
  ticketTypeId: number;
  capacity: number | null;
  sold: number;
  available: number | null;
}

/** Inventory calculado en caliente — capacity − SUM(quantity) de order_items cuyo order está paid/confirmed. Ver spec punto 7 y comentario en drizzle/schema.ts. */
export async function getTicketTypeInventory(eventId: number, db?: DbHandle): Promise<TicketTypeInventory[]> {
  const conn = db ?? (await getDb());
  const types = await listTicketTypes(eventId, conn);
  if (!types.length) return [];
  const typeIds = types.map(t => t.id);
  const soldRows = await conn.select({
    ticketTypeId: ticketOrderItems.ticketTypeId,
    sold: sql<number>`COALESCE(SUM(${ticketOrderItems.quantity}), 0)`,
  }).from(ticketOrderItems)
    .innerJoin(ticketOrders, eq(ticketOrderItems.orderId, ticketOrders.id))
    .where(and(inArray(ticketOrderItems.ticketTypeId, typeIds), eq(ticketOrders.status, "paid")))
    .groupBy(ticketOrderItems.ticketTypeId);
  const soldByType = new Map(soldRows.map(r => [r.ticketTypeId, Number(r.sold)]));
  return types.map(t => {
    const sold = soldByType.get(t.id) ?? 0;
    return { ticketTypeId: t.id, capacity: t.capacity, sold, available: t.capacity != null ? Math.max(0, t.capacity - sold) : null };
  });
}

// ─── ORDERS ───────────────────────────────────────────────────────────────────

export async function listOrders(eventId: number, db?: DbHandle): Promise<TicketOrder[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(ticketOrders).where(eq(ticketOrders.eventId, eventId)).orderBy(desc(ticketOrders.createdAt));
}

// ─── EVENT TICKETS ────────────────────────────────────────────────────────────

export async function listEventTickets(eventId: number, db?: DbHandle): Promise<EventTicket[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(eventTickets).where(eq(eventTickets.eventId, eventId)).orderBy(desc(eventTickets.createdAt));
}

// ─── ATTENDANCE ───────────────────────────────────────────────────────────────

export async function listEventAttendance(eventId: number, db?: DbHandle): Promise<EventAttendance[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(eventAttendance).where(eq(eventAttendance.eventId, eventId)).orderBy(desc(eventAttendance.occurredAt));
}

// ─── ESTUDIANTE (Fase 8) — "My Orders" / "My Tickets" ─────────────────────────
// Ownership real: SIEMPRE filtrado por userId, nunca un id suelto sin
// comprobar propiedad (spec Fase 8 punto 32) — ver studentNotifications.ts
// (Fase 7) para el mismo criterio ya aplicado a otro dominio.

export async function listMyOrders(userId: number, db?: DbHandle): Promise<TicketOrder[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(ticketOrders).where(eq(ticketOrders.userId, userId)).orderBy(desc(ticketOrders.createdAt));
}

export interface MyOrderItemWithTypeName {
  id: number;
  ticketTypeId: number | null;
  ticketTypeName: string | null;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
}

export async function getMyOrderById(orderId: number, userId: number, db?: DbHandle): Promise<{ order: TicketOrder; items: MyOrderItemWithTypeName[] } | null> {
  const conn = db ?? (await getDb());
  const [order] = await conn.select().from(ticketOrders).where(and(eq(ticketOrders.id, orderId), eq(ticketOrders.userId, userId))).limit(1);
  if (!order) return null;
  const items = await conn.select({
    id: ticketOrderItems.id,
    ticketTypeId: ticketOrderItems.ticketTypeId,
    ticketTypeName: eventTicketTypes.name,
    quantity: ticketOrderItems.quantity,
    unitPriceCents: ticketOrderItems.unitPriceCents,
    totalPriceCents: ticketOrderItems.totalPriceCents,
  }).from(ticketOrderItems)
    .leftJoin(eventTicketTypes, eq(ticketOrderItems.ticketTypeId, eventTicketTypes.id))
    .where(eq(ticketOrderItems.orderId, orderId));
  return { order, items };
}

export interface MyTicketWithEvent {
  ticket: EventTicket;
  event: { id: number; name: string; slug: string; startsAt: Date; imageUrl: string | null } | null;
}

export async function listMyTickets(userId: number, db?: DbHandle): Promise<MyTicketWithEvent[]> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({
    ticket: eventTickets,
    event: { id: events.id, name: events.name, slug: events.slug, startsAt: events.startsAt, imageUrl: events.imageUrl },
  }).from(eventTickets)
    .leftJoin(events, eq(eventTickets.eventId, events.id))
    .where(eq(eventTickets.userId, userId))
    .orderBy(desc(eventTickets.createdAt));
  return rows;
}

export async function getMyTicketById(ticketId: number, userId: number, db?: DbHandle): Promise<MyTicketWithEvent | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select({
    ticket: eventTickets,
    event: { id: events.id, name: events.name, slug: events.slug, startsAt: events.startsAt, imageUrl: events.imageUrl },
  }).from(eventTickets)
    .leftJoin(events, eq(eventTickets.eventId, events.id))
    .where(and(eq(eventTickets.id, ticketId), eq(eventTickets.userId, userId)))
    .limit(1);
  return row ?? null;
}
