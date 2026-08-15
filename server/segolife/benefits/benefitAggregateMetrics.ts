/**
 * benefitAggregateMetrics.ts — SEGOLIFE BEHAVIORAL BENEFITS RULE ENGINE
 * (Fase 6, spec §6/§7). Contadores tipados sobre las tablas de HECHOS reales
 * (event_attendance/venue_visits/commerce_transactions/
 * commerce_transaction_items) — nunca sobre token_ledger. `minVisits` +
 * `countRecentEarnEvents` (motor legacy, sin tocar) es una aproximación
 * razonable cuando "consumo ≈ ganancia de tokens", pero contamina el
 * conteo si el Student gana tokens en el mismo venue por otro origen a la
 * vez (p.ej. asistencia Y consumo la misma noche) — y no puede en absoluto
 * responder "¿cuántos ITEMS compró?" o "¿cuánto gastó?" (esos hechos no
 * pasan por el ledger). Estos contadores son la base para el nuevo campo
 * `benefit_rules.aggregate_metric` — solo se usan cuando ese campo está
 * presente en la regla (ver benefitRuleEngine.ts), nunca sustituyen el
 * camino legacy.
 *
 * VENTANA "day": operational-day-aware (corte 06:00 Europe/Madrid, mismo
 * criterio que venue_visits.operational_date) — nunca medianoche de
 * calendario. "week"/"month" siguen el mismo criterio simple que el motor
 * legacy (windowStart en benefitRuleEngine.ts), sin corte nocturno (no hay
 * ambigüedad de cruce de medianoche relevante en ventanas largas).
 *
 * Solo cuentan hechos CONFIRMADOS: commerce_transactions con
 * status='confirmed' — nunca pending/cancelled/refunded (spec §36).
 */
import { eq, and, gte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eventAttendance, venueVisits, commerceTransactions, commerceTransactionItems } from "../../../drizzle/schema";
import { resolveOperationalDate } from "../tokens/tokenScheduleService";
import { madridWallTimeToUtc } from "./benefitValidityEngine";
import { type AnyDbHandle } from "../tokens/tokenLedgerService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = AnyDbHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type AggregateMetric = "attendance_count" | "venue_visit_count" | "distinct_venues" | "commerce_count" | "commerce_quantity" | "spend_cents";
export type AggregateWindow = "day" | "week" | "month";

/**
 * Igual criterio que windowStart() en benefitRuleEngine.ts para week/month;
 * "day" devuelve el instante EXACTO en que empezó el día operativo actual
 * (06:00 Europe/Madrid del operational_date de `at`) — nunca una
 * aproximación de "últimas 24h" (esa aproximación colapsaría dos noches
 * operativas distintas separadas por <24h de reloj en una sola ventana,
 * exactamente el error que el corte de las 06:00 existe para evitar).
 */
export function aggregateWindowStart(window: AggregateWindow, at: Date): Date {
  if (window === "day") {
    return madridWallTimeToUtc(resolveOperationalDate(at), "06:00");
  }
  const d = new Date(at);
  if (window === "week") {
    const day = d.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diffToMonday);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function countRecentAttendance(userId: number, since: Date, venueId?: number | null, db?: DbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const conditions = [eq(eventAttendance.userId, userId), gte(eventAttendance.occurredAt, since)];
  if (venueId != null) conditions.push(eq(eventAttendance.venueId, venueId));
  const rows = await conn.select({ id: eventAttendance.id }).from(eventAttendance).where(and(...conditions));
  return rows.length;
}

/** "day" cuenta por operational_date exacto (columna ya calculada) en vez de occurredAt >= since — equivalente a aggregateWindowStart("day", at) pero más barato (columna indexada, sin recalcular el instante UTC de las 06:00). */
export async function countRecentVenueVisits(userId: number, window: AggregateWindow, at: Date, venueId?: number | null, db?: DbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  if (window === "day") {
    const conditions = [eq(venueVisits.userId, userId), eq(venueVisits.operationalDate, resolveOperationalDate(at))];
    if (venueId != null) conditions.push(eq(venueVisits.venueId, venueId));
    const rows = await conn.select({ id: venueVisits.id }).from(venueVisits).where(and(...conditions));
    return rows.length;
  }
  const since = aggregateWindowStart(window, at);
  const conditions = [eq(venueVisits.userId, userId), gte(venueVisits.occurredAt, since)];
  if (venueId != null) conditions.push(eq(venueVisits.venueId, venueId));
  const rows = await conn.select({ id: venueVisits.id }).from(venueVisits).where(and(...conditions));
  return rows.length;
}

export async function countDistinctVenuesVisitedFromVisits(userId: number, window: AggregateWindow, at: Date, db?: DbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const since = aggregateWindowStart(window, at);
  const rows = await conn.select({ venueId: venueVisits.venueId }).from(venueVisits)
    .where(and(eq(venueVisits.userId, userId), gte(venueVisits.occurredAt, since)));
  return new Set(rows.map(r => r.venueId)).size;
}

export async function countConfirmedCommerceTransactions(userId: number, since: Date, venueId?: number | null, db?: DbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const conditions = [eq(commerceTransactions.userId, userId), eq(commerceTransactions.status, "confirmed"), gte(commerceTransactions.occurredAt, since)];
  if (venueId != null) conditions.push(eq(commerceTransactions.venueId, venueId));
  const rows = await conn.select({ id: commerceTransactions.id }).from(commerceTransactions).where(and(...conditions));
  return rows.length;
}

/** Suma de `quantity` de las líneas (commerce_transaction_items) de transacciones CONFIRMADAS — "5 consumiciones" cuenta unidades reales, no transacciones (una ronda de 3 copas en una sola transacción cuenta 3, no 1). */
export async function sumCommerceItemQuantity(userId: number, since: Date, venueId?: number | null, db?: DbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const conditions = [eq(commerceTransactions.userId, userId), eq(commerceTransactions.status, "confirmed"), gte(commerceTransactions.occurredAt, since)];
  if (venueId != null) conditions.push(eq(commerceTransactions.venueId, venueId));
  const [row] = await conn.select({ total: sql<string | null>`COALESCE(SUM(${commerceTransactionItems.quantity}), 0)` })
    .from(commerceTransactionItems)
    .innerJoin(commerceTransactions, eq(commerceTransactionItems.transactionId, commerceTransactions.id))
    .where(and(...conditions));
  return Number(row?.total ?? 0);
}

export async function sumCommerceSpendCents(userId: number, since: Date, venueId?: number | null, db?: DbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const conditions = [eq(commerceTransactions.userId, userId), eq(commerceTransactions.status, "confirmed"), gte(commerceTransactions.occurredAt, since)];
  if (venueId != null) conditions.push(eq(commerceTransactions.venueId, venueId));
  const [row] = await conn.select({ total: sql<string | null>`COALESCE(SUM(${commerceTransactions.totalCents}), 0)` })
    .from(commerceTransactions)
    .where(and(...conditions));
  return Number(row?.total ?? 0);
}

/**
 * Punto de entrada único (spec §7) — dado un metric/window ya validados en
 * la regla, evalúa si el conteo real (incluyendo el hecho que dispara esta
 * evaluación, todavía no reflejado en la tabla en el momento de esta
 * consulta si se llama ANTES de insertar — por eso quien invoca debe
 * llamarlo DESPUÉS de que el hecho origen ya esté commiteado, igual que el
 * resto del motor) alcanza el umbral configurado.
 */
export async function evaluateAggregateMetric(
  metric: AggregateMetric,
  window: AggregateWindow,
  threshold: number,
  userId: number,
  venueId: number | null | undefined,
  at: Date,
  db?: DbHandle
): Promise<boolean> {
  const since = aggregateWindowStart(window, at);
  switch (metric) {
    case "attendance_count": return (await countRecentAttendance(userId, since, venueId, db)) >= threshold;
    case "venue_visit_count": return (await countRecentVenueVisits(userId, window, at, venueId, db)) >= threshold;
    case "distinct_venues": return (await countDistinctVenuesVisitedFromVisits(userId, window, at, db)) >= threshold;
    case "commerce_count": return (await countConfirmedCommerceTransactions(userId, since, venueId, db)) >= threshold;
    case "commerce_quantity": return (await sumCommerceItemQuantity(userId, since, venueId, db)) >= threshold;
    case "spend_cents": return (await sumCommerceSpendCents(userId, since, venueId, db)) >= threshold;
    default: return false;
  }
}
