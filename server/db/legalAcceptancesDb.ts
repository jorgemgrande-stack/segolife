/**
 * legalAcceptancesDb.ts — trazabilidad de aceptación de documentos legales
 * (SEGOLIFE — FASE LEGAL). Una fila = "este usuario aceptó/leyó esta versión
 * exacta de este documento en este instante". Nunca se sobrescribe ni se
 * borra una fila — el estado vigente es la más reciente por (userId,
 * documentType), ver `getLatestLegalAcceptances`.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { legalAcceptances } from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type AnyDbHandle = DbHandle | Parameters<Parameters<DbHandle["transaction"]>[0]>[0];

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type LegalDocumentType = "terms" | "privacy";

export interface RecordLegalAcceptanceInput {
  userId: number;
  documentType: LegalDocumentType;
  documentVersion: string;
}

/** Inserta una fila de aceptación — nunca upsert, cada aceptación real queda registrada aparte. */
export async function recordLegalAcceptance(input: RecordLegalAcceptanceInput, db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.insert(legalAcceptances).values({
    userId: input.userId,
    documentType: input.documentType,
    documentVersion: input.documentVersion,
  });
}

/**
 * Última aceptación registrada por tipo de documento para un usuario — mapa
 * `documentType -> {version, acceptedAt}`. Un documento ausente del mapa
 * significa que el usuario nunca aceptó ninguna versión (p. ej. cuentas
 * creadas antes de esta fase, spec punto 24 — nunca se asume aceptación).
 */
export async function getLatestLegalAcceptances(userId: number, db?: AnyDbHandle): Promise<Map<string, { version: string; acceptedAt: Date }>> {
  const conn = db ?? (await getDb());
  const rows = await conn
    .select({ documentType: legalAcceptances.documentType, documentVersion: legalAcceptances.documentVersion, acceptedAt: legalAcceptances.acceptedAt })
    .from(legalAcceptances)
    .where(eq(legalAcceptances.userId, userId))
    .orderBy(desc(legalAcceptances.acceptedAt));

  const latest = new Map<string, { version: string; acceptedAt: Date }>();
  for (const row of rows) {
    if (!latest.has(row.documentType)) {
      latest.set(row.documentType, { version: row.documentVersion, acceptedAt: row.acceptedAt });
    }
  }
  return latest;
}

/** Variante batch — usada por auditorías/backfills, nunca en el hot path de una request. */
export async function getLatestLegalAcceptancesBatch(userIds: number[], db?: AnyDbHandle): Promise<Map<number, Map<string, { version: string; acceptedAt: Date }>>> {
  const result = new Map<number, Map<string, { version: string; acceptedAt: Date }>>();
  if (userIds.length === 0) return result;
  const conn = db ?? (await getDb());
  const rows = await conn
    .select({ userId: legalAcceptances.userId, documentType: legalAcceptances.documentType, documentVersion: legalAcceptances.documentVersion, acceptedAt: legalAcceptances.acceptedAt })
    .from(legalAcceptances)
    .where(and(inArray(legalAcceptances.userId, userIds)))
    .orderBy(desc(legalAcceptances.acceptedAt));

  for (const row of rows) {
    const perUser = result.get(row.userId) ?? new Map<string, { version: string; acceptedAt: Date }>();
    if (!perUser.has(row.documentType)) {
      perUser.set(row.documentType, { version: row.documentVersion, acceptedAt: row.acceptedAt });
    }
    result.set(row.userId, perUser);
  }
  return result;
}
