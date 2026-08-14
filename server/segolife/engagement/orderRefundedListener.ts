/**
 * orderRefundedListener.ts — SEGOLIFE — Native Ticket Sales (spec §31).
 * `order_refunded` se emitía desde `ticketCancellationService.ts` sin
 * ningún listener conectado (mismo "fires into the void" que
 * ticketPurchasedListener.ts ya corrigió para ticket_purchased). Solo
 * in_app (spec explícito: "NO implementar SMTP/Brevo en esta fase").
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { engagementEvents, type OrderRefundedPayload } from "./engagementEvents";
import { events } from "../../../drizzle/schema";
import { createNotification } from "./notificationService";
import { renderTemplate } from "./templates";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

function fmtAmount(cents: number, locale: "en-US" | "es-ES"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(cents / 100);
}

export async function handleOrderRefundedForEngagement(payload: OrderRefundedPayload): Promise<void> {
  const [event] = await _db.select().from(events).where(eq(events.id, payload.eventId)).limit(1);
  if (!event) return;

  const rendered = renderTemplate(
    "order_refunded",
    { eventName: event.name, amountLabel: fmtAmount(payload.amountCents, "en-US"), orderReference: `#${payload.orderId}` },
    null,
    { eventName: event.name, amountLabel: fmtAmount(payload.amountCents, "es-ES"), orderReference: `#${payload.orderId}` },
  );

  await createNotification({
    userId: payload.userId,
    communityId: payload.communityId,
    type: "order_refunded",
    category: "events",
    audienceType: "transactional",
    rendered,
    sourceType: "ticket_order",
    sourceId: payload.orderId,
    idempotencyKey: `order_refunded:${payload.orderId}`,
  }, _db);
}

let registered = false;

/** Se llama UNA vez desde server/_core/index.ts al arrancar — mismo criterio que registerTicketPurchasedListener(). */
export function registerOrderRefundedListener(): void {
  if (registered) return;
  registered = true;
  engagementEvents.onTyped("order_refunded", handleOrderRefundedForEngagement);
}
