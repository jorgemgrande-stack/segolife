/**
 * communityEventConversionService.ts — "Convertir en Event DRAFT" (spec
 * puntos 44-47). Auditado antes de escribir (docs/comunity/event-conversion.md):
 * no existía forma atómica de crear un evento ya "inactive", ni rastro de
 * origen — ambos huecos se cubrieron en drizzle/schema.ts (events.sourceType/
 * sourceId) y server/db/eventsDb.ts (CreateEventInput.status), ver auditoría.
 *
 * Patrón replicado de duplicateTicketType (server/segolife/ticketing/
 * ticketingDb.ts): leer la entidad origen completa, mapear campo a campo a
 * un input explícito (nunca spread ciego), invocar la función de creación
 * ya existente.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { events, communityResponses, communityResponseValues, type SegolifeEvent } from "../../../drizzle/schema";
import { getProposalById, getProposalCommunityIds, setProposalStatus, type AnyDbHandle } from "./communityDb";
import { createEvent, getEventBySlug } from "../../db/eventsDb";
import { isPositiveRespondent } from "./communityIntentService";
import { communityOptions } from "../../../drizzle/schema";
import { createNotification } from "../engagement/notificationService";
import { renderTemplate } from "../engagement/templates";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);
type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class CommunityConversionError extends Error {
  code: "NOT_FOUND" | "ALREADY_CONVERTED" | "MISSING_DATE";
  constructor(code: CommunityConversionError["code"], message: string) {
    super(message);
    this.name = "CommunityConversionError";
    this.code = code;
  }
}

function slugify(text: string): string {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 100) || "evento";
}

async function generateUniqueSlug(base: string, conn: DbHandle): Promise<string> {
  let slug = slugify(base);
  let suffix = 1;
  while (await getEventBySlug(slug, conn)) {
    suffix += 1;
    slug = `${slugify(base)}-${suffix}`;
  }
  return slug;
}

export interface ConvertProposalInput {
  proposalId: number;
  adminUserId: number;
  /** Obligatorio SOLO si la propuesta no tiene starts_at (events.starts_at es NOT NULL, ver auditoría). */
  startsAt?: Date;
  capacity?: number | null;
}

/** Idempotente — si ya está convertida, devuelve el evento existente en vez de duplicar (spec punto 67). */
export async function convertProposalToEventDraft(input: ConvertProposalInput, db?: AnyDbHandle): Promise<SegolifeEvent> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const proposal = await getProposalById(input.proposalId, conn);
  if (!proposal) throw new CommunityConversionError("NOT_FOUND", "Propuesta no encontrada");

  if (proposal.convertedEventId) {
    const [existing] = await conn.select().from(events).where(eq(events.id, proposal.convertedEventId)).limit(1);
    if (existing) return existing;
  }

  const startsAt = proposal.startsAt ?? input.startsAt;
  if (!startsAt) {
    throw new CommunityConversionError("MISSING_DATE", "La propuesta no tiene fecha — indica una fecha de inicio para el evento");
  }

  const communityIds = await getProposalCommunityIds(input.proposalId, conn);
  const slug = await generateUniqueSlug(proposal.title, conn);

  const event = await createEvent({
    name: proposal.title,
    slug,
    description: proposal.description ?? null,
    venueId: proposal.venueId ?? null,
    startsAt,
    endsAt: proposal.endsAt ?? null,
    capacity: input.capacity ?? null,
    imageUrl: proposal.coverImageUrl ?? null,
    status: "inactive", // DRAFT — nunca se publica automáticamente (spec punto 44)
    sourceType: "community_proposal",
    sourceId: proposal.id,
  }, communityIds, conn);

  await setProposalStatus(proposal.id, "converted", { convertedEventId: event.id }, conn);

  return event;
}

/**
 * Notificar a interesados cuando el Event ya está publicado (spec punto 47)
 * — acción EXPLÍCITA del admin (punto 83, "Notify interested"), nunca
 * automática al activar el evento (evita acoplar COMUNITY al ciclo de vida
 * general de Events). "Interesado" = respondente positivo (spec punto 48,
 * ver communityIntentService.isPositiveRespondent).
 */
export async function notifyInterestedRespondents(proposalId: number, db?: AnyDbHandle): Promise<{ notified: number }> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const proposal = await getProposalById(proposalId, conn);
  if (!proposal || !proposal.convertedEventId) return { notified: 0 };
  const [event] = await conn.select().from(events).where(eq(events.id, proposal.convertedEventId)).limit(1);
  if (!event) return { notified: 0 };

  const options = await conn.select().from(communityOptions).where(eq(communityOptions.proposalId, proposalId));
  const responses = await conn.select().from(communityResponses).where(eq(communityResponses.proposalId, proposalId));

  const interestedUserIds: number[] = [];
  for (const response of responses) {
    const values = await conn.select().from(communityResponseValues).where(eq(communityResponseValues.responseId, response.id));
    if (isPositiveRespondent(proposal, values, options)) interestedUserIds.push(response.userId);
  }
  if (interestedUserIds.length === 0) return { notified: 0 };

  const { userCommunities, communities: communitiesTable } = await import("../../../drizzle/schema");
  const { inArray, eq: eqOp } = await import("drizzle-orm");
  const slugRows = await conn.select({ userId: userCommunities.userId, slug: communitiesTable.slug })
    .from(userCommunities).innerJoin(communitiesTable, eqOp(userCommunities.communityId, communitiesTable.id))
    .where(inArray(userCommunities.userId, interestedUserIds));
  const slugByUser = new Map<number, string>();
  for (const row of slugRows) if (!slugByUser.has(row.userId)) slugByUser.set(row.userId, row.slug);

  let notified = 0;
  for (const userId of interestedUserIds) {
    const slug = slugByUser.get(userId);
    if (!slug) continue;
    const rendered = renderTemplate("community_interested_event_published", { eventName: event.name }, `/${slug}/events/${event.slug}`);
    const result = await createNotification({
      userId,
      communityId: null,
      type: "community_interested_event_published",
      category: "events",
      audienceType: "transactional",
      rendered,
      sourceType: "community_proposal",
      sourceId: proposalId,
      idempotencyKey: `community_interested_event_published:${proposalId}:${userId}`,
    }, conn).catch((err: unknown) => {
      console.error(`[communityEventConversionService] No se pudo notificar a userId=${userId}:`, err);
      return null;
    });
    if (result) notified += 1;
  }
  return { notified };
}
