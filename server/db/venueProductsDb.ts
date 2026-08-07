import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";
import { venueProducts, type VenueProduct } from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export async function listVenueProducts(venueId: number, db?: DbHandle): Promise<VenueProduct[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(venueProducts).where(eq(venueProducts.venueId, venueId)).orderBy(venueProducts.name);
}

export async function getVenueProductById(id: number, db?: DbHandle): Promise<VenueProduct | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(venueProducts).where(eq(venueProducts.id, id)).limit(1);
  return row ?? null;
}

export interface CreateVenueProductInput {
  venueId: number;
  name: string;
  slug: string;
  category?: string | null;
  price?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function createVenueProduct(input: CreateVenueProductInput, db?: DbHandle): Promise<VenueProduct> {
  const conn = db ?? (await getDb());
  const insertResult = await conn.insert(venueProducts).values(input);
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await conn.select().from(venueProducts).where(eq(venueProducts.id, insertId)).limit(1);
  return created;
}

export interface UpdateVenueProductFields {
  name?: string;
  slug?: string;
  category?: string | null;
  price?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function updateVenueProduct(
  id: number,
  fields: UpdateVenueProductFields,
  db?: DbHandle
): Promise<VenueProduct | null> {
  const conn = db ?? (await getDb());
  await conn.update(venueProducts).set(fields).where(eq(venueProducts.id, id));
  const [updated] = await conn.select().from(venueProducts).where(eq(venueProducts.id, id)).limit(1);
  return updated ?? null;
}

export async function setVenueProductActive(id: number, active: boolean, db?: DbHandle): Promise<VenueProduct | null> {
  const conn = db ?? (await getDb());
  await conn.update(venueProducts).set({ isActive: active }).where(eq(venueProducts.id, id));
  const [updated] = await conn.select().from(venueProducts).where(eq(venueProducts.id, id)).limit(1);
  return updated ?? null;
}
