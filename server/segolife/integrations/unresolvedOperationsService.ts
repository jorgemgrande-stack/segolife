/**
 * unresolvedOperationsService.ts — cola de operaciones (asistencia/comercio/
 * pedido) que llegaron sin resolver a un usuario Segolife (Fase 5, punto
 * 34). Nunca se pierde una operación: queda en `unresolved_operations`
 * hasta que un admin la vincula manualmente o la descarta explícitamente.
 */
import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { unresolvedOperations, type UnresolvedOperation, type InsertUnresolvedOperation } from "../../../drizzle/schema";
import { persistIdentityMapping } from "./identityResolver";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export async function recordUnresolvedOperation(input: Omit<InsertUnresolvedOperation, "id" | "status" | "createdAt" | "linkedUserId" | "linkedByUserId" | "linkedAt">, db?: DbHandle): Promise<UnresolvedOperation> {
  const conn = db ?? (await getDb());
  const [result] = await conn.insert(unresolvedOperations).ignore().values({ ...input, status: "unresolved" });
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(unresolvedOperations).where(eq(unresolvedOperations.id, insertId)).limit(1);
  return row;
}

export async function listUnresolvedOperations(status: "unresolved" | "linked" | "ignored" | "conflict" = "unresolved", db?: DbHandle): Promise<UnresolvedOperation[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(unresolvedOperations).where(eq(unresolvedOperations.status, status)).orderBy(desc(unresolvedOperations.createdAt));
}

export class UnresolvedOperationError extends Error {
  constructor(public code: "NOT_FOUND" | "ALREADY_RESOLVED", message: string) {
    super(message);
    this.name = "UnresolvedOperationError";
  }
}

/** Vincula manualmente una operación a un estudiante — reprocesamiento idempotente vía el pipeline correspondiente (attendancePipeline/commercePipeline), no aquí. */
export async function linkUnresolvedOperation(id: number, userId: number, linkedByUserId: number, db?: DbHandle): Promise<UnresolvedOperation> {
  const conn = db ?? (await getDb());
  const [existing] = await conn.select().from(unresolvedOperations).where(eq(unresolvedOperations.id, id)).limit(1);
  if (!existing) throw new UnresolvedOperationError("NOT_FOUND", "Operación no encontrada");
  if (existing.status !== "unresolved") throw new UnresolvedOperationError("ALREADY_RESOLVED", "Esta operación ya fue resuelta o descartada");

  await conn.update(unresolvedOperations)
    .set({ status: "linked", linkedUserId: userId, linkedByUserId, linkedAt: new Date() })
    .where(eq(unresolvedOperations.id, id));

  if (existing.identityHintEmail || existing.identityHintPhone) {
    await persistIdentityMapping({
      provider: existing.provider,
      externalCustomerId: null,
      participant: { email: existing.identityHintEmail, phone: existing.identityHintPhone, name: existing.identityHintName },
      buyer: null,
      userId,
      method: "manual",
    }, conn);
  }

  const [updated] = await conn.select().from(unresolvedOperations).where(eq(unresolvedOperations.id, id)).limit(1);
  return updated;
}

export async function ignoreUnresolvedOperation(id: number, linkedByUserId: number, db?: DbHandle): Promise<UnresolvedOperation> {
  const conn = db ?? (await getDb());
  const [existing] = await conn.select().from(unresolvedOperations).where(eq(unresolvedOperations.id, id)).limit(1);
  if (!existing) throw new UnresolvedOperationError("NOT_FOUND", "Operación no encontrada");
  if (existing.status !== "unresolved") throw new UnresolvedOperationError("ALREADY_RESOLVED", "Esta operación ya fue resuelta o descartada");

  await conn.update(unresolvedOperations).set({ status: "ignored", linkedByUserId, linkedAt: new Date() }).where(eq(unresolvedOperations.id, id));
  const [updated] = await conn.select().from(unresolvedOperations).where(eq(unresolvedOperations.id, id)).limit(1);
  return updated;
}
