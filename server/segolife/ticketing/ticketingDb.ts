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
  salesChannels, eventTicketTypes, ticketOrders, ticketOrderItems, eventTickets, eventAttendance,
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
