/**
 * eventCatalogSync.ts — sincroniza EVENTS + TICKET TYPES de un proveedor
 * externo (Fourvenues hoy, cualquier ExternalTicketingProvider futuro)
 * hacia el catálogo Segolife (`events`/`event_ticket_types` +
 * `external_entity_mappings`). Parte de "Fourvenues Operational Sync" —
 * SIEMPRE se ejecuta ANTES de ticketPurchasePipeline/attendancePipeline: no
 * se ingiere un pedido/asistencia de un evento sin mapping confirmado (ver
 * integrationSyncService.syncVenueIntegration(), orden EVENTS → RATES →
 * ORDERS/TICKETS → ATTENDANCE).
 *
 * FIELD OWNERSHIP: un evento NUEVO (creado por este sync) queda gobernado
 * por Fourvenues en nombre/fecha/descripción/imagen — es su único origen de
 * verdad. Un evento YA EXISTENTE (mapeado en un sync previo, o adoptado como
 * candidato inequívoco) SOLO recibe actualizaciones de `startsAt`/`endsAt`
 * (vía `updateEvent`, que ya decide si eso merece `event_updated` para el
 * Communication Center) — SEGOLIFE conserva SIEMPRE featured/comunidades/
 * descripción editorial/imagen propia/SEO/Benefits/SegoTokens/Plan&Play:
 * este sync nunca los toca.
 *
 * MATCHING — nunca fuzzy, nunca solo por nombre:
 *  1. external_entity_mappings ya confirmado (provider+externalType="event")
 *     → usar ese evento, sin comparar nada más.
 *  2. sin mapping: buscar eventos internos SIN mapping de este provider, del
 *     mismo venue, mismo día de calendario en Europe/Madrid, con nombre
 *     normalizado EXACTAMENTE igual (nunca substring/similaridad).
 *     - 0 candidatos → se CREA un evento nuevo gobernado por Fourvenues.
 *     - 1 candidato → inequívoco, se ADOPTA (se crea el mapping; su
 *       contenido editorial nunca se sobreescribe).
 *     - ≥2 candidatos → AMBIGUO: no se autovincula ni se crea un duplicado.
 *       Se omite este evento en este sync (ver EventSyncResult.ambiguous)
 *       hasta que un admin lo resuelva a mano.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  events, eventTicketTypes, externalEntityMappings, salesChannels,
  type SegolifeEvent,
} from "../../../drizzle/schema";
import { createEvent, updateEvent, getEventBySlug } from "../../db/eventsDb";
import { resolveMadridMoment } from "../tokens/tokenScheduleService";
import type { NormalizedEvent, NormalizedTicketType } from "./externalTicketingProvider";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(text: string): string {
  return normalizeName(text).replace(/\s+/g, "-").slice(0, 100) || "evento";
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

export interface EventSyncItemResult {
  externalId: string;
  name: string;
  outcome: "mapped_existing" | "candidate_adopted" | "created" | "ambiguous" | "invalid_missing_startsAt";
  eventId: number | null;
}

export interface SyncEventCatalogInput {
  provider: string;
  integrationType: "venue_integration" | "event_integration";
  integrationId: number;
  venueId: number | null;
  communityIds: number[];
  normalizedEvents: NormalizedEvent[];
}

export interface SyncEventCatalogResult {
  items: EventSyncItemResult[];
  createdCount: number;
  updatedCount: number;
  ambiguousCount: number;
  /** Tía Felisa rollout — eventos sin startsAt (proveedor no dio fecha): ZERO SILENT DROP, nunca se inventa una fecha ni se crea/actualiza el evento; queda observable aquí. */
  invalidCount: number;
}

/** Candidatos SIN mapping de este provider, mismo venue, mismo día Europe/Madrid, nombre normalizado exactamente igual. */
async function findUnambiguousCandidate(
  provider: string,
  venueId: number | null,
  normalizedName: string,
  dayKey: string,
  conn: DbHandle
): Promise<SegolifeEvent[]> {
  if (venueId == null) return [];
  const alreadyMapped = await conn.select({ internalId: externalEntityMappings.internalId }).from(externalEntityMappings)
    .where(and(eq(externalEntityMappings.provider, provider), eq(externalEntityMappings.externalType, "event")));
  const mappedIds = new Set(alreadyMapped.map(m => m.internalId));

  const sameVenue = await conn.select().from(events).where(eq(events.venueId, venueId));
  return sameVenue.filter(e =>
    !mappedIds.has(e.id) &&
    normalizeName(e.name) === normalizedName &&
    resolveMadridMoment(e.startsAt).date === dayKey
  );
}

async function upsertFourvenuesSalesChannel(
  eventId: number,
  externalUrl: string,
  provider: string,
  integrationType: "venue_integration" | "event_integration",
  integrationId: number,
  conn: DbHandle
): Promise<void> {
  const [existing] = await conn.select().from(salesChannels)
    .where(and(eq(salesChannels.eventId, eventId), eq(salesChannels.channelType, "fourvenues")))
    .limit(1);
  if (existing) {
    if (existing.externalUrl !== externalUrl) {
      await conn.update(salesChannels).set({ externalUrl }).where(eq(salesChannels.id, existing.id));
    }
    return;
  }
  await conn.insert(salesChannels).values({
    eventId,
    channelType: "fourvenues",
    salesMode: "external_redirect",
    externalUrl,
    integrationType,
    integrationId,
    status: "active",
    isPrimary: false,
    sortOrder: 0,
    metadata: {},
  });
  void provider; // trazabilidad futura — no hay columna provider en sales_channels hoy, integrationType/integrationId ya identifican la integración concreta
}

export async function syncEventCatalog(input: SyncEventCatalogInput, db?: DbHandle): Promise<SyncEventCatalogResult> {
  const conn = db ?? (await getDb());
  const items: EventSyncItemResult[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let ambiguousCount = 0;
  let invalidCount = 0;

  for (const ev of input.normalizedEvents) {
    // Tía Felisa rollout (spec §9) — un evento sin startsAt (el proveedor no
    // dio fecha; campo opcional en el DTO real) NUNCA se crea/actualiza con
    // una fecha inventada — events.starts_at es TIMESTAMP NOT NULL, y
    // new Date(0) ya causó un fallo real de MySQL estricto en otro punto
    // (ver integration_sync_state.updated_since). Si el evento ya estaba
    // mapeado, conserva su fecha anterior intacta (Field ownership: esta
    // sincronización simplemente no puede confirmarla en este run).
    if (ev.startsAt === null) {
      items.push({ externalId: ev.externalId, name: ev.name, outcome: "invalid_missing_startsAt", eventId: null });
      invalidCount++;
      continue;
    }

    const [existingMapping] = await conn.select().from(externalEntityMappings)
      .where(and(eq(externalEntityMappings.provider, input.provider), eq(externalEntityMappings.externalType, "event"), eq(externalEntityMappings.externalId, ev.externalId)))
      .limit(1);

    let eventId: number;
    let outcome: EventSyncItemResult["outcome"];

    if (existingMapping) {
      eventId = existingMapping.internalId;
      // Field ownership: SOLO fecha/hora se sincroniza en un evento ya mapeado — updateEvent() decide si eso dispara event_updated.
      await updateEvent(eventId, { startsAt: ev.startsAt, endsAt: ev.endsAt ?? null }, conn);
      outcome = "mapped_existing";
      updatedCount++;
    } else {
      const normalizedName = normalizeName(ev.name);
      const dayKey = resolveMadridMoment(ev.startsAt).date;
      const candidates = await findUnambiguousCandidate(input.provider, input.venueId, normalizedName, dayKey, conn);

      if (candidates.length > 1) {
        items.push({ externalId: ev.externalId, name: ev.name, outcome: "ambiguous", eventId: null });
        ambiguousCount++;
        continue; // no se autovincula, no se crea duplicado — requiere resolución manual (fuera de alcance de esta fase, sin dashboard)
      } else if (candidates.length === 1) {
        eventId = candidates[0].id;
        await conn.insert(externalEntityMappings).ignore().values({
          provider: input.provider, integrationType: input.integrationType, integrationId: input.integrationId,
          externalType: "event", externalId: ev.externalId, internalType: "event", internalId: eventId,
        });
        outcome = "candidate_adopted";
        updatedCount++;
      } else {
        const slug = await generateUniqueSlug(ev.name, conn);
        const created = await createEvent({
          name: ev.name,
          slug,
          description: ev.description ?? null,
          venueId: input.venueId,
          startsAt: ev.startsAt,
          endsAt: ev.endsAt ?? null,
          imageUrl: ev.imageUrl ?? null,
          sourceType: `integration:${input.provider}`,
          sourceId: input.integrationId,
        }, input.communityIds, conn);
        eventId = created.id;
        await conn.insert(externalEntityMappings).ignore().values({
          provider: input.provider, integrationType: input.integrationType, integrationId: input.integrationId,
          externalType: "event", externalId: ev.externalId, internalType: "event", internalId: eventId,
        });
        outcome = "created";
        createdCount++;
      }
    }

    if (ev.externalUrl) {
      await upsertFourvenuesSalesChannel(eventId, ev.externalUrl, input.provider, input.integrationType, input.integrationId, conn);
    }

    items.push({ externalId: ev.externalId, name: ev.name, outcome, eventId });
  }

  return { items, createdCount, updatedCount, ambiguousCount, invalidCount };
}

export interface SyncTicketTypesInput {
  provider: string;
  integrationType: "venue_integration" | "event_integration";
  integrationId: number;
  eventId: number;
  normalizedTicketTypes: NormalizedTicketType[];
}

export interface SyncTicketTypesResult {
  createdCount: number;
  updatedCount: number;
  ticketTypeIdByExternalId: Map<string, number>;
}

/**
 * Rate types: sin endpoint de estado en Fourvenues (no hay "inactive" real
 * confirmado) — se mantienen siempre "active" mientras sigan llegando en el
 * fetch; una rate que deje de aparecer NO se desactiva automáticamente aquí
 * (evita desactivar por un fallo parcial de red) — desactivación manual vía
 * admin si corresponde.
 */
export async function syncTicketTypes(input: SyncTicketTypesInput, db?: DbHandle): Promise<SyncTicketTypesResult> {
  const conn = db ?? (await getDb());
  let createdCount = 0;
  let updatedCount = 0;
  const ticketTypeIdByExternalId = new Map<string, number>();

  for (const tt of input.normalizedTicketTypes) {
    const [existingMapping] = await conn.select().from(externalEntityMappings)
      .where(and(eq(externalEntityMappings.provider, input.provider), eq(externalEntityMappings.externalType, "ticket_type"), eq(externalEntityMappings.externalId, tt.externalId)))
      .limit(1);

    if (existingMapping) {
      await conn.update(eventTicketTypes).set({
        priceCents: tt.priceCents,
        capacity: tt.capacity ?? null,
        metadata: (tt.raw ?? {}) as Record<string, unknown>,
      }).where(eq(eventTicketTypes.id, existingMapping.internalId));
      ticketTypeIdByExternalId.set(tt.externalId, existingMapping.internalId);
      updatedCount++;
      continue;
    }

    const [insertResult] = await conn.insert(eventTicketTypes).values({
      eventId: input.eventId,
      name: tt.name,
      priceCents: tt.priceCents,
      currency: tt.currency,
      capacity: tt.capacity ?? null,
      salesStart: tt.salesStart ?? null,
      salesEnd: tt.salesEnd ?? null,
      status: "active",
      metadata: (tt.raw ?? {}) as Record<string, unknown>,
    });
    const insertId = (insertResult as unknown as { insertId: number }).insertId;
    await conn.insert(externalEntityMappings).ignore().values({
      provider: input.provider, integrationType: input.integrationType, integrationId: input.integrationId,
      externalType: "ticket_type", externalId: tt.externalId, internalType: "ticket_type", internalId: insertId,
    });
    ticketTypeIdByExternalId.set(tt.externalId, insertId);
    createdCount++;
  }

  return { createdCount, updatedCount, ticketTypeIdByExternalId };
}
