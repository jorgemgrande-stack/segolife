/**
 * fiscalSnapshotService.ts — SEGOLIFE FASE 10 (spec §10/§71/§72).
 *
 * DISEÑO DELIBERADO: `ensureFiscalSnapshot` es idempotente (get-or-create) e
 * invocado BAJO DEMANDA (desde fiscalDocumentService al emitir un documento,
 * o desde el detalle de pedido de Ventas y Operaciones) — nunca enganchado
 * de forma síncrona dentro de nativeCommerceService/doorSaleService/
 * checkoutService (Fase 9, ya probados en producción). Spec §10 dice
 * "create/reuse" explícitamente, lo que permite este patrón; evita tocar
 * pipelines críticos ya desplegados, mismo criterio de conservadurismo
 * arquitectónico que salesReadModel.ts (normaliza en tiempo de consulta,
 * nunca en escritura).
 *
 * SOLO VENTAS NATIVAS (spec §71/§72/§S CRÍTICO): una venta de Fourvenues
 * (ticket_orders sin channel nativo, o commerce_transactions con
 * provider≠"segolife") NUNCA genera un snapshot fiscal — visibilidad en
 * Ventas ≠ responsabilidad fiscal de Segolife.
 */
import { eq, and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  commerceTransactions, commerceTransactionItems, venueProducts,
  ticketOrders, ticketOrderItems, eventTicketTypes, events,
  tokenSpendReservations, fiscalTransactionSnapshots,
  type FiscalTransactionSnapshot,
} from "../../../drizzle/schema";
import { resolveSellerForVenue } from "./commercialEntityService";
import { calcTaxFromGrossCents } from "./moneyTax";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class FiscalSnapshotError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "FiscalSnapshotError";
  }
}

export type SnapshotSourceType = "commerce_transaction" | "ticket_order";

interface LineForTax {
  description: string;
  quantity: number;
  unitAmountCents: number;
  totalAmountCents: number;
  taxRateBasisPoints: number | null;
}

function resolveAggregateTax(lines: LineForTax[]): { taxRateBasisPoints: number | null; taxBaseCents: number | null; taxAmountCents: number | null } {
  if (!lines.length || lines.some(l => l.taxRateBasisPoints == null)) {
    return { taxRateBasisPoints: null, taxBaseCents: null, taxAmountCents: null };
  }
  let taxBaseCents = 0;
  let taxAmountCents = 0;
  for (const line of lines) {
    const b = calcTaxFromGrossCents(line.totalAmountCents, line.taxRateBasisPoints!);
    taxBaseCents += b.taxBaseCents;
    taxAmountCents += b.taxAmountCents;
  }
  const uniform = lines.every(l => l.taxRateBasisPoints === lines[0].taxRateBasisPoints);
  return { taxRateBasisPoints: uniform ? lines[0].taxRateBasisPoints : null, taxBaseCents, taxAmountCents };
}

async function buildFromCommerceTransaction(sourceId: number, conn: DbHandle) {
  const [tx] = await conn.select().from(commerceTransactions).where(eq(commerceTransactions.id, sourceId)).limit(1);
  if (!tx) throw new FiscalSnapshotError("NOT_FOUND", "Transacción de comercio no encontrada");
  if (tx.provider !== "segolife") return null; // Fourvenues/externo — spec §71/§72, nunca snapshot fiscal
  if (!["confirmed", "refunded", "partially_refunded"].includes(tx.status)) return null; // solo ventas finalizadas

  const items = await conn.select().from(commerceTransactionItems).where(eq(commerceTransactionItems.transactionId, tx.id));
  const productIds = items.map(i => i.venueProductId).filter((id): id is number => id != null);
  const products = productIds.length ? await conn.select().from(venueProducts).where(inArray(venueProducts.id, productIds)) : [];
  const productById = new Map(products.map(p => [p.id, p]));

  const lines: LineForTax[] = items.map(i => ({
    description: i.description,
    quantity: i.quantity,
    unitAmountCents: i.unitAmountCents,
    totalAmountCents: i.totalAmountCents,
    taxRateBasisPoints: i.venueProductId ? (productById.get(i.venueProductId)?.taxRateId ?? null) : null,
  }));

  let reservation: typeof tokenSpendReservations.$inferSelect | null = null;
  if (tx.tokenReservationId) {
    const [row] = await conn.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.id, tx.tokenReservationId)).limit(1);
    reservation = row ?? null;
  }

  return {
    venueId: tx.venueId,
    eventId: tx.eventId ?? null,
    buyerUserId: tx.userId ?? null,
    occurredAt: tx.occurredAt,
    currency: tx.currency,
    grossAmountCents: tx.totalCents,
    promotionalValueCents: reservation?.promotionalValueCents ?? 0,
    moneyDueCents: reservation?.moneyDueCents ?? tx.totalCents,
    paymentMethod: tx.paymentMethod ?? null,
    lines,
  };
}

async function buildFromTicketOrder(sourceId: number, conn: DbHandle) {
  const [order] = await conn.select().from(ticketOrders).where(eq(ticketOrders.id, sourceId)).limit(1);
  if (!order) throw new FiscalSnapshotError("NOT_FOUND", "Pedido de entradas no encontrado");
  if (order.channel !== "online" && order.channel !== "door") return null; // Fourvenues (channel NULL) — spec §71/§72
  if (!["paid", "refunded", "partially_refunded"].includes(order.status)) return null;

  const [event] = await conn.select().from(events).where(eq(events.id, order.eventId)).limit(1);
  const items = await conn.select().from(ticketOrderItems).where(eq(ticketOrderItems.orderId, order.id));
  const typeIds = items.map(i => i.ticketTypeId).filter((id): id is number => id != null);
  const types = typeIds.length ? await conn.select().from(eventTicketTypes).where(inArray(eventTicketTypes.id, typeIds)) : [];
  const typeById = new Map(types.map(t => [t.id, t]));

  const lines: LineForTax[] = items.map(i => ({
    description: i.ticketTypeId ? (typeById.get(i.ticketTypeId)?.name ?? "Entrada") : "Entrada",
    quantity: i.quantity,
    unitAmountCents: i.unitPriceCents,
    totalAmountCents: i.totalPriceCents,
    taxRateBasisPoints: i.ticketTypeId ? (typeById.get(i.ticketTypeId)?.taxRateId ?? null) : null,
  }));

  let reservation: typeof tokenSpendReservations.$inferSelect | null = null;
  if (order.tokenReservationId) {
    const [row] = await conn.select().from(tokenSpendReservations).where(eq(tokenSpendReservations.id, order.tokenReservationId)).limit(1);
    reservation = row ?? null;
  }

  return {
    venueId: event?.venueId ?? null,
    eventId: order.eventId,
    buyerUserId: order.userId ?? null,
    occurredAt: order.purchasedAt ?? order.createdAt,
    currency: order.currency,
    grossAmountCents: order.totalCents,
    promotionalValueCents: reservation?.promotionalValueCents ?? 0,
    moneyDueCents: reservation?.moneyDueCents ?? order.totalCents,
    paymentMethod: order.paymentMethod ?? null,
    lines,
  };
}

/**
 * Get-or-create idempotente. Devuelve `null` cuando la venta es externa
 * (Fourvenues) o no está finalizada todavía — nunca crea un snapshot para
 * esos casos (spec §71/§72).
 */
export async function ensureFiscalSnapshot(sourceType: SnapshotSourceType, sourceId: number, db?: DbHandle): Promise<FiscalTransactionSnapshot | null> {
  const conn = db ?? (await getDb());
  const [existing] = await conn.select().from(fiscalTransactionSnapshots)
    .where(and(eq(fiscalTransactionSnapshots.sourceType, sourceType), eq(fiscalTransactionSnapshots.sourceId, sourceId)))
    .limit(1);
  if (existing) return existing;

  const built = sourceType === "commerce_transaction"
    ? await buildFromCommerceTransaction(sourceId, conn)
    : await buildFromTicketOrder(sourceId, conn);
  if (!built) return null;

  const lines = built.lines;
  const tax = resolveAggregateTax(lines);
  const seller = built.venueId != null ? await resolveSellerForVenue(built.venueId, conn) : { configured: false, sellerEntity: null, collectorEntity: null };

  const insertValues = {
    sourceType,
    sourceId,
    venueId: built.venueId,
    eventId: built.eventId,
    sellerEntityId: seller.sellerEntity?.id ?? null,
    sellerLegalName: seller.sellerEntity?.legalName ?? null,
    sellerTaxId: seller.sellerEntity?.taxId ?? null,
    collectorEntityId: seller.collectorEntity?.id ?? seller.sellerEntity?.id ?? null,
    buyerUserId: built.buyerUserId,
    occurredAt: built.occurredAt,
    currency: built.currency,
    grossAmountCents: built.grossAmountCents,
    promotionalValueCents: built.promotionalValueCents,
    moneyDueCents: built.moneyDueCents,
    taxRateBasisPoints: tax.taxRateBasisPoints,
    taxBaseCents: tax.taxBaseCents,
    taxAmountCents: tax.taxAmountCents,
    itemsSnapshot: lines.map(l => ({ description: l.description, quantity: l.quantity, unitAmountCents: l.unitAmountCents, totalAmountCents: l.totalAmountCents })),
    paymentMethod: built.paymentMethod,
  };

  try {
    const [result] = await conn.insert(fiscalTransactionSnapshots).values(insertValues);
    const insertId = (result as unknown as { insertId: number }).insertId;
    const [row] = await conn.select().from(fiscalTransactionSnapshots).where(eq(fiscalTransactionSnapshots.id, insertId)).limit(1);
    return row ?? null;
  } catch (err: unknown) {
    // Carrera: otra petición concurrente ya creó el snapshot — idempotente, devolvemos el existente.
    const mysqlErr = err as { code?: string };
    if (mysqlErr?.code === "ER_DUP_ENTRY") {
      const [row] = await conn.select().from(fiscalTransactionSnapshots)
        .where(and(eq(fiscalTransactionSnapshots.sourceType, sourceType), eq(fiscalTransactionSnapshots.sourceId, sourceId)))
        .limit(1);
      return row ?? null;
    }
    throw err;
  }
}

export async function getFiscalSnapshot(sourceType: SnapshotSourceType, sourceId: number, db?: DbHandle): Promise<FiscalTransactionSnapshot | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(fiscalTransactionSnapshots)
    .where(and(eq(fiscalTransactionSnapshots.sourceType, sourceType), eq(fiscalTransactionSnapshots.sourceId, sourceId)))
    .limit(1);
  return row ?? null;
}
