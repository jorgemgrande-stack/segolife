/**
 * fiscalDocumentService.ts — SEGOLIFE FASE 10 (spec §13-25).
 *
 * Numeración concurrency-safe: MISMA TÉCNICA que server/documentNumbers.ts
 * (legacy Náyade) — UPDATE atómico + fallback INSERT con reintento en
 * ER_DUP_ENTRY — pero NUNCA su tabla `document_counters` (unión fija
 * DocumentType, compartida con presupuesto/reserva/tpv de Náyade). Aquí la
 * clave es (series_id, year) porque las series son dinámicas por entidad
 * fiscal (spec §15), no una unión de código.
 *
 * INMUTABILIDAD (spec §17): una vez insertada, una fila de fiscal_documents
 * NUNCA se actualiza (salvo pdf_key, que solo cachea la representación PDF
 * ya generada — no cambia ningún importe/número). Una corrección es SIEMPRE
 * un nuevo credit_note.
 */
import { eq, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  invoiceSeries, fiscalDocumentCounters, fiscalDocuments, fiscalDocumentLines,
  billingProfiles, type FiscalDocument, type FiscalDocumentLine,
} from "../../../drizzle/schema";
import { ensureFiscalSnapshot, type SnapshotSourceType } from "./fiscalSnapshotService";
import { calcTaxFromGrossCents } from "./moneyTax";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class FiscalDocumentError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "FiscalDocumentError";
  }
}

export interface UpsertInvoiceSeriesInput {
  id?: number;
  sellerEntityId: number;
  documentType: "invoice" | "credit_note";
  code: string;
  active?: boolean;
}

export async function upsertInvoiceSeries(input: UpsertInvoiceSeriesInput, db?: AnyDbHandle): Promise<typeof invoiceSeries.$inferSelect> {
  const conn = db ?? (await getDb());
  if (!input.code.trim()) throw new FiscalDocumentError("INVALID_INPUT", "code es obligatorio");
  if (input.id) {
    await conn.update(invoiceSeries).set({ code: input.code, active: input.active ?? true }).where(eq(invoiceSeries.id, input.id));
    const [row] = await conn.select().from(invoiceSeries).where(eq(invoiceSeries.id, input.id)).limit(1);
    if (!row) throw new FiscalDocumentError("NOT_FOUND", "Serie no encontrada");
    return row;
  }
  const [result] = await conn.insert(invoiceSeries).values({
    sellerEntityId: input.sellerEntityId, documentType: input.documentType, code: input.code, active: input.active ?? true,
  });
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(invoiceSeries).where(eq(invoiceSeries.id, insertId)).limit(1);
  return row!;
}

export async function listInvoiceSeries(sellerEntityId?: number, db?: AnyDbHandle): Promise<Array<typeof invoiceSeries.$inferSelect>> {
  const conn = db ?? (await getDb());
  if (sellerEntityId != null) return conn.select().from(invoiceSeries).where(eq(invoiceSeries.sellerEntityId, sellerEntityId));
  return conn.select().from(invoiceSeries);
}

/** UPDATE atómico + fallback INSERT con reintento en ER_DUP_ENTRY — misma técnica que server/documentNumbers.ts, spec §14 CRITICAL. */
async function allocateNumber(seriesId: number, year: number, conn: DbHandle): Promise<number> {
  const updateResult = await conn.update(fiscalDocumentCounters)
    .set({ currentNumber: sql`current_number + 1` })
    .where(and(eq(fiscalDocumentCounters.seriesId, seriesId), eq(fiscalDocumentCounters.year, year)));
  const affected = (updateResult as unknown as { affectedRows: number }[])?.[0]?.affectedRows ?? 0;

  if (affected === 0) {
    try {
      await conn.insert(fiscalDocumentCounters).values({ seriesId, year, currentNumber: 1 });
    } catch (err: unknown) {
      const mysqlErr = err as { code?: string };
      if (mysqlErr?.code === "ER_DUP_ENTRY") {
        await conn.update(fiscalDocumentCounters)
          .set({ currentNumber: sql`current_number + 1` })
          .where(and(eq(fiscalDocumentCounters.seriesId, seriesId), eq(fiscalDocumentCounters.year, year)));
      } else {
        throw err;
      }
    }
  }

  const [counter] = await conn.select().from(fiscalDocumentCounters)
    .where(and(eq(fiscalDocumentCounters.seriesId, seriesId), eq(fiscalDocumentCounters.year, year)))
    .limit(1);
  if (!counter) throw new FiscalDocumentError("COUNTER_ERROR", "No se pudo obtener el contador de la serie");
  return counter.currentNumber;
}

const SEQUENCE_PADDING = 4;

export interface IssueInvoiceInput {
  sourceType: SnapshotSourceType;
  sourceId: number;
  seriesId: number;
  buyerBillingProfileId?: number | null;
  buyerUserId?: number | null;
  issuedByUserId: number;
}

/**
 * Emite una factura a partir de una venta nativa finalizada. Idempotente por
 * snapshot: si ya existe una factura para este snapshot, la devuelve sin
 * duplicar (spec §22, mismo criterio que el resto de la plataforma — nunca
 * doble numeración por reintento).
 */
export async function issueInvoice(input: IssueInvoiceInput, db?: DbHandle): Promise<FiscalDocument> {
  const conn = db ?? (await getDb());

  const snapshot = await ensureFiscalSnapshot(input.sourceType, input.sourceId, conn);
  if (!snapshot) throw new FiscalDocumentError("NOT_ELIGIBLE", "Esta venta no es una venta nativa finalizada de Segolife — no se puede facturar");
  if (!snapshot.sellerEntityId) throw new FiscalDocumentError("SELLER_NOT_CONFIGURED", "El venue de esta venta no tiene entidad vendedora configurada todavía");
  if (snapshot.taxRateBasisPoints == null || snapshot.taxBaseCents == null || snapshot.taxAmountCents == null) {
    throw new FiscalDocumentError("TAX_NOT_CONFIGURED", "Esta venta tiene productos sin tipo de IVA configurado — no se puede facturar hasta configurarlo");
  }

  const [existing] = await conn.select().from(fiscalDocuments).where(eq(fiscalDocuments.fiscalSnapshotId, snapshot.id)).limit(1);
  if (existing) return existing;

  const [series] = await conn.select().from(invoiceSeries).where(eq(invoiceSeries.id, input.seriesId)).limit(1);
  if (!series || !series.active) throw new FiscalDocumentError("SERIES_NOT_FOUND", "Serie de facturación no encontrada o inactiva");
  if (series.sellerEntityId !== snapshot.sellerEntityId) throw new FiscalDocumentError("SERIES_MISMATCH", "La serie indicada no pertenece a la entidad vendedora de esta venta");
  if (series.documentType !== "invoice") throw new FiscalDocumentError("SERIES_MISMATCH", "La serie indicada no es de tipo factura");

  let buyerBillingProfileId = input.buyerBillingProfileId ?? null;
  if (buyerBillingProfileId) {
    const [profile] = await conn.select().from(billingProfiles).where(eq(billingProfiles.id, buyerBillingProfileId)).limit(1);
    if (!profile) throw new FiscalDocumentError("BILLING_PROFILE_NOT_FOUND", "Perfil de facturación no encontrado");
  }

  const year = new Date(snapshot.occurredAt).getFullYear();
  const sequence = await allocateNumber(series.id, year, conn);
  const documentNumber = `${series.code}-${year}-${String(sequence).padStart(SEQUENCE_PADDING, "0")}`;

  const [result] = await conn.insert(fiscalDocuments).values({
    documentType: "invoice",
    seriesId: series.id,
    documentNumber,
    sellerEntityId: snapshot.sellerEntityId,
    buyerBillingProfileId,
    buyerUserId: input.buyerUserId ?? snapshot.buyerUserId ?? null,
    fiscalSnapshotId: snapshot.id,
    originalDocumentId: null,
    issueDate: new Date(),
    currency: snapshot.currency,
    taxBaseCents: snapshot.taxBaseCents,
    taxAmountCents: snapshot.taxAmountCents,
    totalCents: snapshot.grossAmountCents,
    reason: null,
    issuedByUserId: input.issuedByUserId,
  });
  const insertId = (result as unknown as { insertId: number }).insertId;

  const items = (snapshot.itemsSnapshot ?? []) as Array<{ description: string; quantity: number; unitAmountCents: number; totalAmountCents: number }>;
  for (const item of items) {
    const b = calcTaxFromGrossCents(item.totalAmountCents, snapshot.taxRateBasisPoints);
    await conn.insert(fiscalDocumentLines).values({
      documentId: insertId,
      description: item.description,
      quantity: item.quantity,
      unitAmountCents: item.unitAmountCents,
      totalAmountCents: item.totalAmountCents,
      taxRateBasisPoints: snapshot.taxRateBasisPoints,
      taxBaseCents: b.taxBaseCents,
      taxAmountCents: b.taxAmountCents,
    });
  }

  const [document] = await conn.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, insertId)).limit(1);
  return document!;
}

export interface IssueCreditNoteInput {
  originalDocumentId: number;
  amountCents: number;
  reason: string;
  issuedByUserId: number;
}

/**
 * Emite un documento rectificativo (abono) contra una factura ya emitida —
 * spec §18/§19: nunca reescribe el original, siempre añade. Soporta abono
 * parcial (amountCents < original.totalCents) o total. Bloquea si el
 * acumulado de abonos ya emitidos + este superaría el total original (spec
 * §22, idempotencia/anti-doble-reembolso fiscal).
 */
export async function issueCreditNote(input: IssueCreditNoteInput, db?: DbHandle): Promise<FiscalDocument> {
  const conn = db ?? (await getDb());
  if (!input.reason.trim()) throw new FiscalDocumentError("REASON_REQUIRED", "El motivo del abono es obligatorio");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new FiscalDocumentError("INVALID_AMOUNT", "Importe de abono no válido");

  const [original] = await conn.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, input.originalDocumentId)).limit(1);
  if (!original) throw new FiscalDocumentError("NOT_FOUND", "Factura original no encontrada");
  if (original.documentType !== "invoice") throw new FiscalDocumentError("INVALID_ORIGINAL", "Solo se puede rectificar una factura, no otro abono");

  const existingCreditNotes = await conn.select().from(fiscalDocuments).where(eq(fiscalDocuments.originalDocumentId, original.id));
  const alreadyCredited = existingCreditNotes.reduce((sum, d) => sum + d.totalCents, 0);
  if (alreadyCredited + input.amountCents > original.totalCents) {
    throw new FiscalDocumentError("OVER_REFUND", "El importe de abono acumulado superaría el total de la factura original");
  }

  const [series] = await conn.select().from(invoiceSeries)
    .where(and(eq(invoiceSeries.sellerEntityId, original.sellerEntityId), eq(invoiceSeries.documentType, "credit_note"), eq(invoiceSeries.active, true)))
    .limit(1);
  if (!series) throw new FiscalDocumentError("SERIES_NOT_FOUND", "No hay serie de abonos configurada para esta entidad vendedora");

  // Recupera el tipo efectivo aplicado en el original (basis points enteros) — evita duplicar el dato en la propia fila.
  const effectiveRate = original.taxBaseCents > 0 ? Math.round((original.taxAmountCents * 10000) / original.taxBaseCents) : 0;
  const b = calcTaxFromGrossCents(input.amountCents, effectiveRate);

  const year = new Date().getFullYear();
  const sequence = await allocateNumber(series.id, year, conn);
  const documentNumber = `${series.code}-${year}-${String(sequence).padStart(SEQUENCE_PADDING, "0")}`;

  const [result] = await conn.insert(fiscalDocuments).values({
    documentType: "credit_note",
    seriesId: series.id,
    documentNumber,
    sellerEntityId: original.sellerEntityId,
    buyerBillingProfileId: original.buyerBillingProfileId,
    buyerUserId: original.buyerUserId,
    fiscalSnapshotId: original.fiscalSnapshotId,
    originalDocumentId: original.id,
    issueDate: new Date(),
    currency: original.currency,
    taxBaseCents: b.taxBaseCents,
    taxAmountCents: b.taxAmountCents,
    totalCents: input.amountCents,
    reason: input.reason,
    issuedByUserId: input.issuedByUserId,
  });
  const insertId = (result as unknown as { insertId: number }).insertId;

  await conn.insert(fiscalDocumentLines).values({
    documentId: insertId,
    description: `Rectificación de factura ${original.documentNumber}`,
    quantity: 1,
    unitAmountCents: input.amountCents,
    totalAmountCents: input.amountCents,
    taxRateBasisPoints: effectiveRate,
    taxBaseCents: b.taxBaseCents,
    taxAmountCents: b.taxAmountCents,
  });

  const [document] = await conn.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, insertId)).limit(1);
  return document!;
}

export async function listFiscalDocuments(filters: { buyerUserId?: number; sellerEntityId?: number; documentType?: "invoice" | "credit_note" }, db?: AnyDbHandle): Promise<FiscalDocument[]> {
  const conn = db ?? (await getDb());
  const conditions = [];
  if (filters.buyerUserId != null) conditions.push(eq(fiscalDocuments.buyerUserId, filters.buyerUserId));
  if (filters.sellerEntityId != null) conditions.push(eq(fiscalDocuments.sellerEntityId, filters.sellerEntityId));
  if (filters.documentType != null) conditions.push(eq(fiscalDocuments.documentType, filters.documentType));
  const query = conn.select().from(fiscalDocuments).orderBy(sql`${fiscalDocuments.createdAt} DESC`);
  if (conditions.length) return query.where(and(...conditions));
  return query;
}

export async function getFiscalDocument(id: number, db?: AnyDbHandle): Promise<FiscalDocument | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, id)).limit(1);
  return row ?? null;
}

export async function getFiscalDocumentLines(documentId: number, db?: AnyDbHandle): Promise<FiscalDocumentLine[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(fiscalDocumentLines).where(eq(fiscalDocumentLines.documentId, documentId));
}
