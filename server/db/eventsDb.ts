import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, or, like, inArray, gte, desc, asc, type SQL } from "drizzle-orm";
import {
  events,
  venues,
  communityEvents,
  communities,
  salesChannels,
  type SegolifeEvent,
  type Venue,
  type SalesChannel,
} from "../../drizzle/schema";
import { emitEngagementEvent } from "../segolife/engagement/engagementEvents";

// Pool persistente top-level — mismo patrón que server/db/studentsDb.ts / venuesDb.ts.
const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface EventCommunitySummary {
  id: number;
  name: string;
  slug: string;
}

export interface EventPrimarySalesChannel {
  channelType: SalesChannel["channelType"];
  salesMode: SalesChannel["salesMode"];
}

export interface EventListItem extends SegolifeEvent {
  venue: Venue | null;
  communities: EventCommunitySummary[];
  /** Canal de venta activo con prioridad (isPrimary, si no el de menor sortOrder) — mismo criterio que computePurchaseAction. null = sin canal configurado. */
  primarySalesChannel: EventPrimarySalesChannel | null;
}

export interface EventListFilters {
  /** "all" = sin restricción de comunidad (ya resuelto por communityAccess.ts). */
  communityIds: number[] | "all";
  search?: string;
  venueId?: number;
  status?: "active" | "inactive";
  isFeatured?: boolean;
  /** Solo eventos cuyo starts_at sea >= esta fecha (próximos). */
  fromDate?: Date;
  /** "startsAt" (por defecto, cronológico) o "homeSortOrder" (orden curado a mano en /admin/cms/inicio). */
  orderBy?: "startsAt" | "homeSortOrder";
  limit?: number;
  offset?: number;
}

/** eventIds vinculados a alguna de las comunidades dadas (sin duplicados). */
async function getEventIdsInCommunities(communityIds: number[], db: DbHandle): Promise<number[]> {
  if (communityIds.length === 0) return [];
  const rows = await db
    .select({ eventId: communityEvents.eventId })
    .from(communityEvents)
    .where(inArray(communityEvents.communityId, communityIds));
  return Array.from(new Set(rows.map(r => r.eventId)));
}

/** Comunidades de cada evento, agrupadas en memoria — mismo patrón que venuesDb.getCommunitiesByVenueId. */
async function getCommunitiesByEventId(eventIds: number[], db: DbHandle): Promise<Map<number, EventCommunitySummary[]>> {
  const map = new Map<number, EventCommunitySummary[]>();
  if (eventIds.length === 0) return map;
  const rows = await db
    .select({ eventId: communityEvents.eventId, community: communities })
    .from(communityEvents)
    .innerJoin(communities, eq(communityEvents.communityId, communities.id))
    .where(inArray(communityEvents.eventId, eventIds));
  for (const row of rows) {
    const list = map.get(row.eventId) ?? [];
    list.push({ id: row.community.id, name: row.community.name, slug: row.community.slug });
    map.set(row.eventId, list);
  }
  return map;
}

/** Canal de venta primario de cada evento — mismo criterio de selección que computePurchaseAction (isPrimary, si no el de menor sortOrder, entre los activos). */
async function getPrimarySalesChannelByEventId(eventIds: number[], db: DbHandle): Promise<Map<number, EventPrimarySalesChannel>> {
  const map = new Map<number, EventPrimarySalesChannel>();
  if (eventIds.length === 0) return map;
  const rows = await db
    .select({
      eventId: salesChannels.eventId,
      channelType: salesChannels.channelType,
      salesMode: salesChannels.salesMode,
      isPrimary: salesChannels.isPrimary,
      sortOrder: salesChannels.sortOrder,
    })
    .from(salesChannels)
    .where(and(inArray(salesChannels.eventId, eventIds), eq(salesChannels.status, "active")));

  const byEvent = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = byEvent.get(row.eventId) ?? [];
    list.push(row);
    byEvent.set(row.eventId, list);
  }
  byEvent.forEach((channels, eventId) => {
    channels.sort((a, b) => a.sortOrder - b.sortOrder);
    const primary = channels.find(c => c.isPrimary) ?? channels[0];
    map.set(eventId, { channelType: primary.channelType, salesMode: primary.salesMode });
  });
  return map;
}

/**
 * Lista eventos con filtro EFECTIVO por comunidad (communityIds ya debe venir
 * resuelto por communityAccess.resolveCommunityFilter — esta función no
 * vuelve a comprobar autorización, solo aplica el filtro que le llega).
 */
export async function listEvents(
  filters: EventListFilters,
  db?: DbHandle
): Promise<{ items: EventListItem[]; total: number }> {
  const conn = db ?? (await getDb());

  let restrictToEventIds: number[] | null = null;
  if (filters.communityIds !== "all") {
    restrictToEventIds = await getEventIdsInCommunities(filters.communityIds, conn);
    if (restrictToEventIds.length === 0) return { items: [], total: 0 };
  }

  const conditions: SQL[] = [];
  if (restrictToEventIds) conditions.push(inArray(events.id, restrictToEventIds));
  if (filters.venueId) conditions.push(eq(events.venueId, filters.venueId));
  if (filters.status) conditions.push(eq(events.status, filters.status));
  if (filters.isFeatured !== undefined) conditions.push(eq(events.isFeatured, filters.isFeatured));
  if (filters.fromDate) conditions.push(gte(events.startsAt, filters.fromDate));
  if (filters.search) {
    const q = `%${filters.search}%`;
    conditions.push(or(like(events.name, q), like(events.description, q))!);
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const baseQuery = conn
    .select({ event: events, venue: venues })
    .from(events)
    .leftJoin(venues, eq(events.venueId, venues.id));

  const orderClauses = filters.orderBy === "homeSortOrder"
    ? [asc(events.homeSortOrder), asc(events.startsAt)]
    : [asc(events.startsAt)];

  const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(...orderClauses)
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  const countQuery = conn.select({ event: events }).from(events);
  const countRows = await (whereClause ? countQuery.where(whereClause) : countQuery);
  const total = countRows.length;

  const eventIds = rows.map(r => r.event.id);
  const [communitiesByEvent, salesChannelByEvent] = await Promise.all([
    getCommunitiesByEventId(eventIds, conn),
    getPrimarySalesChannelByEventId(eventIds, conn),
  ]);

  const items: EventListItem[] = rows.map(r => ({
    ...r.event,
    venue: r.venue,
    communities: communitiesByEvent.get(r.event.id) ?? [],
    primarySalesChannel: salesChannelByEvent.get(r.event.id) ?? null,
  }));

  return { items, total };
}

export interface EventDetail {
  event: SegolifeEvent;
  venue: Venue | null;
  communities: EventCommunitySummary[];
}

async function buildEventDetail(event: SegolifeEvent, conn: DbHandle): Promise<EventDetail> {
  const [[venue], communitiesByEvent] = await Promise.all([
    event.venueId
      ? conn.select().from(venues).where(eq(venues.id, event.venueId)).limit(1)
      : Promise.resolve([null]),
    getCommunitiesByEventId([event.id], conn),
  ]);
  return {
    event,
    venue: venue ?? null,
    communities: communitiesByEvent.get(event.id) ?? [],
  };
}

export async function getEventById(id: number, db?: DbHandle): Promise<EventDetail | null> {
  const conn = db ?? (await getDb());
  const [event] = await conn.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) return null;
  return buildEventDetail(event, conn);
}

/** Público — usado por getBySlug (sin autenticación, sin scoping de comunidad). */
export async function getEventBySlug(slug: string, db?: DbHandle): Promise<EventDetail | null> {
  const conn = db ?? (await getDb());
  const [event] = await conn.select().from(events).where(eq(events.slug, slug)).limit(1);
  if (!event) return null;
  return buildEventDetail(event, conn);
}

export interface CreateEventInput {
  name: string;
  slug: string;
  description?: string | null;
  venueId?: number | null;
  startsAt: Date;
  endsAt?: Date | null;
  capacity?: number | null;
  imageUrl?: string | null;
  /**
   * Opcional — antes no existía ningún camino para crear un evento ya
   * "inactive" (borrador) en la misma operación de alta, solo en dos pasos
   * no atómicos (create + setActive). Añadido para COMUNITY (docs/comunity/
   * event-conversion.md, "Convertir en Event DRAFT sin publicar"). Por
   * defecto sigue siendo "active" (comportamiento previo intacto).
   */
  status?: "active" | "inactive";
  /** Origen del evento (p.ej. "community_proposal") — ver events.sourceType/sourceId. */
  sourceType?: string | null;
  sourceId?: number | null;
}

/** communityIds: comunidades a las que se vincula el evento al crearlo (puede ser []). */
export async function createEvent(
  input: CreateEventInput,
  communityIds: number[],
  db?: DbHandle
): Promise<SegolifeEvent> {
  const conn = db ?? (await getDb());
  const insertResult = await conn.insert(events).values(input);
  const insertId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
  await setEventCommunities(insertId, communityIds, conn);
  const [created] = await conn.select().from(events).where(eq(events.id, insertId)).limit(1);
  return created;
}

export interface UpdateEventFields {
  name?: string;
  slug?: string;
  description?: string | null;
  venueId?: number | null;
  startsAt?: Date;
  endsAt?: Date | null;
  capacity?: number | null;
  imageUrl?: string | null;
}

/**
 * Communication Center: dispara `event_updated` SOLO si cambia un campo
 * material (fecha/hora/venue) — nunca por editar descripción/nombre/imagen
 * (spec: "no enviar email por editar una coma"). No existía ningún trigger
 * aquí antes (confirmado por auditoría).
 */
export async function updateEvent(id: number, fields: UpdateEventFields, db?: DbHandle): Promise<SegolifeEvent | null> {
  const conn = db ?? (await getDb());
  const [before] = await conn.select().from(events).where(eq(events.id, id)).limit(1);

  await conn.update(events).set(fields).where(eq(events.id, id));
  const [updated] = await conn.select().from(events).where(eq(events.id, id)).limit(1);
  if (!updated) return null;

  if (before) {
    const changedFields: Array<"startsAt" | "endsAt" | "venueId"> = [];
    if (fields.startsAt !== undefined && fields.startsAt.getTime() !== before.startsAt.getTime()) changedFields.push("startsAt");
    if (fields.endsAt !== undefined && (fields.endsAt?.getTime() ?? null) !== (before.endsAt?.getTime() ?? null)) changedFields.push("endsAt");
    if (fields.venueId !== undefined && fields.venueId !== before.venueId) changedFields.push("venueId");
    if (changedFields.length > 0 && updated.status === "active") {
      emitEngagementEvent("event_updated", { eventId: id, changedFields });
    }
  }

  return updated;
}

/** Communication Center: active→inactive de un evento YA activo se trata como cancelación real (no hay un estado "cancelled" propio hoy — ver auditoría). Nunca dispara al revés (reactivar) ni si ya estaba inactive. */
export async function setEventActive(id: number, active: boolean, db?: DbHandle): Promise<SegolifeEvent | null> {
  const conn = db ?? (await getDb());
  const [before] = await conn.select().from(events).where(eq(events.id, id)).limit(1);

  await conn.update(events).set({ status: active ? "active" : "inactive" }).where(eq(events.id, id));
  const [updated] = await conn.select().from(events).where(eq(events.id, id)).limit(1);

  if (before?.status === "active" && !active) {
    emitEngagementEvent("event_cancelled", { eventId: id });
  }

  return updated ?? null;
}

export async function setEventFeatured(id: number, featured: boolean, db?: DbHandle): Promise<SegolifeEvent | null> {
  const conn = db ?? (await getDb());
  await conn.update(events).set({ isFeatured: featured }).where(eq(events.id, id));
  const [updated] = await conn.select().from(events).where(eq(events.id, id)).limit(1);
  return updated ?? null;
}

/** Reemplaza el conjunto completo de comunidades vinculadas a un evento (idempotente). */
export async function setEventCommunities(id: number, communityIds: number[], db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.delete(communityEvents).where(eq(communityEvents.eventId, id));
  for (const communityId of communityIds) {
    try {
      await conn.insert(communityEvents).values({ communityId, eventId: id });
    } catch (err) {
      const errno = err && typeof err === "object" && "errno" in err ? (err as { errno?: number }).errno : undefined;
      if (errno !== 1062) throw err;
    }
  }
}

// ─── PÚBLICO ────────────────────────────────────────────────────────────────
// Sin autenticación — solo eventos activos, opcionalmente filtrados por una
// única comunidad (uso real: bloque de /ie y /uva).

export async function listActiveEvents(communityId?: number, db?: DbHandle): Promise<EventListItem[]> {
  const conn = db ?? (await getDb());
  const { items } = await listEvents(
    { communityIds: communityId ? [communityId] : "all", status: "active", limit: 200, offset: 0 },
    conn
  );
  return items;
}

export async function listFeaturedEvents(communityId?: number, db?: DbHandle): Promise<EventListItem[]> {
  const conn = db ?? (await getDb());
  const { items } = await listEvents(
    { communityIds: communityId ? [communityId] : "all", status: "active", isFeatured: true, orderBy: "homeSortOrder", limit: 50, offset: 0 },
    conn
  );
  return items;
}

/** Reordena los eventos destacados de la Home — mismo patrón que reorderGalleryItems (index → homeSortOrder). */
export async function reorderFeaturedEvents(orderedIds: number[], db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await Promise.all(
    orderedIds.map((id, index) => conn.update(events).set({ homeSortOrder: index }).where(eq(events.id, id)))
  );
}

export async function listEventsByVenue(venueId: number, db?: DbHandle): Promise<EventListItem[]> {
  const conn = db ?? (await getDb());
  const { items } = await listEvents({ communityIds: "all", venueId, status: "active", limit: 200, offset: 0 }, conn);
  return items;
}
