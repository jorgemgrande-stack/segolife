/**
 * commerceDb.ts — lecturas del Commerce Core (Fase 5) para /admin/venues/:id
 * (tab Commerce/Integrations, spec punto 58). Escrituras viven en
 * commercePipeline.ts — este archivo es solo listados para el panel admin.
 */
import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { commerceTransactions, commerceTransactionItems, type CommerceTransaction, type CommerceTransactionItem } from "../../../drizzle/schema";

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
