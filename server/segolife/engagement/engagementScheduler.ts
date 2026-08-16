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
type DbHandle = typeof _db;

export function isEngagementDeliveryEnabled(): boolean {
  return process.env.ENGAGEMENT_DELIVERY_ENABLED === "true";
}

/**
 * Procesa UNA fila de delivery pendiente — reintentos con attempt_count/max_attempts
 * (spec punto 44), nunca reintento infinito.
 *
 * PRE-16 overnight hardening (bug real encontrado en auditoría): antes no
 * había ninguna reclamación atómica entre leer la fila `pending` y enviarla
 * — si un tick tardaba más de 60s (latencia real de Brevo/push bajo carga),
 * el siguiente tick del cron (mismo proceso, node-cron no bloquea
 * solapamientos) volvía a seleccionar la MISMA fila todavía `pending` y la
 * reenviaba de verdad; el mismo riesgo existe entre 2+ instancias si el
 * servicio escala horizontalmente. `FourvenuesScheduler` ya resuelve esto
 * con un lock real (`tryAcquireSyncLock`, SELECT...FOR UPDATE) — aquí, sin
 * añadir ninguna columna/estado nuevo (spec: cambio aditivo mínimo), se
 * reutiliza `attempt_count` como token de reclamación: un UPDATE condicional
 * que solo puede "ganar" una vez por valor de attempt_count, igual que
 * orderStateMachine.ts usa `WHERE status IN (from)`.
 */
export async function processPendingDelivery(delivery: NotificationDelivery, db: DbHandle = _db): Promise<void> {
  if (delivery.attemptCount >= delivery.maxAttempts) {
    await db.update(notificationDeliveries).set({ status: "failed", failedAt: new Date(), lastError: "Max attempts exceeded" }).where(eq(notificationDeliveries.id, delivery.id));
    return;
  }

  const claim = await db.update(notificationDeliveries)
    .set({ attemptCount: delivery.attemptCount + 1 })
    .where(and(
      eq(notificationDeliveries.id, delivery.id),
      eq(notificationDeliveries.status, "pending"),
      eq(notificationDeliveries.attemptCount, delivery.attemptCount),
    ));
  const claimedRows = (claim as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  if (claimedRows !== 1) return; // otro tick/instancia ya reclamó esta entrega — no reenviar

  const [notification] = await db.select().from(notifications).where(eq(notifications.id, delivery.notificationId)).limit(1);
  if (!notification) return;

  const provider = getProvider(delivery.channel);
  if (!provider.capabilities.configured) {
    await db.update(notificationDeliveries).set({ status: "skipped", lastError: `${delivery.channel} provider not configured` }).where(eq(notificationDeliveries.id, delivery.id));
    return;
  }

  // Idioma correcto para ESTE destinatario — nunca .titleEn/.bodyEn directo
  // (regla no negociable IE→en/UVA→es, ver communicationLocale.ts). Antes de
  // este fix, todo envío externo (email/push/whatsapp) salía siempre en
  // inglés sin mirar la comunidad de origen.
  const locale = await resolveCommunicationLocale({ userId: notification.userId, communityId: notification.communityId }, db);
  const meta = (notification.metadata ?? {}) as NotificationEmailMetadata;
  const title = pickByLocale(locale, notification.titleEn, notification.titleEs);
  const subject = meta.emailSubject ? pickByLocale(locale, meta.emailSubject.en, meta.emailSubject.es) : title;

  // Destinatario real resuelto AQUÍ, en el momento de la entrega (nunca
  // guardado en la notificación) — evita datos de contacto obsoletos en un
  // envío programado lejano. Antes de este fix, `recipient` llegaba siempre
  // vacío al provider, así que emailProvider.ts descartaba el envío
  // ("Recipient has no email address") pese a que el resto de la tubería
  // funcionaba — ningún email vía scheduler llegaba a intentarse de verdad.
  const [recipientUser] = await db.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, notification.userId)).limit(1);

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

  // attemptCount ya quedó incrementado por la reclamación atómica de arriba
  // — no se vuelve a tocar aquí, solo se registra el resultado del envío.
  await db.update(notificationDeliveries).set({
    status: result.status,
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
