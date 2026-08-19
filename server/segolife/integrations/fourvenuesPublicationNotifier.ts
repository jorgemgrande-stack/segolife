/**
 * fourvenuesPublicationNotifier.ts — FIX-05. Convierte una transición REAL
 * de sourcePublicationStatus (ver eventCatalogSync.ts::EventPublicationTransition)
 * en una notificación operacional Admin, reutilizando la infraestructura de
 * Engagement Core YA existente (createNotification()/ENGAGEMENT_TEMPLATES) —
 * NUNCA un sistema paralelo. Primer caso real de este repo de un job/
 * scheduler (no una acción de usuario) llamando a createNotification()
 * directamente.
 *
 * FLOOD PROTECTION (spec §30): classifyPublicationNotification() nunca
 * notifica un evento ya pasado — la primera reconciliación/import masivo
 * tras el deploy de FIX-05 puede tocar cientos de eventos históricos
 * (sourcePublicationStatus pasando de NULL a un valor real), pero ninguno
 * de esos son "eventos futuros relevantes recién descubiertos como
 * published" — solo importa el cruce del límite "published" en un evento
 * futuro/en curso.
 *
 * IDEMPOTENCIA: delega en `notifications.idempotencyKey` (UNIQUE real, ver
 * notificationService.ts) — nunca una tabla/columna nueva. La clave incluye
 * eventId + dirección de la transición; mismo criterio ya establecido en
 * este código base (p.ej. event_updated:${eventId}:${orderId}:${fields})
 * — una repetición EXACTA de la misma transición para el mismo evento
 * nunca duplica.
 *
 * BEST-EFFORT: un fallo al notificar NUNCA debe romper el catalog sync real
 * — se registra y se continúa, mismo criterio que la reversión de rewards
 * en ticketCancellationService.ts.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { users } from "../../../drizzle/schema";
import { createNotification } from "../engagement/notificationService";
import { renderTemplate } from "../engagement/templates";
import { isEventPast, type EventTimingInput } from "../../../shared/segolife/eventTiming";
import type { EventPublicationTransition } from "./eventCatalogSync";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type PublicationNotificationKind = "published" | "unpublished";

/**
 * Pura — decide SI una transición amerita notificar (spec §22-28): solo
 * cruces reales del límite "published" (unpublished/unknown/nunca-visto →
 * published, o published → cualquier otra cosa), solo para eventos
 * futuros/en curso — NUNCA histórico (spec §30). Cualquier otra
 * combinación (unpublished↔unknown, published→published, unknown→unknown)
 * nunca notifica.
 */
export function classifyPublicationNotification(
  transition: Pick<EventPublicationTransition, "from" | "to"> & EventTimingInput,
  now: Date = new Date()
): PublicationNotificationKind | null {
  if (isEventPast(transition, now)) return null;
  const wasPublished = transition.from === "published";
  const isPublished = transition.to === "published";
  if (!wasPublished && isPublished) return "published";
  if (wasPublished && !isPublished) return "unpublished";
  return null;
}

async function listAdminRecipients(conn: DbHandle): Promise<Array<{ id: number }>> {
  // Spec §29 — Admin solamente, nunca venue_admin salvo decisión explícita
  // futura ("si hay duda: Admin solamente"). isActive=true — nunca notificar
  // a una cuenta admin desactivada.
  return conn.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.isActive, true)));
}

export interface NotifyPublicationTransitionInput {
  transition: EventPublicationTransition;
  eventName: string;
  venueName: string | null;
}

/** Nunca lanza — ver comentario de cabecera (best-effort). */
export async function notifyPublicationTransition(input: NotifyPublicationTransitionInput, db?: DbHandle): Promise<void> {
  const kind = classifyPublicationNotification(input.transition);
  if (!kind) return;

  const conn = db ?? (await getDb());
  try {
    const admins = await listAdminRecipients(conn);
    if (admins.length === 0) return; // sin admins activos — nada que hacer, nunca un error

    const dateLabel = new Date(input.transition.startsAt).toLocaleString("es-ES", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid",
    });
    const templateKey = kind === "published" ? "fourvenues_event_published" : "fourvenues_event_unpublished";
    const rendered = renderTemplate(
      templateKey,
      { venueName: input.venueName ?? "—", eventName: input.eventName, dateLabel },
      `/admin/events/${input.transition.eventId}`
    );
    const idempotencyKey = `${templateKey}:${input.transition.eventId}:${input.transition.from ?? "null"}->${input.transition.to ?? "null"}`;

    for (const admin of admins) {
      await createNotification({
        userId: admin.id,
        communityId: null,
        type: templateKey,
        category: "events",
        audienceType: "transactional",
        rendered,
        templateKey,
        templateVersion: 1,
        sourceType: "integration:fourvenues_integrations",
        sourceId: input.transition.eventId,
        idempotencyKey: `${idempotencyKey}:${admin.id}`,
      }, conn);
    }
  } catch (err) {
    console.error(`[FourvenuesPublicationNotifier] fallo al notificar eventId=${input.transition.eventId}:`, err instanceof Error ? err.message : err);
  }
}
