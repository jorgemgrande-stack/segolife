/**
 * notificationPreferencesService.ts — resolución de preferencias +
 * consentimiento (Fase 7, spec puntos 9-11). `notification_preferences` ES
 * el registro de consentimiento de marketing — ausencia de fila = default
 * de política, nunca una tabla de consent separada.
 *
 * Política de default (spec punto 10 — "marketing OFF unless explicitly
 * granted"):
 *  - in_app：siempre true (nunca se puede desactivar del todo — spec punto 61).
 *  - transactional (cualquier canal): siempre true, IGNORA la tabla —
 *    "No permitir desactivar comunicaciones transaccionales esenciales".
 *  - marketing + email/push/whatsapp: default false SIN fila; con fila,
 *    respeta el valor guardado.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { notificationPreferences, type NotificationPreference } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
// Una transacción abierta (tx) es incompatible en TypeScript con DbHandle
// aunque comparten la misma API en tiempo de ejecución — mismo workaround
// que server/segolife/ticketing/ticketingDb.ts (AnyDbHandle). Permite pasar
// un `tx` de otro módulo (p.ej. registrationService.ts) a updatePreference.
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type NotificationCategory = "events" | "rewards" | "benefits" | "promotions" | "account";
export type NotificationChannel = "in_app" | "email" | "push" | "whatsapp";

export async function isChannelAllowed(
  input: { userId: number; category: NotificationCategory; channel: NotificationChannel; audienceType: "transactional" | "marketing" },
  db?: DbHandle
): Promise<boolean> {
  if (input.channel === "in_app") return true; // nunca desactivable del todo
  if (input.audienceType === "transactional") return true; // esenciales, ignoran preferencia

  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(notificationPreferences)
    .where(and(
      eq(notificationPreferences.userId, input.userId),
      eq(notificationPreferences.category, input.category),
      eq(notificationPreferences.channel, input.channel)
    )).limit(1);

  return row ? row.enabled : false; // sin fila = marketing OFF por defecto
}

export async function listMyPreferences(userId: number, db?: DbHandle): Promise<NotificationPreference[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
}

export async function updatePreference(
  input: { userId: number; category: NotificationCategory; channel: NotificationChannel; enabled: boolean },
  db?: AnyDbHandle
): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.insert(notificationPreferences)
    .values(input)
    .onDuplicateKeyUpdate({ set: { enabled: input.enabled } });
}
