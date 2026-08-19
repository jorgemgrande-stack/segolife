/**
 * studentPhotoEventsDb.ts — histórico mínimo de la foto de perfil (MG-03B,
 * Profile Photo Activity). Mismo criterio exacto que studentLoginEventsDb.ts:
 * empieza a registrar SOLO desde esta fase — nunca se fabrica histórico
 * retroactivo. Nunca guarda la imagen/URL/path de storage — solo la ACCIÓN
 * (added/updated/removed). Nunca concede SegoTokens, nunca es un movimiento
 * de token_ledger.
 */
import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { studentPhotoEvents, type StudentPhotoEvent } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type StudentPhotoEventAction = "added" | "updated" | "removed";

export async function recordStudentPhotoEvent(userId: number, action: StudentPhotoEventAction, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.insert(studentPhotoEvents).values({ userId, action });
}

export async function listPhotoEventsByUserId(userId: number, limit = 20, db?: DbHandle): Promise<StudentPhotoEvent[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(studentPhotoEvents)
    .where(eq(studentPhotoEvents.userId, userId))
    .orderBy(desc(studentPhotoEvents.occurredAt))
    .limit(limit);
}
