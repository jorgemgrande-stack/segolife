/**
 * communityStudentProposalDb.ts — ideas de estudiantes (spec puntos 31-35),
 * apoyos y moderación admin. Lifecycle propio, distinto de
 * community_proposals (ver comentario de schema).
 */
import { eq, and, desc, sql, inArray, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  communityStudentProposals, communitySupports, users,
  type CommunityStudentProposal, type InsertCommunityStudentProposal, type CommunitySupport,
} from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);
type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
export type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

const MAX_TITLE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 2000;

function sanitizeText(raw: string, maxLength: number): string {
  return raw.replace(/<[^>]*>/g, "").trim().slice(0, maxLength);
}

export interface SubmitStudentProposalInput {
  studentUserId: number;
  communityId: number;
  title: string;
  description?: string | null;
  venueId?: number | null;
  suggestedDate?: string | null; // YYYY-MM-DD
  category?: string | null;
}

export async function submitStudentProposal(input: SubmitStudentProposalInput, db?: AnyDbHandle): Promise<CommunityStudentProposal> {
  const conn = db ?? (await getDb());
  const title = sanitizeText(input.title, MAX_TITLE_LENGTH);
  if (!title) throw new Error("El título no puede estar vacío");
  const values: InsertCommunityStudentProposal = {
    studentUserId: input.studentUserId,
    communityId: input.communityId,
    title,
    description: input.description ? sanitizeText(input.description, MAX_DESCRIPTION_LENGTH) : null,
    venueId: input.venueId ?? null,
    suggestedDate: input.suggestedDate ?? null,
    category: input.category ?? null,
    status: "pending_moderation",
  };
  const insertResult = await (conn as DbHandle).insert(communityStudentProposals).values(values);
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await (conn as DbHandle).select().from(communityStudentProposals).where(eq(communityStudentProposals.id, insertId)).limit(1);
  return created;
}

export async function getStudentProposalById(id: number, db?: AnyDbHandle): Promise<CommunityStudentProposal | null> {
  const conn = db ?? (await getDb());
  const [row] = await (conn as DbHandle).select().from(communityStudentProposals).where(eq(communityStudentProposals.id, id)).limit(1);
  return row ?? null;
}

export interface StudentProposalListItem extends CommunityStudentProposal {
  studentName: string | null;
  supportCount: number;
}

export interface StudentProposalListFilters {
  communityIds: number[] | "all";
  status?: CommunityStudentProposal["status"];
  studentUserId?: number;
  limit?: number;
  offset?: number;
}

/** Conteo de apoyos SIEMPRE en vivo (COUNT real) — nunca un contador denormalizado (ver comentario de schema, community_supports). */
export async function listStudentProposals(filters: StudentProposalListFilters, db?: AnyDbHandle): Promise<{ items: StudentProposalListItem[]; total: number }> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const conditions: SQL[] = [];
  if (filters.status) conditions.push(eq(communityStudentProposals.status, filters.status));
  if (filters.studentUserId) conditions.push(eq(communityStudentProposals.studentUserId, filters.studentUserId));
  if (filters.communityIds !== "all") conditions.push(inArray(communityStudentProposals.communityId, filters.communityIds));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const baseQuery = conn.select({ proposal: communityStudentProposals, studentName: users.name })
    .from(communityStudentProposals)
    .leftJoin(users, eq(communityStudentProposals.studentUserId, users.id));
  const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(desc(communityStudentProposals.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  const countQuery = conn.select({ id: communityStudentProposals.id }).from(communityStudentProposals);
  const countRows = await (whereClause ? countQuery.where(whereClause) : countQuery);

  const proposalIds = rows.map(r => r.proposal.id);
  const supportRows = proposalIds.length
    ? await conn.select({ studentProposalId: communitySupports.studentProposalId, count: sql<number>`COUNT(*)` })
        .from(communitySupports).where(inArray(communitySupports.studentProposalId, proposalIds)).groupBy(communitySupports.studentProposalId)
    : [];
  const supportCountById = new Map(supportRows.map(r => [r.studentProposalId, Number(r.count)]));

  const items: StudentProposalListItem[] = rows.map(r => ({
    ...r.proposal,
    studentName: r.studentName,
    supportCount: supportCountById.get(r.proposal.id) ?? 0,
  }));

  return { items, total: countRows.length };
}

// ─── MODERACIÓN ──────────────────────────────────────────────────────────────

export async function approveStudentProposal(id: number, moderatedByUserId: number, db?: AnyDbHandle): Promise<CommunityStudentProposal | null> {
  const conn = db ?? (await getDb());
  await (conn as DbHandle).update(communityStudentProposals)
    .set({ status: "approved", moderatedByUserId, moderatedAt: new Date() })
    .where(eq(communityStudentProposals.id, id));
  return getStudentProposalById(id, conn);
}

export async function rejectStudentProposal(
  id: number,
  moderatedByUserId: number,
  reasonInternal: string,
  reasonStudent?: string | null,
  db?: AnyDbHandle
): Promise<CommunityStudentProposal | null> {
  if (!reasonInternal.trim()) throw new Error("El motivo interno de rechazo es obligatorio");
  const conn = db ?? (await getDb());
  await (conn as DbHandle).update(communityStudentProposals)
    .set({ status: "rejected", moderatedByUserId, moderatedAt: new Date(), rejectionReasonInternal: reasonInternal, rejectionReasonStudent: reasonStudent ?? null })
    .where(eq(communityStudentProposals.id, id));
  return getStudentProposalById(id, conn);
}

export async function markStudentProposalConverted(id: number, convertedProposalId: number, db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await (conn as DbHandle).update(communityStudentProposals)
    .set({ status: "converted", convertedProposalId })
    .where(eq(communityStudentProposals.id, id));
}

// ─── APOYOS ──────────────────────────────────────────────────────────────────

export class CommunitySupportError extends Error {
  code = "ALREADY_SUPPORTED" as const;
  constructor(message: string) { super(message); this.name = "CommunitySupportError"; }
}

export async function supportStudentProposal(studentProposalId: number, userId: number, db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  try {
    await (conn as DbHandle).insert(communitySupports).values({ studentProposalId, userId });
  } catch (err) {
    const errno = err && typeof err === "object" && "errno" in err ? (err as { errno?: number }).errno : undefined;
    if (errno === 1062) return; // idempotente — un apoyo por persona (spec punto 34)
    throw err;
  }
}

export async function unsupportStudentProposal(studentProposalId: number, userId: number, db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await (conn as DbHandle).delete(communitySupports).where(and(eq(communitySupports.studentProposalId, studentProposalId), eq(communitySupports.userId, userId)));
}

export async function hasUserSupported(studentProposalId: number, userId: number, db?: AnyDbHandle): Promise<boolean> {
  const conn = db ?? (await getDb());
  const [row] = await (conn as DbHandle).select({ id: communitySupports.id }).from(communitySupports)
    .where(and(eq(communitySupports.studentProposalId, studentProposalId), eq(communitySupports.userId, userId))).limit(1);
  return !!row;
}

export async function getSupportCount(studentProposalId: number, db?: AnyDbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const [row] = await (conn as DbHandle).select({ count: sql<number>`COUNT(*)` }).from(communitySupports)
    .where(eq(communitySupports.studentProposalId, studentProposalId));
  return Number(row?.count ?? 0);
}

// ─── HISTORIAL POR ESTUDIANTE (Student 360 Activity Aggregator, spec 79) ────

export interface UserSupportHistoryItem {
  support: CommunitySupport;
  proposalTitle: string;
}

/** Apoyos emitidos por el estudiante, con el título de la idea ya resuelto. */
export async function listSupportsByUserId(userId: number, limit: number, db?: AnyDbHandle): Promise<UserSupportHistoryItem[]> {
  const conn = (db ?? (await getDb())) as DbHandle;
  return conn.select({ support: communitySupports, proposalTitle: communityStudentProposals.title })
    .from(communitySupports)
    .innerJoin(communityStudentProposals, eq(communitySupports.studentProposalId, communityStudentProposals.id))
    .where(eq(communitySupports.userId, userId))
    .orderBy(desc(communitySupports.createdAt))
    .limit(limit);
}

/** Ideas propuestas por el estudiante (todos los estados, no solo aprobadas — el propio estudiante siempre puede ver su historial). */
export async function listStudentProposalsByUserId(userId: number, limit: number, db?: AnyDbHandle): Promise<CommunityStudentProposal[]> {
  const conn = (db ?? (await getDb())) as DbHandle;
  return conn.select().from(communityStudentProposals)
    .where(eq(communityStudentProposals.studentUserId, userId))
    .orderBy(desc(communityStudentProposals.createdAt))
    .limit(limit);
}

// ─── TRENDING ────────────────────────────────────────────────────────────────
// Spec punto 35: "no hardcodear solo número absoluto... puede considerar
// support count, support velocity, audience size — empezar simple." Empieza
// simple de verdad: apoyos en las últimas 24h, no una fórmula compuesta.

export interface TrendingStudentProposal extends StudentProposalListItem {
  supportsLast24h: number;
}

export async function listTrendingStudentProposals(communityIds: number[] | "all", limit = 10, db?: AnyDbHandle): Promise<TrendingStudentProposal[]> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { gte } = await import("drizzle-orm");

  const { items } = await listStudentProposals({ communityIds, status: "pending_moderation", limit: 200 }, conn);
  if (items.length === 0) return [];

  const ids = items.map(i => i.id);
  const recentRows = await conn.select({ studentProposalId: communitySupports.studentProposalId, count: sql<number>`COUNT(*)` })
    .from(communitySupports)
    .where(and(inArray(communitySupports.studentProposalId, ids), gte(communitySupports.createdAt, since)))
    .groupBy(communitySupports.studentProposalId);
  const recentById = new Map(recentRows.map(r => [r.studentProposalId, Number(r.count)]));

  return items
    .map(item => ({ ...item, supportsLast24h: recentById.get(item.id) ?? 0 }))
    .filter(item => item.supportsLast24h > 0)
    .sort((a, b) => b.supportsLast24h - a.supportsLast24h)
    .slice(0, limit);
}
