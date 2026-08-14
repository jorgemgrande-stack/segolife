/**
 * engagementScheduler.ts — worker explícito para deliveries programadas y
 * campañas scheduled (Fase 7, spec puntos 25, 28, 63). NUNCA arranca solo:
 * requiere `ENGAGEMENT_DELIVERY_ENABLED=true` (default false — spec punto
 * 61-62). Mismo criterio que integrationSyncService.ts en Fase 5: en una BD
 * nueva, sin esa variable, `isEngagementDeliveryEnabled()` es siempre false
 * y `startEngagementScheduler()` nunca registra el cron.
 */
import cron, { type ScheduledTask } from "node-cron";
import { eq, and, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { engagementCampaigns, notificationDeliveries, notifications, users, type NotificationDelivery } from "../../../drizzle/schema";
import { sendCampaignNow } from "./campaignService";
import { getProvider } from "./providers/providerRegistry";
import { resolveCommunicationLocale, pickByLocale } from "./communicationLocale";
import type { NotificationEmailMetadata } from "./notificationMetadata";
import { resolveSenderIdentity } from "./notificationService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

export function isEngagementDeliveryEnabled(): boolean {
  return process.env.ENGAGEMENT_DELIVERY_ENABLED === "true";
}

/** Procesa UNA fila de delivery pendiente — reintentos con attempt_count/max_attempts (spec punto 44), nunca reintento infinito. */
export async function processPendingDelivery(delivery: NotificationDelivery): Promise<void> {
  if (delivery.attemptCount >= delivery.maxAttempts) {
    await _db.update(notificationDeliveries).set({ status: "failed", failedAt: new Date(), lastError: "Max attempts exceeded" }).where(eq(notificationDeliveries.id, delivery.id));
    return;
  }

  const [notification] = await _db.select().from(notifications).where(eq(notifications.id, delivery.notificationId)).limit(1);
  if (!notification) return;

  const provider = getProvider(delivery.channel);
  if (!provider.capabilities.configured) {
    await _db.update(notificationDeliveries).set({ status: "skipped", lastError: `${delivery.channel} provider not configured` }).where(eq(notificationDeliveries.id, delivery.id));
    return;
  }

  // Idioma correcto para ESTE destinatario — nunca .titleEn/.bodyEn directo
  // (regla no negociable IE→en/UVA→es, ver communicationLocale.ts). Antes de
  // este fix, todo envío externo (email/push/whatsapp) salía siempre en
  // inglés sin mirar la comunidad de origen.
  const locale = await resolveCommunicationLocale({ userId: notification.userId, communityId: notification.communityId }, _db);
  const meta = (notification.metadata ?? {}) as NotificationEmailMetadata;
  const title = pickByLocale(locale, notification.titleEn, notification.titleEs);
  const subject = meta.emailSubject ? pickByLocale(locale, meta.emailSubject.en, meta.emailSubject.es) : title;

  // Destinatario real resuelto AQUÍ, en el momento de la entrega (nunca
  // guardado en la notificación) — evita datos de contacto obsoletos en un
  // envío programado lejano. Antes de este fix, `recipient` llegaba siempre
  // vacío al provider, así que emailProvider.ts descartaba el envío
  // ("Recipient has no email address") pese a que el resto de la tubería
  // funcionaba — ningún email vía scheduler llegaba a intentarse de verdad.
  const [recipientUser] = await _db.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, notification.userId)).limit(1);

  const result = await provider.send({
    userId: notification.userId,
    title,
    subject,
    senderIdentity: resolveSenderIdentity(notification),
    body: pickByLocale(locale, notification.bodyEn, notification.bodyEs),
    htmlBody: meta.emailHtml ? pickByLocale(locale, meta.emailHtml.en, meta.emailHtml.es) : null,
    plainTextBody: meta.emailText ? pickByLocale(locale, meta.emailText.en, meta.emailText.es) : null,
    deepLink: notification.deepLink,
    imageUrl: notification.imageUrl,
    recipient: { email: recipientUser?.email ?? null, phone: recipientUser?.phone ?? null },
  });

  await _db.update(notificationDeliveries).set({
    status: result.status,
    attemptCount: delivery.attemptCount + 1,
    sentAt: result.status === "sent" ? new Date() : delivery.sentAt,
    failedAt: result.status === "failed" ? new Date() : null,
    lastError: result.error ?? null,
    externalMessageId: result.externalMessageId ?? delivery.externalMessageId,
  }).where(eq(notificationDeliveries.id, delivery.id));
}

async function tick(): Promise<void> {
  const now = new Date();

  // 1. Campañas scheduled cuyo momento llegó.
  const dueCampaigns = await _db.select().from(engagementCampaigns)
    .where(and(eq(engagementCampaigns.status, "scheduled"), lte(engagementCampaigns.scheduledAt, now)));
  for (const campaign of dueCampaigns) {
    try {
      await sendCampaignNow(campaign.id, _db);
    } catch (err) {
      console.error(`[EngagementScheduler] fallo al enviar campaign ${campaign.id}:`, err);
    }
  }

  // 2. Deliveries pendientes (email/push/whatsapp) cuyo scheduled_at ya pasó.
  const pending = await _db.select().from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.status, "pending"), lte(notificationDeliveries.scheduledAt, now)));
  for (const delivery of pending) {
    await processPendingDelivery(delivery);
  }
}

let task: ScheduledTask | null = null;

/** Se llama SOLO desde server/_core/index.ts, condicionado a ENGAGEMENT_DELIVERY_ENABLED=true — nunca desde este módulo directamente. */
export function startEngagementScheduler(): void {
  if (task) return;
  task = cron.schedule("* * * * *", () => {
    tick().catch(err => console.error("[EngagementScheduler] tick falló:", err));
  });
  console.log("[EngagementScheduler] Iniciado (cada minuto) — ENGAGEMENT_DELIVERY_ENABLED=true");
}

export function stopEngagementScheduler(): void {
  task?.stop();
  task = null;
}
