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

/** Reemplaza el conjunto completo de opciones — solo seguro mientras no existan respuestas todavía (comprobado por el caller/router, no aquí), porque community_response_values.optionId referencia estas filas y no hay FK con cascade. */
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

/**
 * Nombre real del venue de una propuesta — mismo join ya usado por
 * listProposals() más abajo (venueName en ProposalListItem), nunca antes
 * expuesto al lado Student (getPublicById/myActive en community.ts): la
 * ubicación de una propuesta no se mostraba nunca al estudiante, hallazgo
 * real reportado con captura 2026-08-22.
 */
export async function getVenueName(venueId: number | null, db?: AnyDbHandle): Promise<string | null> {
  if (venueId == null) return null;
  const conn = db ?? (await getDb());
  const [row] = await conn.select({ name: venues.name }).from(venues).where(eq(venues.id, venueId)).limit(1);
  return row?.name ?? null;
}

/**
 * ¿Puede userId ver esta propuesta por pertenencia de COMUNIDAD? (COM-02
 * §18: "Un Student solo puede ver/comentar propuestas permitidas para su
 * comunidad" — un IDOR real ya se corrigió con este MISMO criterio en
 * submitProposal/trending, ver community.ts — nunca confiar solo en que el
 * cliente no muestre el botón). DISTINTO de isInProposalAudience (más abajo):
 * esa exige haber sido parte del snapshot de audiencia en el momento de
 * publicar (para el avatar-stack de respondientes); esta exige solo
 * pertenecer a la MISMA comunidad de la propuesta (para comentarios/likes,
 * spec COM-02) — sin filas en community_proposal_communities = propuesta
 * global, visible para cualquier Student autenticado (mismo criterio que
 * assertProposalAccessible, lado admin).
 */
export async function isProposalVisibleToUser(proposalId: number, userId: number, db?: AnyDbHandle): Promise<boolean> {
  const conn = db ?? (await getDb());
  const communityIds = await getProposalCommunityIds(proposalId, conn);
  if (communityIds.length === 0) return true;
  const { userCommunities } = await import("../../../drizzle/schema");
  const memberships = await conn.select({ communityId: userCommunities.communityId }).from(userCommunities).where(eq(userCommunities.userId, userId));
  const myCommunityIds = new Set(memberships.map(m => m.communityId));
  return communityIds.some(id => myCommunityIds.has(id));
}

/**
 * ¿Pertenece userId a la audiencia snapshoteada de esta propuesta? — mismo
 * criterio de autorización que ya usa myActive() en community.ts, extraído
 * aquí para que getRespondents (petición del cliente, "quién respondió",
 * 2026-08-22) y su ruta de foto dedicada lo reutilicen sin duplicar la query.
 */
export async function isInProposalAudience(proposalId: number, userId: number, db?: AnyDbHandle): Promise<boolean> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select({ id: communityProposalAudiences.id }).from(communityProposalAudiences)
    .where(and(eq(communityProposalAudiences.proposalId, proposalId), eq(communityProposalAudiences.userId, userId))).limit(1);
  return !!row;
}

/**
 * F65 (ciclo de vida automático) — el snapshot de audiencia ya fijado al
 * publicar (communityAudienceService.ts::publishProposal, ANTES de saber si
 * activa ya o queda scheduled). Cuando el scheduler activa una "scheduled"
 * cuyo startsAt ya llegó, reutiliza EXACTAMENTE este mismo snapshot — nunca
 * vuelve a llamar a resolveAudience() (violaría "quién podía responder queda
 * fijado en el momento de publicar", ver cabecera de communityAudienceService.ts).
 */
export async function getProposalAudienceUserIds(proposalId: number, db?: AnyDbHandle): Promise<number[]> {
  const conn = db ?? (await getDb());
  const rows = await conn.select({ userId: communityProposalAudiences.userId }).from(communityProposalAudiences)
    .where(eq(communityProposalAudiences.proposalId, proposalId));
  return rows.map(r => r.userId);
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

/**
 * F64 (Community FLASH 2.0) — orden del feed de "activas" del Student:
 * FLASH siempre por delante de scheduled; dentro de cada grupo, la que
 * antes cierra va primero (más urgente arriba). Sin endsAt, al final de su
 * grupo (nunca puede "vencer" antes que una con fecha de cierre real). Pura
 * y exportada aparte (en vez de inline en community.ts::myActive) para
 * poder testearla sin depender del import() dinámico de BD de ese resolver.
 */
export function sortActiveProposalsForFeed<T extends Pick<CommunityProposal, "urgencyType" | "endsAt">>(proposals: T[]): T[] {
  return [...proposals].sort((a, b) => {
    const aFlash = a.urgencyType === "flash" ? 0 : 1;
    const bFlash = b.urgencyType === "flash" ? 0 : 1;
    if (aFlash !== bFlash) return aFlash - bFlash;
    const aEnds = a.endsAt ? new Date(a.endsAt).getTime() : Infinity;
    const bEnds = b.endsAt ? new Date(b.endsAt).getTime() : Infinity;
    return aEnds - bEnds;
  });
}

/**
 * Política ÚNICA de "¿puede este Student ver los resultados/respondientes de
 * esta propuesta?" — antes solo vivía inline dentro de getPublicById
 * (community.ts); extraída aquí para que getRespondents (lista de quién
 * respondió, spec del cliente 2026-08-22) use EXACTAMENTE el mismo criterio,
 * nunca una segunda copia que pueda divergir.
 */
export function computeResultsVisible(proposal: CommunityProposal, hasResponded: boolean, now: Date): boolean {
  return (
    proposal.resultsVisibility === "immediate" ||
    (proposal.resultsVisibility === "after_vote" && hasResponded) ||
    (proposal.resultsVisibility === "after_close" && (proposal.status === "closed" || (proposal.endsAt != null && proposal.endsAt.getTime() < now.getTime())))
  );
}

/**
 * COM-02B — Política ÚNICA de "¿puede userId acceder a la capa social
 * (ficha SocialProposalView, comentarios, like) de esta propuesta?": está
 * finalizada (siempre), O está activa y este Student YA respondió (nunca
 * antes de participar — evita que se salte la votación por endpoint, y
 * evita que la conversación/resultado condicione su voto). NUNCA confundir
 * con isProposalOpenForResponses (eso es sobre poder VOTAR, dimensión
 * independiente — spec COM-02B §3: "ya votó" != "la votación terminó").
 *
 * Pura — recibe `hasResponded` ya resuelto por el caller desde la fuente
 * canónica real (community_responses, vía getUserResponse/
 * isProposalRespondent) para que getPublicById, assertCanInteract y
 * listComments usen EXACTAMENTE el mismo criterio sin repetirlo (spec §14).
 */
export function canAccessSocialLayer(status: CommunityProposal["status"], hasResponded: boolean): boolean {
  return status === "closed" || (status === "active" && hasResponded);
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

/** Cuenta (sin traer las filas) — mismo criterio que community.myActive: propuestas en la audiencia del Student, activas y dentro de ventana. Usado por la Home para priorizar el nudge de Community sin duplicar la query completa. */
export async function countActiveProposalsForUser(userId: number, db?: AnyDbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const audienceRows = await conn.select({ proposalId: communityProposalAudiences.proposalId })
    .from(communityProposalAudiences).where(eq(communityProposalAudiences.userId, userId));
  const proposalIds = audienceRows.map(r => r.proposalId);
  if (proposalIds.length === 0) return 0;
  const now = new Date();
  const rows = await conn.select().from(communityProposals)
    .where(and(inArray(communityProposals.id, proposalIds), eq(communityProposals.status, "active")));
  return rows.filter(p => isProposalOpenForResponses(p, now)).length;
}
