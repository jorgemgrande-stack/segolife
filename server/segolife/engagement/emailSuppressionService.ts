/**
 * emailSuppressionService.ts — Communication Center, supresión técnica de
 * direcciones (spec §21). DISTINTO de notificationPreferencesService.ts
 * (opt-out de MARKETING, elección del Student) — esto bloquea CUALQUIER
 * envío, transactional o marketing por igual, porque la dirección en sí no
 * es entregable (hard bounce/blocked/spam) o fue suprimida manualmente.
 * Poblada por brevoWebhookRoutes.ts; consultada por emailProvider.ts ANTES
 * de intentar un envío.
 */
import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { emailSuppressions, type EmailSuppression } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function isEmailSuppressed(email: string, db?: DbHandle): Promise<boolean> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select({ id: emailSuppressions.id }).from(emailSuppressions)
    .where(eq(emailSuppressions.email, normalizeEmail(email))).limit(1);
  return !!row;
}

export interface SuppressEmailInput {
  email: string;
  reason: "hard_bounce" | "blocked" | "spam" | "manual";
  source: string;
  notes?: string | null;
}

/** Idempotente por diseño — `email` UNIQUE, INSERT...IGNORE (un mismo bounce reprocesado por el webhook nunca duplica ni lanza). */
export async function suppressEmail(input: SuppressEmailInput, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.insert(emailSuppressions).ignore().values({
    email: normalizeEmail(input.email),
    reason: input.reason,
    source: input.source,
    notes: input.notes ?? null,
  });
}

export async function listSuppressions(limit = 100, db?: DbHandle): Promise<EmailSuppression[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(emailSuppressions).orderBy(desc(emailSuppressions.suppressedAt)).limit(limit);
}

export async function removeSuppression(email: string, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.delete(emailSuppressions).where(eq(emailSuppressions.email, normalizeEmail(email)));
}
