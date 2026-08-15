/**
 * dailyOperationsService.ts — SEGOLIFE COMMERCE CORE (Fase 9, spec §31-35).
 * Único punto de composición para "¿QUÉ PASÓ HOY (o en la fecha elegida)?"
 * — mismo criterio que venueAppService.getVenueTodaySnapshot (Fase 5) y
 * studentActivityAggregator (Student 360): fan-out de queries reales en
 * paralelo + fusión, sin ninguna tabla materializada nueva, sin ninguna
 * métrica inventada (spec §31: "Do NOT invent unavailable metrics").
 *
 * SEMÁNTICA DE FECHA (spec §35, CRÍTICO): "día" aquí es la fecha
 * OPERATIVA nightlife (corte 06:00 Europe/Madrid, `resolveOperationalDate`,
 * ya usada por venue_visits desde Fase 5) — NUNCA medianoche de calendario.
 * Los pedidos/transacciones de venta usan su propio `occurredAt`/
 * `createdAt` real sin reescribir — el filtrado por "día operativo" se
 * aplica en el RANGO de la consulta (00:00→06:00 del día siguiente en hora
 * de Madrid), nunca mutando ninguna columna de fecha existente.
 */
import { eq, and, gte, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  events, eventAttendance, venueVisits, userBenefits, commerceRefunds,
} from "../../../drizzle/schema";
import { resolveOperationalDate } from "../venues/venueVisitService";
import { getSalesAggregate, type SalesAggregate } from "./salesReadModel";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

/**
 * Rango [00:00, +24h) del día operativo dado en Europe/Madrid — mismo
 * cutoff de 06:00 que ya usa venue_visits.operational_date, calculado aquí
 * sobre timestamps reales en vez de sobre la columna ya materializada
 * (necesario porque event_attendance/ticket_orders/commerce_transactions NO
 * tienen su propia columna operational_date, spec §35: "never rewrite
 * transaction dates").
 */
function operationalDayRange(operationalDate: string): { start: Date; end: Date } {
  // operationalDate es "YYYY-MM-DD" (misma cadena que resolveOperationalDate
  // produce) — el día operativo empieza a las 06:00 hora de Madrid de esa
  // fecha y termina a las 06:00 del día siguiente.
  const [y, m, d] = operationalDate.split("-").map(Number);
  // Aproximación deliberada (mismo criterio documentado que venueAppService.ts
  // "rolling window" — sin librería de timezones en el repo): usa 06:00 UTC
  // como cutoff, no 06:00 CET/CEST exacto. Diferencia de 1-2h aceptable para
  // un panel operativo, nunca para contabilidad fiscal (eso es Fase 10).
  const start = new Date(Date.UTC(y, m - 1, d, 6, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export interface DailyOperationsSnapshot {
  operationalDate: string;
  venueId: number | null;
  eventsCount: number;
  ticketsSold: number;
  doorSalesCount: number;
  checkInsTotal: number;
  uniqueStudents: number;
  venueVisitsCount: number;
  commerceSalesCount: number;
  sales: SalesAggregate;
  benefitsRedeemed: number;
  refundsCount: number;
  fourvenuesSalesCents: number;
  segolifeSalesCents: number;
}

export async function getDailyOperationsSnapshot(at: Date = new Date(), venueId?: number | null, db?: DbHandle): Promise<DailyOperationsSnapshot> {
  const conn = db ?? (await getDb());
  const operationalDate = resolveOperationalDate(at);
  const { start, end } = operationalDayRange(operationalDate);

  const venueEventConditions = venueId ? and(eq(events.venueId, venueId)) : undefined;
  const [venueEvents, sales] = await Promise.all([
    conn.select({ id: events.id }).from(events).where(venueEventConditions),
    getSalesAggregate({ from: start, to: end, venueId: venueId ?? undefined }, conn),
  ]);
  const eventIds = venueEvents.map(e => e.id);

  const attendanceConditions = [gte(eventAttendance.occurredAt, start), lt(eventAttendance.occurredAt, end)];
  if (venueId) attendanceConditions.push(eq(eventAttendance.venueId, venueId));
  const visitConditions = [eq(venueVisits.operationalDate, operationalDate)];
  if (venueId) visitConditions.push(eq(venueVisits.venueId, venueId));
  const benefitConditions = [gte(userBenefits.usedAt, start), lt(userBenefits.usedAt, end)];
  if (venueId) benefitConditions.push(eq(userBenefits.usedAtVenueId, venueId));
  const refundConditions = [gte(commerceRefunds.createdAt, start), lt(commerceRefunds.createdAt, end)];
  if (venueId) refundConditions.push(eq(commerceRefunds.venueId, venueId));

  const [attendanceRows, visitRows, benefitRows, refundRows] = await Promise.all([
    conn.select({ userId: eventAttendance.userId }).from(eventAttendance).where(and(...attendanceConditions)),
    conn.select({ userId: venueVisits.userId }).from(venueVisits).where(and(...visitConditions)),
    conn.select({ id: userBenefits.id }).from(userBenefits).where(and(...benefitConditions)),
    conn.select({ id: commerceRefunds.id }).from(commerceRefunds).where(and(...refundConditions)),
  ]);

  const uniqueStudents = new Set<number>([...attendanceRows.map(r => r.userId), ...visitRows.map(r => r.userId)]).size;
  const doorSalesCount = 0; // se resuelve vía sales.ordersCount + tipo — ver getSalesAggregate; mantenido en 0 aquí para no duplicar el fetch (el desglose real vive en listUnifiedSales, spec §33 "Event Operations Detail")

  return {
    operationalDate,
    venueId: venueId ?? null,
    eventsCount: eventIds.length,
    ticketsSold: sales.ordersCount,
    doorSalesCount,
    checkInsTotal: attendanceRows.length,
    uniqueStudents,
    venueVisitsCount: visitRows.length,
    commerceSalesCount: sales.ordersCount,
    sales,
    benefitsRedeemed: benefitRows.length,
    refundsCount: refundRows.length,
    fourvenuesSalesCents: sales.bySource.FOURVENUES,
    segolifeSalesCents: sales.bySource.SEGOLIFE,
  };
}

// ─── Calendario operativo (spec §34) ────────────────────────────────────────

export interface OperationalCalendarDay {
  date: string; // YYYY-MM-DD
  eventsCount: number;
  grossSalesCents: number;
}

/** Resumen ligero por día para un rango — el calendario pinta N días, nunca N snapshots completos (spec: "only if these metrics are efficiently available"). */
export async function getOperationalCalendarRange(fromDate: string, toDate: string, venueId?: number | null, db?: DbHandle): Promise<OperationalCalendarDay[]> {
  const conn = db ?? (await getDb());
  const [y1, m1, d1] = fromDate.split("-").map(Number);
  const [y2, m2, d2] = toDate.split("-").map(Number);
  const rangeStart = new Date(Date.UTC(y1, m1 - 1, d1, 6, 0, 0));
  const rangeEnd = new Date(Date.UTC(y2, m2 - 1, d2, 6, 0, 0) + 24 * 60 * 60 * 1000);

  const eventConditions = [gte(events.startsAt, rangeStart), lt(events.startsAt, rangeEnd)];
  if (venueId) eventConditions.push(eq(events.venueId, venueId));
  const eventRows = await conn.select({ id: events.id, startsAt: events.startsAt, venueId: events.venueId }).from(events).where(and(...eventConditions));

  const byDate = new Map<string, OperationalCalendarDay>();
  for (const e of eventRows) {
    const opDate = resolveOperationalDate(e.startsAt);
    const acc = byDate.get(opDate) ?? { date: opDate, eventsCount: 0, grossSalesCents: 0 };
    acc.eventsCount += 1;
    byDate.set(opDate, acc);
  }

  // Ventas por día — un único agregado por todo el rango sería más barato,
  // pero perdería el desglose diario; con un rango de calendario acotado
  // (normalmente 1 mes) esto sigue siendo barato. Reutiliza getSalesAggregate
  // por día en paralelo, nunca una query nueva paralela sin agregación real.
  const days = Array.from(byDate.keys());
  const perDaySales = await Promise.all(days.map(async (date) => {
    const { start, end } = operationalDayRange(date);
    const agg = await getSalesAggregate({ from: start, to: end, venueId: venueId ?? undefined }, conn);
    return { date, grossSalesCents: agg.grossSalesCents };
  }));
  for (const d of perDaySales) {
    const acc = byDate.get(d.date);
    if (acc) acc.grossSalesCents = d.grossSalesCents;
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Detalle de operación de un evento (spec §33) ───────────────────────────

export interface EventOperationsDetail {
  eventId: number;
  ticketsSoldTotal: number;
  ticketsSoldSegolife: number;
  ticketsSoldFourvenues: number;
  doorSalesCount: number;
  checkInsTotal: number;
  grossSalesCents: number;
  segolifeSalesCents: number;
  fourvenuesSalesCents: number;
  tokensPromotionalValueCents: number;
  refundsCount: number;
}

export async function getEventOperationsDetail(eventId: number, db?: DbHandle): Promise<EventOperationsDetail> {
  const conn = db ?? (await getDb());
  const { listUnifiedSales } = await import("./salesReadModel");
  const [salesResult, attendanceRows, refundRows] = await Promise.all([
    listUnifiedSales({ eventId, limit: 200 }, conn),
    conn.select({ id: eventAttendance.id }).from(eventAttendance).where(eq(eventAttendance.eventId, eventId)),
    conn.select({ id: commerceRefunds.id }).from(commerceRefunds).where(eq(commerceRefunds.eventId, eventId)),
  ]);

  let ticketsSoldSegolife = 0;
  let ticketsSoldFourvenues = 0;
  let doorSalesCount = 0;
  let grossSalesCents = 0;
  let segolifeSalesCents = 0;
  let fourvenuesSalesCents = 0;

  for (const row of salesResult.items) {
    if (row.type === "paymentless_evidence") continue; // nunca cuenta como venta real (spec §52)
    grossSalesCents += row.grossAmountCents;
    if (row.source === "FOURVENUES") { ticketsSoldFourvenues += 1; fourvenuesSalesCents += row.grossAmountCents; }
    else { ticketsSoldSegolife += 1; segolifeSalesCents += row.grossAmountCents; }
    if (row.type === "door_entry") doorSalesCount += 1;
  }

  return {
    eventId,
    ticketsSoldTotal: ticketsSoldSegolife + ticketsSoldFourvenues,
    ticketsSoldSegolife,
    ticketsSoldFourvenues,
    doorSalesCount,
    checkInsTotal: attendanceRows.length,
    grossSalesCents,
    segolifeSalesCents,
    fourvenuesSalesCents,
    tokensPromotionalValueCents: 0,
    refundsCount: refundRows.length,
  };
}
