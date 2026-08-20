import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, or, like, not, isNull, inArray, gte, lt, desc, asc, type SQL } from "drizzle-orm";
import {
  events,
  venues,
  communityEvents,
  communities,
  salesChannels,
  eventTicketTypes,
  ticketOrders,
  eventTickets,
  eventAttendance,
  externalEntityMappings,
  type SegolifeEvent,
  type Venue,
  type SalesChannel,
} from "../../drizzle/schema";
import { emitEngagementEvent } from "../segolife/engagement/engagementEvents";
import { isEventPast, sortByStartDescending } from "../../shared/segolife/eventTiming";

/**
 * FIX-04 — prefijo real de events.sourceType para eventos sincronizados
 * desde Fourvenues (ver eventCatalogSync.ts: `integration:${provider}`,
 * provider="fourvenues_integrations"). Constante única para que el filtro
 * SQL (fourvenuesPublicationSafeCondition) y el predicado JS
 * (isEventStudentVisible) nunca diverjan silenciosamente sobre qué eventos
 * están sujetos al concepto de publicación de Fourvenues.
 */
export const FOURVENUES_SOURCE_TYPE_PREFIX = "integration:fourvenues";

/**
 * REGLA FUNDAMENTAL (FIX-04): visibilidad de origen (lo que dice Fourvenues)
 * ≠ visibilidad admin ≠ visibilidad pública del Student. Esta función decide
 * SOLO la tercera.
 *
 * Un evento nativo o de cualquier origen no-Fourvenues (sourceType nulo, o
 * que no empiece por el prefijo de Fourvenues — p.ej. Weezevent, que nunca
 * pasa por eventCatalogSync/syncEventCatalog) NUNCA queda sujeto a
 * sourcePublicationStatus: ese campo solo lo escribe el sync de Fourvenues.
 * Aplicarlo fuera de ese origen ocultaría eventos que nunca tuvieron nada
 * que ver con Fourvenues — una regresión real sobre el catálogo nativo, no
 * algo que pida el spec.
 *
 * Un evento FUTURO/EN CURSO originado en Fourvenues con
 * sourcePublicationStatus "unpublished" o "unknown" (incluye NULL — antes
 * de esta migración, o antes del primer sync tras ella) NUNCA se considera
 * visible — fail closed, nunca se asume "published" por ausencia de dato.
 *
 * PERO ese gate de publicación solo protege discovery/compra futura — nunca
 * se aplica a un evento YA PASADO (bug real descubierto en el primer sync
 * de producción: la sincronización incremental de Fourvenues solo revisita
 * ~180 días atrás, así que un evento de hace casi un año como el 119 NUNCA
 * vuelve a recibir un sourcePublicationStatus confirmado y se queda en NULL
 * para siempre — aplicarle el mismo fail-closed que a un evento futuro lo
 * ocultaría permanentemente de VenueDetail "Past Events"/getEventBySlug,
 * violando "el acceso histórico legítimo nunca se rompe". Una vez pasado,
 * lo único que importa es `status` (el toggle admin-curado, siempre
 * respetado) — el estado de publicación de origen deja de ser una cuestión
 * de seguridad.
 *
 * FIX-06 — `isHidden` (visibilidad LOCAL de Segolife, ver comentario de
 * schema.ts) es un cuarto AND, nunca una alternativa: VISIBILIDAD FINAL =
 * status activo AND (no-Fourvenues O publicado-en-origen-o-pasado) AND
 * no-oculto. Nunca "no-oculto O publicado" — mostrar ocultar un evento
 * jamás puede "rescatar" un evento que ya era inválido por otro motivo, ni
 * al revés. `isHidden` se aplica SIEMPRE (futuro y pasado por igual) — a
 * diferencia del gate de publicación de Fourvenues, ocultar es una decisión
 * editorial explícita del Admin, no depende de si el evento ya ocurrió.
 */
export function isEventStudentVisible(
  event: {
    status: SegolifeEvent["status"];
    sourceType?: string | null;
    sourcePublicationStatus?: SegolifeEvent["sourcePublicationStatus"];
    isHidden: boolean;
    startsAt: Date | string;
    endsAt?: Date | string | null;
  },
  now: Date = new Date()
): boolean {
  if (event.status !== "active") return false;
  if (event.isHidden) return false;
  const isFourvenuesSourced = typeof event.sourceType === "string" && event.sourceType.startsWith(FOURVENUES_SOURCE_TYPE_PREFIX);
  if (isFourvenuesSourced && event.sourcePublicationStatus !== "published" && !isEventPast(event, now)) return false;
  return true;
}

/**
 * Variante SQL de la mitad "origen Fourvenues" de isEventStudentVisible()
 * (nunca la comprobación de `status`, que listEvents ya filtra por
 * separado) para listEvents({ studentSafe: true }) — a propósito SIN la
 * excepción temporal de la versión JS (no distingue pasado/futuro): solo la
 * usan listActiveEvents/listFeaturedEvents/listUpcomingEvents, que YA
 * excluyen los eventos pasados por su cuenta (isEventPast / fromDate), así
 * que un evento pasado con sourcePublicationStatus sin confirmar nunca
 * llega a depender de esta condición para ser correcto. listEventsByVenue
 * (que sí necesita conservar el histórico) usa la versión JS temporal-aware
 * en su lugar — nunca esta.
 */
function fourvenuesPublicationSafeCondition(): SQL {
  const notFourvenuesSourced = or(isNull(events.sourceType), not(like(events.sourceType, `${FOURVENUES_SOURCE_TYPE_PREFIX}%`)))!;
  return or(notFourvenuesSourced, eq(events.sourcePublicationStatus, "published"))!;
}

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
  /** FIX-06 — límite superior EXCLUSIVO (starts_at < toDate). Construir con madridDateRangeToUtcBounds (shared/segolife/eventTiming.ts), nunca un Date crudo del día "hasta" tal cual. */
  toDate?: Date;
  /** "startsAt" (por defecto, cronológico) o "homeSortOrder" (orden curado a mano en /admin/cms/inicio). */
  orderBy?: "startsAt" | "homeSortOrder";
  /** FIX-04 — superficies PÚBLICAS únicamente: aplica fourvenuesPublicationSafeCondition además de cualquier filtro `status` ya pasado. Nunca usado por el Admin (que debe seguir viendo borradores Fourvenues, solo etiquetados). */
  studentSafe?: boolean;
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
  if (filters.toDate) conditions.push(lt(events.startsAt, filters.toDate));
  if (filters.studentSafe) {
    conditions.push(fourvenuesPublicationSafeCondition());
    // FIX-06 — mismo criterio que el gate de publicación de Fourvenues justo
    // arriba: los callers studentSafe (listActiveEvents/listFeaturedEvents/
    // listUpcomingEvents) nunca aplican isEventStudentVisible en JS después,
    // así que el filtro de isHidden tiene que vivir aquí, a nivel SQL, para
    // esos casos. listEventsByVenue/listEndedEvents (sin studentSafe) quedan
    // cubiertos por el propio isEventStudentVisible que ya aplican en JS.
    conditions.push(eq(events.isHidden, false));
  }
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
  /** Ver events.sourcePublicationStatus — solo relevante para eventos de un proveedor con concepto real de publicación (hoy Fourvenues, ver eventCatalogSync.ts). El resto de callers lo deja sin especificar (columna queda NULL = "unknown"). */
  sourcePublicationStatus?: SegolifeEvent["sourcePublicationStatus"];
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
  /**
   * FIX-04 — antes solo se podían fijar en createEvent(); faltaban aquí
   * porque nada necesitaba escribirlos en un evento YA existente. Ahora
   * eventCatalogSync.ts los necesita en el camino "candidate_adopted" (un
   * evento nativo pre-existente que se vincula a un evento real de
   * Fourvenues): sin esto, ese evento adoptado nunca quedaba con origen
   * Fourvenues registrado, y por tanto isEventStudentVisible() nunca podía
   * aplicarle el filtro de publicación (gap real, no cosmético).
   */
  sourceType?: string | null;
  sourceId?: number | null;
  /** Ver events.sourcePublicationStatus. Solo el sync de Fourvenues lo pasa (eventCatalogSync.ts) — nunca dispara `event_updated` (no es un cambio material de cara al Communication Center, spec FIX-04 §31). */
  sourcePublicationStatus?: SegolifeEvent["sourcePublicationStatus"];
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

/**
 * FIX-06 — toggle puro, mismo patrón EXACTO que setEventFeatured: nunca
 * toca `status` ni `sourcePublicationStatus` (dimensiones distintas, ver
 * comentario de schema.ts/isEventStudentVisible). Nunca dispara
 * event_updated/event_cancelled — ocultar no es un cambio material de
 * fecha/venue ni una cancelación, es una decisión de visibilidad editorial.
 */
export async function setEventHidden(id: number, hidden: boolean, db?: DbHandle): Promise<SegolifeEvent | null> {
  const conn = db ?? (await getDb());
  await conn.update(events).set({ isHidden: hidden }).where(eq(events.id, id));
  const [updated] = await conn.select().from(events).where(eq(events.id, id)).limit(1);
  return updated ?? null;
}

/**
 * FIX-06 — borrado bloqueado por cualquier huella real (spec §11/§12/§13):
 * ningún FK real conecta nada a `events.id` en este esquema (auditado antes
 * de escribir esto — cero `.references(` hacia events.id en todo
 * schema.ts), así que MySQL permitiría un DELETE físico aunque existieran
 * miles de filas dependientes, dejándolas huérfanas para siempre. Política
 * conservadora: si existe CUALQUIER huella de comercio/asistencia/
 * integración externa, el borrado se bloquea con un motivo legible — el
 * único borrado físico permitido es el de un evento manual sin ninguna
 * actividad real (categoría A del spec). Idempotente: borrar un id que ya
 * no existe es un no-op silencioso, nunca un error.
 */
export class EventDeleteBlockedError extends Error {
  constructor(public reasons: string[]) {
    super(`No se puede eliminar este evento: ${reasons.join(", ")}. Puedes ocultarlo en su lugar.`);
    this.name = "EventDeleteBlockedError";
  }
}

export async function deleteEvent(id: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  const [event] = await conn.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) return; // ya no existe — idempotente, nunca un error

  const reasons: string[] = [];
  if (typeof event.sourceType === "string" && event.sourceType.startsWith(FOURVENUES_SOURCE_TYPE_PREFIX)) {
    reasons.push("proviene de una sincronización externa (Fourvenues)");
  }
  const [mapping] = await conn.select({ id: externalEntityMappings.id }).from(externalEntityMappings)
    .where(and(eq(externalEntityMappings.internalType, "event"), eq(externalEntityMappings.internalId, id))).limit(1);
  if (mapping) reasons.push("tiene una integración externa vinculada");
  const [salesChannelRow] = await conn.select({ id: salesChannels.id }).from(salesChannels).where(eq(salesChannels.eventId, id)).limit(1);
  if (salesChannelRow) reasons.push("tiene canales de venta configurados");
  const [ticketTypeRow] = await conn.select({ id: eventTicketTypes.id }).from(eventTicketTypes).where(eq(eventTicketTypes.eventId, id)).limit(1);
  if (ticketTypeRow) reasons.push("tiene tipos de entrada configurados");
  const [orderRow] = await conn.select({ id: ticketOrders.id }).from(ticketOrders).where(eq(ticketOrders.eventId, id)).limit(1);
  if (orderRow) reasons.push("tiene pedidos reales");
  const [ticketRow] = await conn.select({ id: eventTickets.id }).from(eventTickets).where(eq(eventTickets.eventId, id)).limit(1);
  if (ticketRow) reasons.push("tiene entradas emitidas");
  const [attendanceRow] = await conn.select({ id: eventAttendance.id }).from(eventAttendance).where(eq(eventAttendance.eventId, id)).limit(1);
  if (attendanceRow) reasons.push("tiene asistencia registrada");

  if (reasons.length > 0) throw new EventDeleteBlockedError(reasons);

  // Sin ninguna huella real — seguro borrar físicamente. community_events
  // primero (M2M, sin riesgo — solo vincula, nunca guarda actividad propia).
  await conn.delete(communityEvents).where(eq(communityEvents.eventId, id));
  await conn.delete(events).where(eq(events.id, id));
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

/**
 * FIX-04 — superficie de discovery futuro: además del filtro de seguridad
 * de publicación (studentSafe, SQL), un evento ya finalizado nunca se
 * ofrece aquí como "activo"/comprable (CASO A del spec — event 119).
 * Filtro temporal en JS (reutiliza isEventPast, shared/segolife/
 * eventTiming.ts — nunca un cálculo de fecha nuevo), no en SQL: el acceso
 * histórico legítimo (VenueDetail "Past Events" vía listEventsByVenue,
 * tickets/actividad vía getEventBySlug) pasa por funciones que NUNCA
 * aplican esta exclusión temporal, solo la de seguridad de publicación.
 */
export async function listActiveEvents(communityId?: number, db?: DbHandle): Promise<EventListItem[]> {
  const conn = db ?? (await getDb());
  const { items } = await listEvents(
    { communityIds: communityId ? [communityId] : "all", status: "active", studentSafe: true, limit: 200, offset: 0 },
    conn
  );
  return items.filter(e => !isEventPast(e));
}

export async function listFeaturedEvents(communityId?: number, db?: DbHandle): Promise<EventListItem[]> {
  const conn = db ?? (await getDb());
  const { items } = await listEvents(
    { communityIds: communityId ? [communityId] : "all", status: "active", isFeatured: true, studentSafe: true, orderBy: "homeSortOrder", limit: 50, offset: 0 },
    conn
  );
  return items.filter(e => !isEventPast(e));
}

/** Reordena los eventos destacados de la Home — mismo patrón que reorderGalleryItems (index → homeSortOrder). */
export async function reorderFeaturedEvents(orderedIds: number[], db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await Promise.all(
    orderedIds.map((id, index) => conn.update(events).set({ homeSortOrder: index }).where(eq(events.id, id)))
  );
}

/**
 * FIX-04 — filtro de seguridad de publicación aplicado en JS (nunca SQL
 * `studentSafe`, a propósito: isEventStudentVisible ya excluye el gate de
 * publicación para eventos pasados — ver su comentario — así que un evento
 * histórico de Fourvenues sin sourcePublicationStatus confirmado, como el
 * 119, sigue siendo accesible aquí). Sin exclusión temporal aparte:
 * VenueDetail.tsx ya separa esta misma lista en Upcoming/Past
 * (splitUpcomingPast) — un borrador FUTURO de Fourvenues nunca debe llegar
 * aquí, pero un evento histórico legítimo sí (acceso vía la sección
 * "Past Events" ya existente).
 */
export async function listEventsByVenue(venueId: number, db?: DbHandle): Promise<EventListItem[]> {
  const conn = db ?? (await getDb());
  const { items } = await listEvents({ communityIds: "all", venueId, status: "active", limit: 200, offset: 0 }, conn);
  return items.filter(e => isEventStudentVisible(e));
}

/**
 * FIX-05A — "Ended Events": eventos ya finalizados, Student-visible,
 * ordenados del más reciente al más antiguo. Sirve TANTO a Explore
 * (communityId, sin venueId) como a VenueDetail (communityId + venueId) —
 * una sola función, nunca dos casi-duplicadas.
 *
 * Mismo criterio que listEventsByVenue (isEventStudentVisible, temporal-
 * aware — el gate de publicación de Fourvenues está exento para eventos
 * pasados) MÁS un filtro adicional de isEventPast, porque a diferencia de
 * listEventsByVenue esta función SOLO quiere los ya finalizados. Nunca usa
 * `studentSafe` a nivel SQL (no temporal-aware): la mayoría del histórico
 * real tiene sourcePublicationStatus=NULL (nunca confirmado, fuera de toda
 * ventana de sync) y studentSafe lo bloquearía igual que a un borrador
 * futuro real — vaciaría por error casi todo el histórico legítimo.
 *
 * A diferencia de listEventsByVenue (communityIds="all" fijo, sin cambiar
 * ese comportamiento pre-existente de Upcoming), esta función SÍ aplica el
 * filtro de comunidad cuando se recibe communityId — Ended Events es una
 * superficie nueva, sin comportamiento previo que preservar, y el spec
 * exige explícitamente el scoping por comunidad aquí.
 *
 * Límite de página fijo con margen (200, mismo criterio que
 * listEventsByVenue) para absorber pérdidas por el filtro en JS sin
 * paginación SQL real — el volumen real (~150-200 eventos históricos
 * totales hoy) lo hace seguro; nunca "cargar todo sin límite".
 */
export async function listEndedEvents(
  filters: { communityId?: number; venueId?: number; limit?: number },
  db?: DbHandle
): Promise<EventListItem[]> {
  const conn = db ?? (await getDb());
  const { items } = await listEvents({
    communityIds: filters.communityId ? [filters.communityId] : "all",
    venueId: filters.venueId,
    status: "active",
    limit: 200,
    offset: 0,
  }, conn);
  const ended = items.filter(e => isEventStudentVisible(e) && isEventPast(e));
  return sortByStartDescending(ended).slice(0, filters.limit ?? 20);
}

// ─── MG-01 — "Upcoming" (Home, pestaña Próximos) ───────────────────────────
// Ventana primaria: próximos UPCOMING_WINDOW_DAYS días. Si no hay ningún
// evento en esa ventana, se muestran los siguientes eventos futuros
// disponibles aunque caigan más allá — nunca un vacío artificial solo por
// estar a más de 20 días (spec MG-01 §4). UPCOMING_EVENTS_LIMIT es el mismo
// tipo de límite razonable que ya usa listFeaturedEvents/publicActive para
// no cargar "cientos de eventos" — una fila horizontal de cards, igual que
// Tonight/Featured.
export const UPCOMING_WINDOW_DAYS = 20;
export const UPCOMING_EVENTS_LIMIT = 10;

/**
 * Pura — decide, sobre una lista YA ordenada cronológicamente de eventos
 * futuros (startsAt >= at), si se queda con los que caen dentro de la
 * ventana de UPCOMING_WINDOW_DAYS o si hace fallback a la lista completa
 * recibida (los siguientes eventos futuros disponibles, sin importar lo
 * lejos que estén). El límite de cuántos eventos se piden ya se aplicó
 * antes, en la query — esta función nunca amplía la lista, solo decide
 * cuál de los dos subconjuntos devolver.
 */
export function selectUpcomingWindow(events: EventListItem[], at: Date, windowDays: number = UPCOMING_WINDOW_DAYS): EventListItem[] {
  if (events.length === 0) return events;
  const windowEnd = new Date(at.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const withinWindow = events.filter(e => new Date(e.startsAt).getTime() <= windowEnd.getTime());
  return withinWindow.length > 0 ? withinWindow : events;
}

/**
 * Eventos futuros más próximos para la pestaña "Upcoming" de la Home — ver
 * selectUpcomingWindow para el algoritmo de ventana + fallback.
 *
 * FIX-04 — studentSafe se aplica ANTES del fallback de ventana: un borrador
 * de Fourvenues nunca debe ser "rescatado" por selectUpcomingWindow solo
 * porque no hubiera otros eventos publicados dentro de los 20 días (spec
 * §24 — el fallback nunca debe rescatar drafts).
 */
export async function listUpcomingEvents(communityIds: number[] | "all", at: Date, db?: DbHandle): Promise<EventListItem[]> {
  const conn = db ?? (await getDb());
  const { items } = await listEvents(
    { communityIds, status: "active", studentSafe: true, fromDate: at, orderBy: "startsAt", limit: UPCOMING_EVENTS_LIMIT, offset: 0 },
    conn
  );
  return selectUpcomingWindow(items, at);
}
