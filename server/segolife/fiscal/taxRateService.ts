/**
 * taxRateService.ts — SEGOLIFE FASE 10 (spec §6/§7). Catálogo de tipos de
 * IVA configurables — NUNCA se infiere un tipo a partir de texto de
 * categoría de producto (spec §7), siempre resuelto por `taxRateId`
 * explícito en venue_products/event_ticket_types. GLOBAL_ADMIN exclusivamente.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { taxRates, venueProducts, eventTicketTypes, type TaxRate } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class TaxRateError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "TaxRateError";
  }
}

export async function listTaxRates(db?: DbHandle): Promise<TaxRate[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(taxRates).orderBy(taxRates.name);
}

export interface UpsertTaxRateInput {
  id?: number;
  name: string;
  rateBasisPoints: number;
  country?: string;
  active?: boolean;
}

export async function upsertTaxRate(input: UpsertTaxRateInput, db?: DbHandle): Promise<TaxRate> {
  const conn = db ?? (await getDb());
  if (!input.name.trim()) throw new TaxRateError("INVALID_INPUT", "name es obligatorio");
  if (!Number.isInteger(input.rateBasisPoints) || input.rateBasisPoints < 0 || input.rateBasisPoints > 10000) {
    throw new TaxRateError("INVALID_INPUT", "rateBasisPoints debe estar entre 0 y 10000");
  }
  if (input.id) {
    await conn.update(taxRates).set({
      name: input.name, rateBasisPoints: input.rateBasisPoints,
      country: input.country ?? "ES", active: input.active ?? true,
    }).where(eq(taxRates.id, input.id));
    const [row] = await conn.select().from(taxRates).where(eq(taxRates.id, input.id)).limit(1);
    if (!row) throw new TaxRateError("NOT_FOUND", "Tipo de IVA no encontrado");
    return row;
  }
  const [result] = await conn.insert(taxRates).values({
    name: input.name, rateBasisPoints: input.rateBasisPoints,
    country: input.country ?? "ES", active: input.active ?? true,
  });
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(taxRates).where(eq(taxRates.id, insertId)).limit(1);
  return row!;
}

/** Asigna (o quita, con null) el tipo de IVA de un producto de venue — spec §7. Server-side, nunca confiado al cliente. */
export async function setVenueProductTaxRate(venueProductId: number, taxRateId: number | null, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(venueProducts).set({ taxRateId }).where(eq(venueProducts.id, venueProductId));
}

/** Igual que setVenueProductTaxRate pero para tipos de entrada — spec §7. */
export async function setEventTicketTypeTaxRate(ticketTypeId: number, taxRateId: number | null, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(eventTicketTypes).set({ taxRateId }).where(eq(eventTicketTypes.id, ticketTypeId));
}

export async function getTaxRate(id: number, db?: DbHandle): Promise<TaxRate | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(taxRates).where(eq(taxRates.id, id)).limit(1);
  return row ?? null;
}
