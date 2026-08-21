/**
 * studentAdminActionsDb.ts — audit trail mínimo de acciones administrativas
 * sobre un estudiante (Student 360).
 *
 * Auditado antes de crearse (docs/students/student-360-audit-and-architecture.md
 * §7): los ajustes de SegoTokens y Benefits YA tienen su propio audit trail
 * completo (token_ledger.createdByUserId/reason,
 * user_benefits.grantedByUserId/cancelledByUserId/cancellationReason) — esta
 * tabla NO los duplica, ni debe usarse para registrarlos otra vez. El único
 * hueco real confirmado es el cambio de student_profiles.status
 * (activo/inactivo), que antes de esta fase era un UPDATE sin actor, motivo
 * ni histórico.
 */
import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { studentAdminActions, type StudentAdminAction } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
// Acepta también el handle de una transacción en curso (p.ej.
// studentLifecycleService.ts registrando el borrado de un Student ANTES
// de eliminar sus filas, dentro de la misma transacción — spec STU-01 §31/36).
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface RecordStudentAdminActionInput {
  studentProfileId: number;
  actorUserId: number;
  action: string;
  beforeValue?: string | null;
  afterValue?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordStudentAdminAction(input: RecordStudentAdminActionInput, db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.insert(studentAdminActions).values({
    studentProfileId: input.studentProfileId,
    actorUserId: input.actorUserId,
    action: input.action,
    beforeValue: input.beforeValue ?? null,
    afterValue: input.afterValue ?? null,
    reason: input.reason ?? null,
    metadata: input.metadata ?? null,
  });
}

export async function listAdminActionsByStudentProfileId(studentProfileId: number, limit = 50, db?: AnyDbHandle): Promise<StudentAdminAction[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(studentAdminActions)
    .where(eq(studentAdminActions.studentProfileId, studentProfileId))
    .orderBy(desc(studentAdminActions.createdAt))
    .limit(limit);
}
