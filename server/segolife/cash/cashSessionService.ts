/**
 * cashSessionService.ts — SEGOLIFE FASE 10 (spec §44-53).
 *
 * DISEÑO DELIBERADO: SIN columna cash_session_id en commerce_transactions/
 * ticket_orders — el efectivo esperado se calcula por RANGO DE TIEMPO
 * (openedAt..closedAt) sobre esas tablas ya existentes, igual que
 * salesReadModel.ts normaliza en tiempo de consulta sin tocar el
 * almacenamiento de Fase 9 (mismo criterio conservador que
 * fiscalSnapshotService.ts). Solo una sesión "open" por venue — el mutex de
 * apertura concurrente se logra bloqueando la fila de `venues` (FOR UPDATE),
 * que siempre existe, en vez de un índice único parcial (MySQL no los
 * soporta).
 *
 * CASH vs CARD vs SEGOTOKENS (spec §47): hoy Fase 9 solo distingue
 * paymentMethod "cash"/"segotokens"/"mixed" — no existe todavía un flujo de
 * tarjeta física distinta (CARD_EXTERNAL, spec §51) porque Fase 9 nunca lo
 * construyó (auditado, sin datáfono conectado). Por eso "cash"/"mixed" se
 * tratan aquí como dinero en efectivo a efectos de arqueo — limitación
 * documentada explícitamente en el informe final, no una confusión.
 */
import { eq, and, gte, lte, or, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  venueCashSessions as cashSessions, venueCashMovements as cashMovements, venues, commerceTransactions, ticketOrders, events,
  commerceRefunds, tokenSpendReservations,
  type VenueCashSession as CashSession, type VenueCashMovement as CashMovement,
} from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class CashSessionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "CashSessionError";
  }
}

export async function getOpenSession(venueId: number, db?: DbHandle): Promise<CashSession | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(cashSessions).where(and(eq(cashSessions.venueId, venueId), eq(cashSessions.status, "open"))).limit(1);
  return row ?? null;
}

export async function openCashSession(venueId: number, openedByUserId: number, openingCashCents: number, db?: DbHandle): Promise<CashSession> {
  const conn = db ?? (await getDb());
  if (!Number.isInteger(openingCashCents) || openingCashCents < 0) throw new CashSessionError("INVALID_AMOUNT", "Importe de apertura no válido");

  return conn.transaction(async (tx) => {
    const [venue] = await tx.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId)).limit(1).for("update");
    if (!venue) throw new CashSessionError("VENUE_NOT_FOUND", "Venue no encontrado");

    const [existing] = await tx.select().from(cashSessions).where(and(eq(cashSessions.venueId, venueId), eq(cashSessions.status, "open"))).limit(1);
    if (existing) throw new CashSessionError("ALREADY_OPEN", "Ya hay una sesión de caja abierta para este venue");

    const [result] = await tx.insert(cashSessions).values({ venueId, openedByUserId, openingCashCents, status: "open" });
    const insertId = (result as unknown as { insertId: number }).insertId;
    const [row] = await tx.select().from(cashSessions).where(eq(cashSessions.id, insertId)).limit(1);
    return row!;
  });
}

/** Porción en efectivo de una venta — "cash"/"mixed" cuentan (spec §47, limitación documentada: no hay todavía CARD_EXTERNAL distinto); "segotokens" nunca aporta (spec §9/§35). */
async function resolveCashPortionCents(totalCents: number, paymentMethod: string | null, tokenReservationId: number | null, conn: DbHandle): Promise<number> {
  if (paymentMethod === "segotokens") return 0;
  if (tokenReservationId == null) return totalCents;
  const [reservation] = await conn.select({ moneyDueCents: tokenSpendReservations.moneyDueCents }).from(tokenSpendReservations).where(eq(tokenSpendReservations.id, tokenReservationId)).limit(1);
  return reservation?.moneyDueCents ?? totalCents;
}

export interface CashSessionSummary {
  session: CashSession;
  salesCashCents: number;
  refundsCashCents: number;
  cashInCents: number;
  cashOutCents: number;
  expectedCashCents: number;
}

/**
 * Calcula el efectivo esperado por RANGO DE TIEMPO (spec §47/§50). Reembolsos
 * en efectivo se aproximan PROPORCIONALMENTE cuando la venta original era
 * mixta (spec: aproximación explícita, documentada — Fase 9 no registra el
 * desglose ST/dinero POR CADA reembolso, solo por venta original).
 */
export async function computeSessionSummary(session: CashSession, db?: DbHandle): Promise<CashSessionSummary> {
  const conn = db ?? (await getDb());
  const rangeEnd = session.closedAt ?? new Date();

  const sales = await conn.select().from(commerceTransactions).where(and(
    eq(commerceTransactions.venueId, session.venueId),
    gte(commerceTransactions.occurredAt, session.openedAt),
    lte(commerceTransactions.occurredAt, rangeEnd),
    or(eq(commerceTransactions.status, "confirmed"), eq(commerceTransactions.status, "refunded"), eq(commerceTransactions.status, "partially_refunded")),
  ));
  let salesCashCents = 0;
  for (const tx of sales) {
    salesCashCents += await resolveCashPortionCents(tx.totalCents, tx.paymentMethod, tx.tokenReservationId, conn);
  }

  // ticket_orders no lleva venue_id directo — se une con events para acotar
  // al venue de esta sesión (spec §85 IDOR: nunca mezclar caja de otro venue).
  const doorSales = await conn.select({ order: ticketOrders }).from(ticketOrders)
    .innerJoin(events, eq(events.id, ticketOrders.eventId))
    .where(and(
      eq(events.venueId, session.venueId),
      eq(ticketOrders.channel, "door"),
      gte(ticketOrders.purchasedAt, session.openedAt),
      lte(ticketOrders.purchasedAt, rangeEnd),
      inArray(ticketOrders.status, ["paid", "refunded", "partially_refunded"]),
    ));
  for (const { order } of doorSales) {
    salesCashCents += await resolveCashPortionCents(order.totalCents, order.paymentMethod, order.tokenReservationId, conn);
  }

  const refunds = await conn.select().from(commerceRefunds).where(and(
    eq(commerceRefunds.venueId, session.venueId),
    gte(commerceRefunds.createdAt, session.openedAt),
    lte(commerceRefunds.createdAt, rangeEnd),
    eq(commerceRefunds.moneyRefundStatus, "completed"),
  ));
  let refundsCashCents = 0;
  for (const refund of refunds) {
    if (refund.sourceType !== "commerce_transaction") { refundsCashCents += refund.amountCents; continue; }
    const [original] = await conn.select({ totalCents: commerceTransactions.totalCents, tokenReservationId: commerceTransactions.tokenReservationId })
      .from(commerceTransactions).where(eq(commerceTransactions.id, refund.sourceId)).limit(1);
    if (!original || original.tokenReservationId == null || original.totalCents === 0) { refundsCashCents += refund.amountCents; continue; }
    const [reservation] = await conn.select({ moneyDueCents: tokenSpendReservations.moneyDueCents }).from(tokenSpendReservations).where(eq(tokenSpendReservations.id, original.tokenReservationId)).limit(1);
    const moneyRatio = (reservation?.moneyDueCents ?? original.totalCents) / original.totalCents;
    refundsCashCents += Math.round(refund.amountCents * moneyRatio);
  }

  const movements = await conn.select().from(cashMovements).where(eq(cashMovements.cashSessionId, session.id));
  const cashInCents = movements.filter(m => m.type === "cash_in").reduce((s, m) => s + m.amountCents, 0);
  const cashOutCents = movements.filter(m => m.type === "cash_out").reduce((s, m) => s + m.amountCents, 0);

  const expectedCashCents = session.openingCashCents + salesCashCents - refundsCashCents + cashInCents - cashOutCents;
  return { session, salesCashCents, refundsCashCents, cashInCents, cashOutCents, expectedCashCents };
}

export async function closeCashSession(sessionId: number, closedByUserId: number, countedCashCents: number, notes: string | null, db?: DbHandle): Promise<CashSessionSummary> {
  const conn = db ?? (await getDb());
  if (!Number.isInteger(countedCashCents) || countedCashCents < 0) throw new CashSessionError("INVALID_AMOUNT", "Importe contado no válido");

  const [session] = await conn.select().from(cashSessions).where(eq(cashSessions.id, sessionId)).limit(1);
  if (!session) throw new CashSessionError("NOT_FOUND", "Sesión de caja no encontrada");
  if (session.status !== "open") throw new CashSessionError("ALREADY_CLOSED", "Esta sesión de caja ya está cerrada");

  const closedAt = new Date();
  const summary = await computeSessionSummary({ ...session, closedAt }, conn);
  const differenceCents = countedCashCents - summary.expectedCashCents;

  const [updateResult] = await conn.update(cashSessions).set({
    status: "closed", closedByUserId, closedAt,
    expectedCashCents: summary.expectedCashCents, countedCashCents, differenceCents, notes,
  }).where(and(eq(cashSessions.id, sessionId), eq(cashSessions.status, "open")));
  if ((updateResult as unknown as { affectedRows: number }).affectedRows === 0) {
    throw new CashSessionError("ALREADY_CLOSED", "Esta sesión de caja ya está cerrada");
  }

  const [closed] = await conn.select().from(cashSessions).where(eq(cashSessions.id, sessionId)).limit(1);
  return { ...summary, session: closed! };
}

export interface RecordCashMovementInput { cashSessionId: number; type: "cash_in" | "cash_out"; amountCents: number; reason: string; actorUserId: number; }

export async function recordCashMovement(input: RecordCashMovementInput, db?: DbHandle): Promise<CashMovement> {
  const conn = db ?? (await getDb());
  if (!input.reason.trim()) throw new CashSessionError("REASON_REQUIRED", "El motivo del movimiento es obligatorio");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new CashSessionError("INVALID_AMOUNT", "Importe no válido");

  const [session] = await conn.select().from(cashSessions).where(eq(cashSessions.id, input.cashSessionId)).limit(1);
  if (!session) throw new CashSessionError("NOT_FOUND", "Sesión de caja no encontrada");
  if (session.status !== "open") throw new CashSessionError("SESSION_CLOSED", "No se pueden registrar movimientos en una sesión cerrada");

  const [result] = await conn.insert(cashMovements).values({
    cashSessionId: input.cashSessionId, type: input.type, amountCents: input.amountCents, reason: input.reason, actorUserId: input.actorUserId,
  });
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(cashMovements).where(eq(cashMovements.id, insertId)).limit(1);
  return row!;
}

export async function listCashSessions(venueId: number, limit = 50, db?: DbHandle): Promise<CashSession[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(cashSessions).where(eq(cashSessions.venueId, venueId)).orderBy(cashSessions.openedAt).limit(limit);
}

export async function getCashSession(sessionId: number, db?: DbHandle): Promise<CashSession | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(cashSessions).where(eq(cashSessions.id, sessionId)).limit(1);
  return row ?? null;
}
