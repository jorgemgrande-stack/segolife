/**
 * studentLoginEventsDb.ts — histórico mínimo de login (Student 360).
 *
 * Auditado antes de crearse (docs/students/student-360-audit-and-architecture.md
 * §G): no existía ningún histórico de login en todo el repo, solo
 * users.lastSignedIn (timestamp único que se sobreescribe). Esta tabla
 * empieza a registrar SOLO desde el login exitoso a partir de esta fase —
 * nunca se fabrica histórico retroactivo. Sin IP/user-agent/fingerprint.
 */
import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { studentLoginEvents, type StudentLoginEvent } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export async function recordStudentLogin(userId: number, method = "password", db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.insert(studentLoginEvents).values({ userId, method });
}

export async function listLoginEventsByUserId(userId: number, limit = 20, db?: DbHandle): Promise<StudentLoginEvent[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(studentLoginEvents)
    .where(eq(studentLoginEvents.userId, userId))
    .orderBy(desc(studentLoginEvents.occurredAt))
    .limit(limit);
}

export async function getLastLoginByUserId(userId: number, db?: DbHandle): Promise<StudentLoginEvent | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(studentLoginEvents)
    .where(eq(studentLoginEvents.userId, userId))
    .orderBy(desc(studentLoginEvents.occurredAt))
    .limit(1);
  return row ?? null;
}
