/**
 * communityDb.ts — CRUD núcleo de COMUNITY: propuestas + opciones + alcance
 * de comunidad. Auditado antes de escribir (docs/comunity/architecture.md)
 * — sin infraestructura previa reutilizable, todo nuevo. Mismo patrón de
 * pool/contrato `db?` que el resto del repo (studentsDb.ts, eventsDb.ts...).
 */
import { eq, and, or, inArray, desc, asc, lt, gte, lte, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  communityProposals, communityOptions, communityProposalCommunities,
  communityProposalAudiences, communities, venues, events,
  type CommunityProposal, type InsertCommunityProposal, type CommunityOption,
} from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

export type DbHandle = typeof _db;
export type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
export type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

// ─── ALCANCE DE COMUNIDAD ────────────────────────────────────────────────────

export async function getProposalCommunityIds(proposalId: number, db?: AnyDbHandle): Promise<number[]> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({ communityId: communityProposalCommunities.communityId })
    .from(communityProposalCommunities).where(eq(communityProposalCommunities.proposalId, proposalId));
  return rows.map(r => r.communityId);
}

/** Reemplaza el conjunto completo — idempotente, mismo patrón que setEventCommunities. */
export async function setProposalCommunities(proposalId: number, communityIds: number[], db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.delete(communityProposalCommunities).where(eq(communityProposalCommunities.proposalId, proposalId));
  for (const communityId of communityIds) {
    try {
      await conn.insert(communityProposalCommunities).values({ proposalId, communityId });
    } catch (err) {
      const errno = err && typeof err === "object" && "errno" in err ? (err as { errno?: number }).errno : undefined;
      if (errno !== 1062) throw err;
    }
  }
}

// ─── OPCIONES ────────────────────────────────────────────────────────────────

export async function listProposalOptions(proposalId: number, db?: AnyDbHandle): Promise<CommunityOption[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(communityOptions).where(eq(communityOptions.proposalId, proposalId)).orderBy(asc(communityOptions.sortOrder));
}

/** Reemplaza el conjunto completo de opciones — solo válido mientras la propuesta está en draft (comprobado por el caller/router, no aquí). */
export async function setProposalOptions(proposalId: number, labels: string[], db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.delete(communityOptions).where(eq(communityOptions.proposalId, proposalId));
  let sortOrder = 0;
  for (const label of labels) {
    await conn.insert(communityOptions).values({ proposalId, label, sortOrder: sortOrder++ });
  }
}

// ─── PROPUESTAS — CRUD ───────────────────────────────────────────────────────

export interface CreateProposalInput {
  title: string;
  description?: string | null;
  questionType: CommunityProposal["questionType"];
  urgencyType?: CommunityProposal["urgencyType"];
  startsAt?: Date | null;
  endsAt?: Date | null;
  resultsVisibility?: CommunityProposal["resultsVisibility"];
  allowChangeResponse?: boolean;
  tokenReward?: number | null;
  coverImageUrl?: string | null;
  venueId?: number | null;
  relatedEventId?: number | null;
  sourceStudentProposalId?: number | null;
  audienceDefinition?: Record<string, unknown> | null;
  minSampleSize?: number;
  createdByUserId: number;
  options?: string[];
  communityIds?: number[];
}

export async function createProposal(input: CreateProposalInput, db?: AnyDbHandle): Promise<CommunityProposal> {
  const conn = db ?? (await getDb());
  const { options, communityIds, ...fields } = input;
  const insertResult = await conn.insert(communityProposals).values(fields as InsertCommunityProposal);
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  if (options?.length) await setProposalOptions(insertId, options, conn);
  if (communityIds?.length) await setProposalCommunities(insertId, communityIds, conn);
  const [created] = await conn.select().from(communityProposals).where(eq(communityProposals.id, insertId)).limit(1);
  return created;
}

export interface UpdateProposalFields {
  title?: string;
  description?: string | null;
  urgencyType?: CommunityProposal["urgencyType"];
  startsAt?: Date | null;
  endsAt?: Date | null;
  resultsVisibility?: CommunityProposal["resultsVisibility"];
  allowChangeResponse?: boolean;
  tokenReward?: number | null;
  coverImageUrl?: string | null;
  venueId?: number | null;
  relatedEventId?: number | null;
  audienceDefinition?: Record<string, unknown> | null;
  minSampleSize?: number;
}

export async function updateProposal(id: number, fields: UpdateProposalFields, db?: AnyDbHandle): Promise<CommunityProposal | null> {
  const conn = db ?? (await getDb());
  await conn.update(communityProposals).set(fields).where(eq(communityProposals.id, id));
  const [updated] = await conn.select().from(communityProposals).where(eq(communityProposals.id, id)).limit(1);
  return updated ?? null;
}

export async function setProposalStatus(id: number, status: CommunityProposal["status"], extra: Partial<InsertCommunityProposal> = {}, db?: AnyDbHandle): Promise<CommunityProposal | null> {
  const conn = db ?? (await getDb());
  await conn.update(communityProposals).set({ status, ...extra }).where(eq(communityProposals.id, id));
  const [updated] = await conn.select().from(communityProposals).where(eq(communityProposals.id, id)).limit(1);
  return updated ?? null;
}

export async function getProposalById(id: number, db?: AnyDbHandle): Promise<CommunityProposal | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(communityProposals).where(eq(communityProposals.id, id)).limit(1);
  return row ?? null;
}

export interface ProposalListItem extends CommunityProposal {
  venueName: string | null;
  communities: { id: number; name: string }[];
}

export interface ProposalListFilters {
  /** "all" = sin restricción (ya resuelto por communityAccess.ts). */
  communityIds: number[] | "all";
  status?: CommunityProposal["status"];
  questionType?: CommunityProposal["questionType"];
  venueId?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listProposals(filters: ProposalListFilters, db?: AnyDbHandle): Promise<{ items: ProposalListItem[]; total: number }> {
  const conn = db ?? (await getDb());
  const { notInArray, like } = await import("drizzle-orm");

  const conditions: SQL[] = [];
  if (filters.status) conditions.push(eq(communityProposals.status, filters.status));
  if (filters.questionType) conditions.push(eq(communityProposals.questionType, filters.questionType));
  if (filters.venueId) conditions.push(eq(communityProposals.venueId, filters.venueId));
  if (filters.search) conditions.push(like(communityProposals.title, `%${filters.search}%`));

  if (filters.communityIds !== "all") {
    // Visibilidad = propuestas GLOBALES (sin ninguna fila de scoping) + las
    // explícitamente en mi alcance. Se calcula como "todo EXCEPTO las que
    // tienen scoping pero ninguna fila cae en mi alcance" — mismo criterio
    // de "sin fila = universal" que benefit_communities/campaign_communities.
    const allScopedRows = await conn.select({ proposalId: communityProposalCommunities.proposalId, communityId: communityProposalCommunities.communityId })
      .from(communityProposalCommunities);
    const inAccess = new Set(filters.communityIds);
    const scopedProposalIds = new Set(allScopedRows.map(r => r.proposalId));
    const inScopeProposalIds = new Set(allScopedRows.filter(r => inAccess.has(r.communityId)).map(r => r.proposalId));
    const outOfScopeIds = Array.from(scopedProposalIds).filter(id => !inScopeProposalIds.has(id));
    if (outOfScopeIds.length > 0) conditions.push(notInArray(communityProposals.id, outOfScopeIds));
  }

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const baseQuery = conn.select().from(communityProposals);
  const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(desc(communityProposals.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  const countQuery = conn.select({ id: communityProposals.id }).from(communityProposals);
  const countRows = await (whereClause ? countQuery.where(whereClause) : countQuery);

  const venueIds = Array.from(new Set(rows.map(r => r.venueId).filter((v): v is number => v != null)));
  const venueRows = venueIds.length ? await conn.select({ id: venues.id, name: venues.name }).from(venues).where(inArray(venues.id, venueIds)) : [];
  const venueNameById = new Map(venueRows.map(v => [v.id, v.name]));

  const proposalIds = rows.map(r => r.id);
  const communityRows = proposalIds.length
    ? await conn.select({ proposalId: communityProposalCommunities.proposalId, community: communities })
        .from(communityProposalCommunities)
        .innerJoin(communities, eq(communityProposalCommunities.communityId, communities.id))
        .where(inArray(communityProposalCommunities.proposalId, proposalIds))
    : [];
  const communitiesByProposal = new Map<number, { id: number; name: string }[]>();
  for (const row of communityRows) {
    const list = communitiesByProposal.get(row.proposalId) ?? [];
    list.push({ id: row.community.id, name: row.community.name });
    communitiesByProposal.set(row.proposalId, list);
  }

  const items: ProposalListItem[] = rows.map(r => ({
    ...r,
    venueName: r.venueId != null ? (venueNameById.get(r.venueId) ?? null) : null,
    communities: communitiesByProposal.get(r.id) ?? [],
  }));

  return { items, total: countRows.length };
}

// ─── CIERRE POR VENTANA DE TIEMPO ───────────────────────────────────────────
// Aunque el scheduler esté OFF, las queries públicas SIEMPRE consideran
// starts_at/ends_at (spec punto 70: "nunca aceptar respuesta fuera de
// ventana por confiar solo en la UI").

export function isProposalOpenForResponses(proposal: CommunityProposal, now: Date): boolean {
  if (proposal.status !== "active") return false;
  if (proposal.startsAt && proposal.startsAt.getTime() > now.getTime()) return false;
  if (proposal.endsAt && proposal.endsAt.getTime() < now.getTime()) return false;
  return true;
}

/** Propuestas activas cuya ventana ya venció — para cierre (con scheduler ON) o para query pública que las trata como cerradas aunque status siga "active" en BD. */
export async function listExpiredActiveProposals(now: Date, db?: AnyDbHandle): Promise<CommunityProposal[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(communityProposals)
    .where(and(eq(communityProposals.status, "active"), lt(communityProposals.endsAt, now)));
}

/** Propuestas programadas cuya hora de inicio ya llegó — para activación (con scheduler ON). */
export async function listDueScheduledProposals(now: Date, db?: AnyDbHandle): Promise<CommunityProposal[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(communityProposals)
    .where(and(eq(communityProposals.status, "scheduled"), lte(communityProposals.startsAt, now)));
}
