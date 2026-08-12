/**
 * ticketPurchasedListener.ts — Communication Center: primer listener real de
 * `engagementEvents` (Fase 7 dejó el catálogo tipado y el emisor en
 * checkoutService.ts, pero SIN NINGÚN listener conectado — confirmado por
 * auditoría, "el evento se dispara al vacío"). Mismo patrón exacto que
 * benefitGrantedListener.ts: un listener más, nunca modifica
 * checkoutService.ts ni engagementEvents.ts.
 */
import { eq, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { engagementEvents, type TicketPurchasedPayload } from "./engagementEvents";
import { ticketOrders, ticketOrderItems, eventTicketTypes, events, venues, communities, userCommunities } from "../../../drizzle/schema";
import { createNotification } from "./notificationService";
import { renderTemplate } from "./templates";
import { resolveAdditionalChannels } from "./communicationChannelMatrix";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

function fmtDate(d: Date, locale: "en-US" | "es-ES"): string {
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}
function fmtTime(d: Date, locale: "en-US" | "es-ES"): string {
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
function fmtAmount(cents: number, currency: string, locale: "en-US" | "es-ES"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export async function handleTicketPurchasedForEngagement(payload: TicketPurchasedPayload): Promise<void> {
  const [order] = await _db.select().from(ticketOrders).where(eq(ticketOrders.id, payload.orderId)).limit(1);
  if (!order || order.status !== "paid") return; // solo notificar pedidos realmente pagados

  const [event] = await _db.select().from(events).where(eq(events.id, payload.eventId)).limit(1);
  if (!event) return;

  // checkoutService.ts emite este evento SIEMPRE con communityId: null (no
  // hay relación evento↔comunidad en el schema hoy) — se resuelve aquí la
  // comunidad real del comprador en vez de confiar en el payload, para que
  // resolveCommunicationLocale() pueda aplicar la regla IE=EN/UVA=ES en vez
  // de caer siempre al fallback "es". Mismo criterio que
  // notifyProposalPublished() en communityAudienceService.ts: "primera
  // comunidad real" cuando el usuario pertenece a más de una.
  const [membership] = await _db.select({ communityId: userCommunities.communityId })
    .from(userCommunities).where(eq(userCommunities.userId, payload.userId)).orderBy(asc(userCommunities.joinedAt)).limit(1);
  const resolvedCommunityId = membership?.communityId ?? payload.communityId;

  const [venue] = event.venueId ? await _db.select().from(venues).where(eq(venues.id, event.venueId)).limit(1) : [null];
  const [item] = await _db.select().from(ticketOrderItems).where(eq(ticketOrderItems.orderId, order.id)).limit(1);
  const [ticketType] = item?.ticketTypeId
    ? await _db.select().from(eventTicketTypes).where(eq(eventTicketTypes.id, item.ticketTypeId)).limit(1)
    : [null];

  let communitySlug: string | null = null;
  if (resolvedCommunityId) {
    const [community] = await _db.select().from(communities).where(eq(communities.id, resolvedCommunityId)).limit(1);
    communitySlug = community?.slug ?? null;
  }

  const venueName = venue?.name ?? "";
  const rendered = renderTemplate(
    "ticket_purchased",
    {
      eventName: event.name,
      venueName,
      dateLabel: fmtDate(event.startsAt, "en-US"),
      timeLabel: fmtTime(event.startsAt, "en-US"),
      ticketTypeName: ticketType?.name ?? "",
      quantity: String(item?.quantity ?? 1),
      totalAmountLabel: fmtAmount(order.totalCents, order.currency, "en-US"),
      orderReference: `#${order.id}`,
    },
    communitySlug ? `/${communitySlug}/tickets` : null,
    {
      eventName: event.name,
      venueName,
      dateLabel: fmtDate(event.startsAt, "es-ES"),
      timeLabel: fmtTime(event.startsAt, "es-ES"),
      ticketTypeName: ticketType?.name ?? "",
      quantity: String(item?.quantity ?? 1),
      totalAmountLabel: fmtAmount(order.totalCents, order.currency, "es-ES"),
      orderReference: `#${order.id}`,
    },
  );

  await createNotification({
    userId: payload.userId,
    communityId: resolvedCommunityId,
    type: "ticket_purchased",
    category: "events",
    audienceType: "transactional",
    rendered,
    templateKey: "ticket_purchased",
    templateVersion: 1,
    sourceType: "ticket_order",
    sourceId: order.id,
    idempotencyKey: `ticket_purchased:${order.id}`,
    additionalChannels: resolveAdditionalChannels("ticket_purchased"),
    sendImmediately: true,
    recipient: { email: order.buyerEmail ?? null, phone: order.buyerPhone ?? null },
  });
}

let registered = false;

/** Se llama UNA vez desde server/_core/index.ts al arrancar — mismo criterio que registerBenefitGrantedListener(). */
export function registerTicketPurchasedListener(): void {
  if (registered) return;
  registered = true;
  engagementEvents.onTyped("ticket_purchased", handleTicketPurchasedForEngagement);
}
