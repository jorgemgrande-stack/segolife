/**
 * notificationsDb.ts — lecturas/mutaciones de inbox (estudiante) y logs de
 * entrega (admin). Ownership obligatorio en todo lo de estudiante (spec
 * punto 14).
 */
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { notifications, notificationDeliveries, type Notification, type NotificationDelivery } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export async function listMyNotifications(userId: number, limit = 50, db?: DbHandle): Promise<Notification[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.status, "active")))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getUnreadCount(userId: number, db?: DbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select({ count: sql<number>`COUNT(*)` }).from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.status, "active"), isNull(notifications.readAt)));
  return Number(row?.count ?? 0);
}

export class NotificationOwnershipError extends Error {
  constructor() { super("Notification not found"); this.name = "NotificationOwnershipError"; }
}

export async function markRead(id: number, userId: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  if (!row || row.userId !== userId) throw new NotificationOwnershipError();
  if (row.readAt) return; // idempotente
  await conn.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id));
}

export async function markAllRead(userId: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function markClicked(id: number, userId: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  if (!row || row.userId !== userId) throw new NotificationOwnershipError();
  if (row.clickedAt) return;
  await conn.update(notifications).set({ clickedAt: new Date() }).where(eq(notifications.id, id));
}

// ─── ADMIN — notificaciones creadas (solo lectura, spec punto 33) ────────────

export async function listAllNotifications(limit = 100, db?: DbHandle): Promise<Notification[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit);
}

// ─── ADMIN — delivery log / failures (spec puntos 51-52) ─────────────────────

export async function listDeliveries(filters: { status?: "pending" | "sent" | "delivered" | "failed" | "skipped" | "cancelled"; channel?: "in_app" | "email" | "push" | "whatsapp" }, limit = 100, db?: DbHandle): Promise<NotificationDelivery[]> {
  const conn = db ?? (await getDb());
  const conditions = [];
  if (filters.status) conditions.push(eq(notificationDeliveries.status, filters.status));
  if (filters.channel) conditions.push(eq(notificationDeliveries.channel, filters.channel));
  const query = conn.select().from(notificationDeliveries).orderBy(desc(notificationDeliveries.createdAt)).limit(limit);
  return conditions.length ? query.where(and(...conditions)) : query;
}

export async function listFailedDeliveries(limit = 100, db?: DbHandle): Promise<NotificationDelivery[]> {
  return listDeliveries({ status: "failed" }, limit, db);
}

export async function retryDelivery(id: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(notificationDeliveries).set({ status: "pending", lastError: null }).where(eq(notificationDeliveries.id, id));
}

export async function cancelDelivery(id: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(notificationDeliveries).set({ status: "cancelled" }).where(eq(notificationDeliveries.id, id));
}
