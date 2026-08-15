import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, desc } from "drizzle-orm";
import { tokenRedemptionPolicies, type TokenRedemptionPolicy, type InsertTokenRedemptionPolicy } from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export async function listTokenRedemptionPolicies(db?: DbHandle): Promise<TokenRedemptionPolicy[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(tokenRedemptionPolicies).orderBy(desc(tokenRedemptionPolicies.priority), desc(tokenRedemptionPolicies.createdAt));
}

export async function getTokenRedemptionPolicyById(id: number, db?: DbHandle): Promise<TokenRedemptionPolicy | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(tokenRedemptionPolicies).where(eq(tokenRedemptionPolicies.id, id)).limit(1);
  return row ?? null;
}

export async function createTokenRedemptionPolicy(input: InsertTokenRedemptionPolicy, db?: DbHandle): Promise<TokenRedemptionPolicy> {
  const conn = db ?? (await getDb());
  const insertResult = await conn.insert(tokenRedemptionPolicies).values(input);
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await conn.select().from(tokenRedemptionPolicies).where(eq(tokenRedemptionPolicies.id, insertId)).limit(1);
  return created;
}

export async function updateTokenRedemptionPolicy(
  id: number,
  fields: Partial<InsertTokenRedemptionPolicy>,
  db?: DbHandle
): Promise<TokenRedemptionPolicy | null> {
  const conn = db ?? (await getDb());
  await conn.update(tokenRedemptionPolicies).set(fields).where(eq(tokenRedemptionPolicies.id, id));
  const [updated] = await conn.select().from(tokenRedemptionPolicies).where(eq(tokenRedemptionPolicies.id, id)).limit(1);
  return updated ?? null;
}

export async function setTokenRedemptionPolicyActive(id: number, active: boolean, db?: DbHandle): Promise<TokenRedemptionPolicy | null> {
  const conn = db ?? (await getDb());
  await conn.update(tokenRedemptionPolicies).set({ active }).where(eq(tokenRedemptionPolicies.id, id));
  const [updated] = await conn.select().from(tokenRedemptionPolicies).where(eq(tokenRedemptionPolicies.id, id)).limit(1);
  return updated ?? null;
}
