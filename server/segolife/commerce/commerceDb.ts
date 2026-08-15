/**
 * commerceDb.ts — lecturas del Commerce Core (Fase 5) para /admin/venues/:id
 * (tab Commerce/Integrations, spec punto 58). Escrituras viven en
 * commercePipeline.ts — este archivo es solo listados para el panel admin.
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { commerceTransactions, commerceTransactionItems, venues, type CommerceTransaction, type CommerceTransactionItem } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export async function listCommerceTransactionsByVenue(venueId: number, db?: DbHandle): Promise<CommerceTransaction[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(commerceTransactions).where(eq(commerceTransactions.venueId, venueId)).orderBy(desc(commerceTransactions.occurredAt)).limit(200);
}

export async function listCommerceTransactionItems(transactionId: number, db?: DbHandle): Promise<CommerceTransactionItem[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(commerceTransactionItems).where(eq(commerceTransactionItems.transactionId, transactionId));
}

/** SEGOLIFE — VENUE & PARTNER APP (spec §31 IDOR gate): resuelve el venueId real de una transacción para poder autorizar ANTES de revelar sus líneas — listCommerceTransactionItems no traía venueId por sí sola. */
export async function getCommerceTransactionVenueId(transactionId: number, db?: DbHandle): Promise<number | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select({ venueId: commerceTransactions.venueId }).from(commerceTransactions).where(eq(commerceTransactions.id, transactionId)).limit(1);
  return row?.venueId ?? null;
}

// ─── ADMIN (Student 360) — histórico por usuario ───────────────────────────
// Auditoría previa (docs/students/student-360-audit-and-architecture.md §C):
// no existía NINGUNA función que listara/agregara commerce_transactions por
// userId — solo por venue. Requiere el índice user_id creado en la migración
// 0141 (antes no existía ninguno sobre esta columna).

export interface StudentCommerceTransactionItem {
  transaction: CommerceTransaction;
  venueName: string | null;
}

export async function listCommerceTransactionsByUserId(userId: number, db?: DbHandle): Promise<StudentCommerceTransactionItem[]> {
  const conn = db ?? (await getDb());
  return conn.select({
    transaction: commerceTransactions,
    venueName: venues.name,
  }).from(commerceTransactions)
    .leftJoin(venues, eq(commerceTransactions.venueId, venues.id))
    .where(eq(commerceTransactions.userId, userId))
    .orderBy(desc(commerceTransactions.occurredAt))
    .limit(200);
}

export interface StudentCommerceSpendSummary {
  transactionCount: number;
  totalSpendCents: number;
}

/** SUM agregado en SQL, nunca sumar en Node (spec de performance, §5 del documento de arquitectura). Solo cuenta transacciones 'confirmed'. */
export async function getCommerceSpendSummaryByUserId(userId: number, db?: DbHandle): Promise<StudentCommerceSpendSummary> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select({
    transactionCount: sql<number>`COUNT(*)`,
    totalSpendCents: sql<string>`COALESCE(SUM(${commerceTransactions.totalCents}), 0)`,
  }).from(commerceTransactions).where(and(eq(commerceTransactions.userId, userId), eq(commerceTransactions.status, "confirmed")));
  return { transactionCount: Number(row?.transactionCount ?? 0), totalSpendCents: Number(row?.totalSpendCents ?? 0) };
}
