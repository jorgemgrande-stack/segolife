import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, desc } from "drizzle-orm";
import { tokenRules, type TokenRule, type InsertTokenRule } from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export async function listTokenRules(db?: DbHandle): Promise<TokenRule[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(tokenRules).orderBy(desc(tokenRules.priority), desc(tokenRules.createdAt));
}

export async function getTokenRuleById(id: number, db?: DbHandle): Promise<TokenRule | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(tokenRules).where(eq(tokenRules.id, id)).limit(1);
  return row ?? null;
}

export async function createTokenRule(input: InsertTokenRule, db?: DbHandle): Promise<TokenRule> {
  const conn = db ?? (await getDb());
  const insertResult = await conn.insert(tokenRules).values(input);
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await conn.select().from(tokenRules).where(eq(tokenRules.id, insertId)).limit(1);
  return created;
}

export async function updateTokenRule(
  id: number,
  fields: Partial<InsertTokenRule>,
  db?: DbHandle
): Promise<TokenRule | null> {
  const conn = db ?? (await getDb());
  await conn.update(tokenRules).set(fields).where(eq(tokenRules.id, id));
  const [updated] = await conn.select().from(tokenRules).where(eq(tokenRules.id, id)).limit(1);
  return updated ?? null;
}

export async function setTokenRuleActive(id: number, active: boolean, db?: DbHandle): Promise<TokenRule | null> {
  const conn = db ?? (await getDb());
  await conn.update(tokenRules).set({ active }).where(eq(tokenRules.id, id));
  const [updated] = await conn.select().from(tokenRules).where(eq(tokenRules.id, id)).limit(1);
  return updated ?? null;
}
