/**
 * ticketCheckedInListener.ts — SEGOLIFE — Native Ticket Sales (spec §31).
 * `ticket_checked_in` se emitía desde `nativeCheckinService.ts` sin ningún
 * listener conectado. Solo in_app — es una confirmación instantánea al
 * propio momento del check-in, nunca necesita email (spec explícito: "NO
 * implementar SMTP/Brevo en esta fase").
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { engagementEvents, type TicketCheckedInPayload } from "./engagementEvents";
import { events, venues } from "../../../drizzle/schema";
import { createNotification } from "./notificationService";
import { renderTemplate } from "./templates";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

export async function handleTicketCheckedInForEngagement(payload: TicketCheckedInPayload): Promise<void> {
  const [event] = await _db.select().from(events).where(eq(events.id, payload.eventId)).limit(1);
  if (!event) return;
  const [venue] = payload.venueId ? await _db.select().from(venues).where(eq(venues.id, payload.venueId)).limit(1) : [null];
  const venueName = venue?.name ?? "";

  const rendered = renderTemplate(
    "ticket_checked_in",
    { eventName: event.name, venueName },
    null,
    { eventName: event.name, venueName },
  );

  await createNotification({
    userId: payload.userId,
    communityId: payload.communityId,
    type: "ticket_checked_in",
    category: "events",
    audienceType: "transactional",
    rendered,
    sourceType: "event_ticket",
    sourceId: payload.ticketId,
    idempotencyKey: `ticket_checked_in:${payload.ticketId}`,
  }, _db);
}

let registered = false;

/** Se llama UNA vez desde server/_core/index.ts al arrancar — mismo criterio que registerTicketPurchasedListener(). */
export function registerTicketCheckedInListener(): void {
  if (registered) return;
  registered = true;
  engagementEvents.onTyped("ticket_checked_in", handleTicketCheckedInForEngagement);
}
