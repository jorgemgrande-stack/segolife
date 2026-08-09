import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, or, like, inArray, desc, type SQL } from "drizzle-orm";
import {
  venues,
  venueCategories,
  communityVenues,
  communities,
  type Venue,
  type VenueCategory,
} from "../../drizzle/schema";

// Pool persistente top-level — mismo patrón que server/db/studentsDb.ts.
const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface VenueCommunitySummary {
  id: number;
  name: string;
  slug: string;
}

export interface VenueListItem extends Venue {
  category: VenueCategory | null;
  communities: VenueCommunitySummary[];
}

export interface VenueListFilters {
  /** "all" = sin restricción de comunidad (ya resuelto por communityAccess.ts). */
  communityIds: number[] | "all";
  search?: string;
  categoryId?: number;
  status?: "active" | "inactive";
  isFeatured?: boolean;
  limit?: number;
  offset?: number;
}

/** venueIds vinculados a alguna de las comunidades dadas (sin duplicados). */
async function getVenueIdsInCommunities(communityIds: number[], db: DbHandle): Promise<number[]> {
  if (communityIds.length === 0) return [];
  const rows = await db
    .select({ venueId: communityVenues.venueId })
    .from(communityVenues)
    .where(inArray(communityVenues.communityId, communityIds));
  return Array.from(new Set(rows.map(r => r.venueId)));
}

/** Comunidades de cada venue, agrupadas en memoria — mismo patrón que studentsDb.getCommunitiesByUserId. */
async function getCommunitiesByVenueId(venueIds: number[], db: DbHandle): Promise<Map<number, VenueCommunitySummary[]>> {
  const map = new Map<number, VenueCommunitySummary[]>();
  if (venueIds.length === 0) return map;
  const rows = await db
    .select({ venueId: communityVenues.venueId, community: communities })
    .from(communityVenues)
    .innerJoin(communities, eq(communityVenues.communityId, communities.id))
    .where(inArray(communityVenues.venueId, venueIds));
  for (const row of rows) {
    const list = map.get(row.venueId) ?? [];
    list.push({ id: row.community.id, name: row.community.name, slug: row.community.slug });
    map.set(row.venueId, list);
  }
  return map;
}

/**
 * Lista venues con filtro EFECTIVO por comunidad (communityIds ya debe venir
 * resuelto por communityAccess.resolveCommunityFilter — esta función no
 * vuelve a comprobar autorización, solo aplica el filtro que le llega).
 */
export async function listVenues(
  filters: VenueListFilters,
  db?: DbHandle
): Promise<{ items: VenueListItem[]; total: number }> {
  const conn = db ?? (await getDb());

  let restrictToVenueIds: number[] | null = null;
  if (filters.communityIds !== "all") {
    restrictToVenueIds = await getVenueIdsInCommunities(filters.communityIds, conn);
    if (restrictToVenueIds.length === 0) return { items: [], total: 0 };
  }

  const conditions: SQL[] = [];
  if (restrictToVenueIds) conditions.push(inArray(venues.id, restrictToVenueIds));
  if (filters.categoryId) conditions.push(eq(venues.categoryId, filters.categoryId));
  if (filters.status) conditions.push(eq(venues.status, filters.status));
  if (filters.isFeatured !== undefined) conditions.push(eq(venues.isFeatured, filters.isFeatured));
  if (filters.search) {
    const q = `%${filters.search}%`;
    conditions.push(or(like(venues.name, q), like(venues.description, q))!);
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const baseQuery = conn
    .select({ venue: venues, category: venueCategories })
    .from(venues)
    .leftJoin(venueCategories, eq(venues.categoryId, venueCategories.id));

  const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(desc(venues.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  const countQuery = conn.select({ venue: venues }).from(venues);
  const countRows = await (whereClause ? countQuery.where(whereClause) : countQuery);
  const total = countRows.length;

  const venueIds = rows.map(r => r.venue.id);
  const communitiesByVenue = await getCommunitiesByVenueId(venueIds, conn);

  const items: VenueListItem[] = rows.map(r => ({
    ...r.venue,
    category: r.category,
    communities: communitiesByVenue.get(r.venue.id) ?? [],
  }));

  return { items, total };
}

export interface VenueDetail {
  venue: Venue;
  category: VenueCategory | null;
  communities: VenueCommunitySummary[];
}

async function buildVenueDetail(venue: Venue, conn: DbHandle): Promise<VenueDetail> {
  const [[category], communitiesByVenue] = await Promise.all([
    venue.categoryId
      ? conn.select().from(venueCategories).where(eq(venueCategories.id, venue.categoryId)).limit(1)
      : Promise.resolve([null]),
    getCommunitiesByVenueId([venue.id], conn),
  ]);
  return {
    venue,
    category: category ?? null,
    communities: communitiesByVenue.get(venue.id) ?? [],
  };
}

export async function getVenueById(id: number, db?: DbHandle): Promise<VenueDetail | null> {
  const conn = db ?? (await getDb());
  const [venue] = await conn.select().from(venues).where(eq(venues.id, id)).limit(1);
  if (!venue) return null;
  return buildVenueDetail(venue, conn);
}

/** Público — usado por getBySlug (sin autenticación, sin scoping de comunidad). */
export async function getVenueBySlug(slug: string, db?: DbHandle): Promise<VenueDetail | null> {
  const conn = db ?? (await getDb());
  const [venue] = await conn.select().from(venues).where(eq(venues.slug, slug)).limit(1);
  if (!venue) return null;
  return buildVenueDetail(venue, conn);
}

export interface CreateVenueInput {
  name: string;
  slug: string;
  description?: string | null;
  categoryId?: number | null;
  address?: string | null;
  city?: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  imageUrl?: string | null;
}

/** communityIds: comunidades a las que se vincula el venue al crearlo (puede ser []). */
export async function createVenue(
  input: CreateVenueInput,
  communityIds: number[],
  db?: DbHandle
): Promise<Venue> {
  const conn = db ?? (await getDb());
  const insertResult = await conn.insert(venues).values(input);
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  await setVenueCommunities(insertId, communityIds, conn);
  const [created] = await conn.select().from(venues).where(eq(venues.id, insertId)).limit(1);
  return created;
}

export interface UpdateVenueFields {
  name?: string;
  slug?: string;
  description?: string | null;
  categoryId?: number | null;
  address?: string | null;
  city?: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  imageUrl?: string | null;
}

export async function updateVenue(id: number, fields: UpdateVenueFields, db?: DbHandle): Promise<Venue | null> {
  const conn = db ?? (await getDb());
  await conn.update(venues).set(fields).where(eq(venues.id, id));
  const [updated] = await conn.select().from(venues).where(eq(venues.id, id)).limit(1);
  return updated ?? null;
}

export async function setVenueActive(id: number, active: boolean, db?: DbHandle): Promise<Venue | null> {
  const conn = db ?? (await getDb());
  await conn.update(venues).set({ status: active ? "active" : "inactive" }).where(eq(venues.id, id));
  const [updated] = await conn.select().from(venues).where(eq(venues.id, id)).limit(1);
  return updated ?? null;
}

export async function setVenueFeatured(id: number, featured: boolean, db?: DbHandle): Promise<Venue | null> {
  const conn = db ?? (await getDb());
  await conn.update(venues).set({ isFeatured: featured }).where(eq(venues.id, id));
  const [updated] = await conn.select().from(venues).where(eq(venues.id, id)).limit(1);
  return updated ?? null;
}

/** Reemplaza el conjunto completo de comunidades vinculadas a un venue (idempotente). */
export async function setVenueCommunities(id: number, communityIds: number[], db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.delete(communityVenues).where(eq(communityVenues.venueId, id));
  for (const communityId of communityIds) {
    try {
      await conn.insert(communityVenues).values({ communityId, venueId: id });
    } catch (err) {
      const errno = err && typeof err === "object" && "errno" in err ? (err as { errno?: number }).errno : undefined;
      if (errno !== 1062) throw err;
    }
  }
}

// ─── CATEGORÍAS ─────────────────────────────────────────────────────────────
// Catálogo configurable — nunca hardcodeado (ver drizzle/schema.ts).

export async function listVenueCategories(db?: DbHandle): Promise<VenueCategory[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(venueCategories).orderBy(venueCategories.name);
}

export async function createVenueCategory(name: string, slug: string, db?: DbHandle): Promise<VenueCategory> {
  const conn = db ?? (await getDb());
  const insertResult = await conn.insert(venueCategories).values({ name, slug });
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  const [created] = await conn.select().from(venueCategories).where(eq(venueCategories.id, insertId)).limit(1);
  return created;
}

// ─── PÚBLICO ────────────────────────────────────────────────────────────────
// Sin autenticación — solo venues activos, opcionalmente filtrados por una
// única comunidad (uso real: bloque de /ie y /uva).

export async function listActiveVenues(communityId?: number, db?: DbHandle): Promise<VenueListItem[]> {
  const conn = db ?? (await getDb());
  const { items } = await listVenues(
    { communityIds: communityId ? [communityId] : "all", status: "active", limit: 200, offset: 0 },
    conn
  );
  return items;
}

export async function listFeaturedVenues(communityId?: number, db?: DbHandle): Promise<VenueListItem[]> {
  const conn = db ?? (await getDb());
  const { items } = await listVenues(
    { communityIds: communityId ? [communityId] : "all", status: "active", isFeatured: true, limit: 50, offset: 0 },
    conn
  );
  return items;
}
