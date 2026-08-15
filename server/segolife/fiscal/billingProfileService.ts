/**
 * billingProfileService.ts — SEGOLIFE FASE 10 (spec §11/§12). Datos de
 * facturación EXPLÍCITOS que un Student aporta para pedir una factura con
 * nombre — nunca se reutiliza el perfil de Student como identidad fiscal
 * automáticamente (spec §11). Un perfil por usuario (unique userId).
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { billingProfiles, type BillingProfile } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class BillingProfileError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "BillingProfileError";
  }
}

export async function getBillingProfile(userId: number, db?: DbHandle): Promise<BillingProfile | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(billingProfiles).where(eq(billingProfiles.userId, userId)).limit(1);
  return row ?? null;
}

export interface UpsertBillingProfileInput {
  userId: number;
  legalName: string;
  taxId: string;
  address?: string | null;
  country?: string;
  email?: string | null;
}

export async function upsertBillingProfile(input: UpsertBillingProfileInput, db?: DbHandle): Promise<BillingProfile> {
  const conn = db ?? (await getDb());
  if (!input.legalName.trim()) throw new BillingProfileError("INVALID_INPUT", "legalName es obligatorio");
  if (!input.taxId.trim()) throw new BillingProfileError("INVALID_INPUT", "taxId es obligatorio");

  const existing = await getBillingProfile(input.userId, conn);
  if (existing) {
    await conn.update(billingProfiles).set({
      legalName: input.legalName, taxId: input.taxId,
      address: input.address ?? null, country: input.country ?? "ES", email: input.email ?? null,
    }).where(eq(billingProfiles.id, existing.id));
    return (await getBillingProfile(input.userId, conn))!;
  }

  const [result] = await conn.insert(billingProfiles).values({
    userId: input.userId, legalName: input.legalName, taxId: input.taxId,
    address: input.address ?? null, country: input.country ?? "ES", email: input.email ?? null,
  });
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(billingProfiles).where(eq(billingProfiles.id, insertId)).limit(1);
  return row!;
}
