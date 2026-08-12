/**
 * eventLifecycleListener.ts — Communication Center. event_updated/
 * event_cancelled no existían en el catálogo ni tenían ningún trigger
 * (confirmado por auditoría) — eventsDb.ts ahora los emite solo ante un
 * cambio material (ver comentarios ahí). A diferencia del resto de
 * listeners, este es FAN-OUT: notifica a cada comprador con un pedido
 * pagado para el evento, no a un único destinatario.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { engagementEvents, type EventUpdatedPayload, type EventCancelledPayload } from "./engagementEvents";
import { events, ticketOrders, userCommunities } from "../../../drizzle/schema";
import { createNotification } from "./notificationService";
import { renderTemplate } from "./templates";
import { resolveAdditionalChannels } from "./communicationChannelMatrix";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

async function ticketHolders(eventId: number) {
  return _db.select({ userId: ticketOrders.userId, email: ticketOrders.buyerEmail, orderId: ticketOrders.id })
    .from(ticketOrders)
    .where(and(eq(ticketOrders.eventId, eventId), eq(ticketOrders.status, "paid")));
}

async function resolveCommunityIdFor(userId: number): Promise<number | null> {
  const [membership] = await _db.select({ communityId: userCommunities.communityId })
    .from(userCommunities).where(eq(userCommunities.userId, userId)).limit(1);
  return membership?.communityId ?? null;
}

const CHANGE_LABELS: Record<"startsAt" | "endsAt" | "venueId", { en: string; es: string }> = {
  startsAt: { en: "The date/time has changed.", es: "La fecha/hora ha cambiado." },
  endsAt: { en: "The end time has changed.", es: "La hora de finalización ha cambiado." },
  venueId: { en: "The venue has changed.", es: "El venue ha cambiado." },
};

export async function handleEventUpdatedForEngagement(payload: EventUpdatedPayload): Promise<void> {
  const [event] = await _db.select().from(events).where(eq(events.id, payload.eventId)).limit(1);
  if (!event) return;

  const changeEn = payload.changedFields.map(f => CHANGE_LABELS[f].en).join(" ");
  const changeEs = payload.changedFields.map(f => CHANGE_LABELS[f].es).join(" ");

  for (const holder of await ticketHolders(payload.eventId)) {
    if (!holder.userId) continue;
    const communityId = await resolveCommunityIdFor(holder.userId);
    const rendered = renderTemplate(
      "event_updated",
      { eventName: event.name, changeDescription: changeEn },
      null,
      { eventName: event.name, changeDescription: changeEs },
    );
    await createNotification({
      userId: holder.userId,
      communityId,
      type: "event_updated",
      category: "events",
      audienceType: "transactional",
      rendered,
      templateKey: "event_updated",
      templateVersion: 1,
      sourceType: "event",
      sourceId: event.id,
      // Incluye los campos cambiados en la key — dos ediciones materiales
      // distintas del mismo evento deben poder notificar cada una, pero la
      // MISMA edición reprocesada (p.ej. reintento) nunca duplica.
      idempotencyKey: `event_updated:${event.id}:${holder.orderId}:${payload.changedFields.join(",")}`,
      additionalChannels: resolveAdditionalChannels("event_updated"),
      sendImmediately: true,
      recipient: { email: holder.email },
    });
  }
}

export async function handleEventCancelledForEngagement(payload: EventCancelledPayload): Promise<void> {
  const [event] = await _db.select().from(events).where(eq(events.id, payload.eventId)).limit(1);
  if (!event) return;

  const refundInfoEn = "Contact support for refund details.";
  const refundInfoEs = "Contacta con soporte para los detalles del reembolso.";

  for (const holder of await ticketHolders(payload.eventId)) {
    if (!holder.userId) continue;
    const communityId = await resolveCommunityIdFor(holder.userId);
    const rendered = renderTemplate(
      "event_cancelled",
      { eventName: event.name, refundInfo: refundInfoEn },
      null,
      { eventName: event.name, refundInfo: refundInfoEs },
    );
    await createNotification({
      userId: holder.userId,
      communityId,
      type: "event_cancelled",
      category: "events",
      audienceType: "transactional",
      rendered,
      templateKey: "event_cancelled",
      templateVersion: 1,
      sourceType: "event",
      sourceId: event.id,
      idempotencyKey: `event_cancelled:${event.id}:${holder.orderId}`,
      additionalChannels: resolveAdditionalChannels("event_cancelled"),
      sendImmediately: true,
      recipient: { email: holder.email },
    });
  }
}

let registered = false;

export function registerEventLifecycleListeners(): void {
  if (registered) return;
  registered = true;
  engagementEvents.onTyped("event_updated", handleEventUpdatedForEngagement);
  engagementEvents.onTyped("event_cancelled", handleEventCancelledForEngagement);
}
