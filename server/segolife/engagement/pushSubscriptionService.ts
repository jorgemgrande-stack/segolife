/**
 * pushSubscriptionService.ts — F67 (Push + WhatsApp). CRUD real sobre
 * `push_subscriptions` (existía en schema desde Fase 7, "preparado, sin
 * nada que la escribiera todavía" — confirmado por auditoría). Único punto
 * de escritura de esta tabla; el router y `pushProvider.ts` delegan aquí.
 *
 * Un mismo `endpoint` es GLOBALMENTE único (UNIQUE real de BD, un
 * `PushSubscription` del navegador identifica exactamente una combinación
 * navegador+dispositivo+origen) — re-suscribirse con el mismo endpoint
 * (refresco de claves del navegador, o simplemente volver a pulsar
 * "Activar") es un upsert idempotente, nunca una fila duplicada ni un
 * error.
 */
import { eq, and, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { pushSubscriptions, type PushSubscription } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface SaveSubscriptionInput {
  userId: number;
  endpoint: string;
  keysP256dh: string | null;
  keysAuth: string | null;
}

/** Alta o reactivación — mismo endpoint ya existente (de este usuario o de otro dispositivo que compartiera sesión) se actualiza in-place, nunca se duplica. */
export async function saveSubscription(input: SaveSubscriptionInput, db?: DbHandle): Promise<PushSubscription> {
  const conn = db ?? (await getDb());
  const [existing] = await conn.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, input.endpoint)).limit(1);

  if (existing) {
    await conn.update(pushSubscriptions)
      .set({ userId: input.userId, keysP256dh: input.keysP256dh, keysAuth: input.keysAuth, revokedAt: null })
      .where(eq(pushSubscriptions.id, existing.id));
    const [updated] = await conn.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, existing.id)).limit(1);
    return updated;
  }

  const result = await conn.insert(pushSubscriptions).values({
    userId: input.userId, endpoint: input.endpoint, keysP256dh: input.keysP256dh, keysAuth: input.keysAuth,
  });
  const insertId = (result as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await conn.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, insertId)).limit(1);
  return created;
}

/** Baja explícita del propio estudiante (nunca de otro usuario — el router exige que endpoint pertenezca a ctx.user.id antes de llamar aquí). Idempotente: revocar dos veces no es un error. */
export async function revokeSubscriptionForUser(userId: number, endpoint: string, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(pushSubscriptions).set({ revokedAt: new Date() })
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

/** Auto-limpieza desde pushProvider.ts cuando el propio navegador/OS ya invalidó el endpoint (404/410) — sin verificación de propietario, ya no es un dato sensible de sesión. */
export async function revokeSubscriptionByEndpoint(endpoint: string, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.update(pushSubscriptions).set({ revokedAt: new Date() }).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function listActiveSubscriptionsForUser(userId: number, db?: DbHandle): Promise<PushSubscription[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt)));
}

/** Autoservicio — ¿tiene el estudiante al menos una suscripción activa? Para que la UI muestre "Activadas" vs. el botón de opt-in, sin exponer endpoints/keys al cliente. */
export async function hasActivePushSubscription(userId: number, db?: DbHandle): Promise<boolean> {
  const rows = await listActiveSubscriptionsForUser(userId, db);
  return rows.length > 0;
}
