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
  salesChannels, eventTicketTypes, ticketOrders, ticketOrderItems, eventTickets, eventAttendance, events, venues,
  type SalesChannel, type EventTicketType, type InsertSalesChannel, type InsertEventTicketType,
  type TicketOrder, type EventTicket, type EventAttendance,
} from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

export type DbHandle = typeof _db;
// El callback de `.transaction()` recibe un tipo distinto (MySqlTransaction),
// incompatible en TypeScript con MySql2Database aunque comparten la misma
// API en tiempo de ejecución — mismo workaround que inventoryHoldService.ts.
export type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
export type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

// ─── SALES CHANNELS ──────────────────────────────────────────────────────────

export async function listSalesChannels(eventId: number, db?: AnyDbHandle): Promise<SalesChannel[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(salesChannels).where(eq(salesChannels.eventId, eventId)).orderBy(salesChannels.sortOrder);
}

export async function createSalesChannel(input: InsertSalesChannel, db?: AnyDbHandle): Promise<SalesChannel> {
  const conn = db ?? (await getDb());
  const [result] = await conn.insert(salesChannels).values(input);
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(salesChannels).where(eq(salesChannels.id, insertId)).limit(1);
  return row;
}

export async function setSalesChannelStatus(id: number, status: "active" | "inactive", db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(salesChannels).set({ status }).where(eq(salesChannels.id, id));
}

export async function updateSalesChannel(
  id: number,
  fields: Partial<Pick<InsertSalesChannel, "externalUrl" | "isPrimary" | "sortOrder" | "status" | "metadata" | "channelType">>,
  db?: AnyDbHandle
): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(salesChannels).set(fields).where(eq(salesChannels.id, id));
}

export async function getSalesChannelById(id: number, db?: AnyDbHandle): Promise<SalesChannel | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(salesChannels).where(eq(salesChannels.id, id)).limit(1);
  return row ?? null;
}

/**
 * Borrado seguro: si algún ticket_order ya referencia este canal (venta
 * real, aunque sea de prueba), NUNCA se borra — el admin debe desactivarlo
 * en su lugar (spec punto 22, "nunca destruir orders/payments/tickets por
 * borrar una configuración de venta").
 */
export async function deleteSalesChannelSafe(id: number, db?: AnyDbHandle): Promise<{ deleted: boolean; reason?: string }> {
  const conn = db ?? (await getDb());
  const [orderRow] = await conn.select({ id: ticketOrders.id }).from(ticketOrders).where(eq(ticketOrders.salesChannelId, id)).limit(1);
  if (orderRow) {
    return { deleted: false, reason: "Existen pedidos asociados a este canal — desactívalo en vez de eliminarlo." };
  }
  await conn.delete(salesChannels).where(eq(salesChannels.id, id));
  return { deleted: true };
}

/** "hybrid" nunca se guarda — se deriva aquí contando canales activos (ver ticketing-commerce-architecture.md). */
export async function isEventHybrid(eventId: number, db?: AnyDbHandle): Promise<boolean> {
  const channels = await listSalesChannels(eventId, db);
  return channels.filter(c => c.status === "active").length > 1;
}

// ─── TICKET TYPES ─────────────────────────────────────────────────────────────

export async function listTicketTypes(eventId: number, db?: AnyDbHandle): Promise<EventTicketType[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(eventTicketTypes).where(eq(eventTicketTypes.eventId, eventId));
}

export async function createTicketType(input: InsertEventTicketType, db?: AnyDbHandle): Promise<EventTicketType> {
  const conn = db ?? (await getDb());
  const [result] = await conn.insert(eventTicketTypes).values(input);
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(eventTicketTypes).where(eq(eventTicketTypes.id, insertId)).limit(1);
  return row;
}

export async function getTicketTypeById(id: number, db?: AnyDbHandle): Promise<EventTicketType | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(eventTicketTypes).where(eq(eventTicketTypes.id, id)).limit(1);
  return row ?? null;
}

export async function updateTicketType(
  id: number,
  fields: Partial<Pick<InsertEventTicketType, "name" | "description" | "priceCents" | "currency" | "capacity" | "salesStart" | "salesEnd" | "status" | "metadata" | "isDoorEntry">>,
  db?: AnyDbHandle
): Promise<EventTicketType | null> {
  const conn = db ?? (await getDb());
  await conn.update(eventTicketTypes).set(fields).where(eq(eventTicketTypes.id, id));
  return getTicketTypeById(id, conn);
}

export async function duplicateTicketType(id: number, db?: AnyDbHandle): Promise<EventTicketType | null> {
  const conn = db ?? (await getDb());
  const original = await getTicketTypeById(id, conn);
  if (!original) return null;
  return createTicketType(
    {
      eventId: original.eventId,
      name: `${original.name} (copia)`,
      description: original.description,
      priceCents: original.priceCents,
      currency: original.currency,
      capacity: original.capacity,
      salesStart: original.salesStart,
      salesEnd: original.salesEnd,
      status: original.status,
      metadata: original.metadata,
    },
    conn
  );
}

/**
 * Borrado seguro: si ya existen ticket_order_items o event_tickets emitidos
 * para este tipo, NUNCA se borra — se desactiva (spec punto 10/22).
 */
export async function deleteTicketTypeSafe(id: number, db?: AnyDbHandle): Promise<{ deleted: boolean; reason?: string }> {
  const conn = db ?? (await getDb());
  const [[orderItemRow], [ticketRow]] = await Promise.all([
    conn.select({ id: ticketOrderItems.id }).from(ticketOrderItems).where(eq(ticketOrderItems.ticketTypeId, id)).limit(1),
    conn.select({ id: eventTickets.id }).from(eventTickets).where(eq(eventTickets.ticketTypeId, id)).limit(1),
  ]);
  if (orderItemRow || ticketRow) {
    return { deleted: false, reason: "Existen pedidos o entradas emitidas de este tipo — desactívalo en vez de eliminarlo." };
  }
  await conn.delete(eventTicketTypes).where(eq(eventTicketTypes.id, id));
  return { deleted: true };
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

// ─── ADMIN (Student 360) — histórico por usuario arbitrario ────────────────
// A diferencia de listMyOrders/listMyTickets (autoservicio, atado a
// ctx.user.id), estas mismas consultas parametrizadas por un userId
// arbitrario para que un admin pueda verlas desde la ficha de un estudiante.
// La autorización (community-scoping) vive en el router que las invoque,
// nunca aquí — mismo contrato que server/db/studentsDb.ts.
// Auditoría previa (docs/students/student-360-audit-and-architecture.md §B):
// listAttendanceByUserId NO existía — solo listEventAttendance(eventId).

export interface StudentAttendanceItem {
  attendance: EventAttendance;
  event: { id: number; name: string; slug: string; startsAt: Date } | null;
  venueName: string | null;
}

export async function listAttendanceByUserId(userId: number, db?: DbHandle): Promise<StudentAttendanceItem[]> {
  const conn = db ?? (await getDb());
  return conn.select({
    attendance: eventAttendance,
    event: { id: events.id, name: events.name, slug: events.slug, startsAt: events.startsAt },
    venueName: venues.name,
  }).from(eventAttendance)
    .leftJoin(events, eq(eventAttendance.eventId, events.id))
    .leftJoin(venues, eq(eventAttendance.venueId, venues.id))
    .where(eq(eventAttendance.userId, userId))
    .orderBy(desc(eventAttendance.occurredAt));
}

export interface StudentTicketSpendSummary {
  ticketCount: number;
  totalPaidCents: number;
}

/**
 * SUM agregado en SQL — nunca traer todas las filas a Node para sumar (ver
 * docs/students/student-360-audit-and-architecture.md §5, "evitar query
 * monstruosa por estudiante"). Solo cuenta orders 'paid' — coherente con
 * cómo se interpreta "importe pagado" en el resto del módulo.
 */
export async function getTicketSpendSummaryByUserId(userId: number, db?: DbHandle): Promise<StudentTicketSpendSummary> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select({
    ticketCount: sql<number>`COUNT(*)`,
    totalPaidCents: sql<string>`COALESCE(SUM(${ticketOrders.totalCents}), 0)`,
  }).from(ticketOrders).where(and(eq(ticketOrders.userId, userId), eq(ticketOrders.status, "paid")));
  return { ticketCount: Number(row?.ticketCount ?? 0), totalPaidCents: Number(row?.totalPaidCents ?? 0) };
}
