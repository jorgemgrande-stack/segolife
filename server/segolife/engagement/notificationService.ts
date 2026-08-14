/**
 * notificationService.ts — ÚNICO punto de entrada para crear una
 * notificación (Fase 7). El "outbox": la fila de `notifications` es el
 * punto de durabilidad (spec punto 6) — una vez insertada, sobrevive a
 * cualquier reinicio. `notification_deliveries` en status='pending' es el
 * trabajo pendiente que engagementScheduler.ts (o, para in_app, esta misma
 * llamada de forma síncrona) procesa.
 *
 * IDEMPOTENCIA (spec punto 45, CRÍTICO): `idempotency_key` con UNIQUE real
 * — un domain event repetido (p.ej. un listener que se ejecuta dos veces
 * por un reintento) nunca crea notificaciones duplicadas.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { notifications, notificationDeliveries, type Notification } from "../../../drizzle/schema";
import { isChannelAllowed, type NotificationCategory, type NotificationChannel } from "./notificationPreferencesService";
import { getProvider } from "./providers/providerRegistry";
import { ENGAGEMENT_TEMPLATES, type RenderedTemplate } from "./templates";
import { resolveCommunicationLocale, pickByLocale } from "./communicationLocale";
import type { NotificationEmailMetadata } from "./notificationMetadata";
import { resolveSenderByAdminCategory, resolveSenderByNotificationCategory, SENDER_IDENTITIES, type SenderIdentity } from "./senderRouting";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface CreateNotificationInput {
  userId: number;
  communityId: number | null;
  type: string;
  category: NotificationCategory;
  audienceType: "transactional" | "marketing";
  rendered: RenderedTemplate;
  imageUrl?: string | null;
  priority?: "low" | "normal" | "high";
  templateKey?: string | null;
  templateVersion?: number | null;
  sourceType?: string | null;
  sourceId?: number | null;
  campaignId?: number | null;
  idempotencyKey: string;
  expiresAt?: Date | null;
  /** Canales MÁS ALLÁ de in_app a intentar — in_app siempre se procesa. */
  additionalChannels?: NotificationChannel[];
  /** Datos de contacto ya resueltos — el servicio nunca consulta la tabla users. */
  recipient?: { email?: string | null; phone?: string | null };
  /**
   * Si true, los `additionalChannels` se envían de forma SÍNCRONA ahora
   * mismo (mismo camino que in_app), en vez de encolarse como 'pending'
   * para que engagementScheduler.ts los recoja en su próximo tick. Necesario
   * para comunicaciones de seguridad/urgentes (p.ej. password reset) que no
   * pueden depender de ENGAGEMENT_DELIVERY_ENABLED estar en true ni esperar
   * hasta 1 minuto. Por defecto false (comportamiento Fase 7 original).
   */
  sendImmediately?: boolean;
  /** Communication Center (spec §25) — envío manual (CRM/Student 360) con remitente elegido explícitamente por el admin; sin esto, el remitente se resuelve automáticamente por templateKey/category. */
  senderOverride?: import("./senderRouting").SenderKey;
}

export type CreateNotificationResult =
  | { status: "created"; notification: Notification }
  | { status: "already_exists"; notification: Notification };

export async function createNotification(input: CreateNotificationInput, db?: DbHandle): Promise<CreateNotificationResult> {
  const conn = db ?? (await getDb());

  const [existing] = await conn.select().from(notifications).where(eq(notifications.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing) return { status: "already_exists", notification: existing };

  const metadata: NotificationEmailMetadata = {};
  if (input.rendered.emailHtmlEn != null || input.rendered.emailHtmlEs != null) {
    metadata.emailHtml = { en: input.rendered.emailHtmlEn ?? null, es: input.rendered.emailHtmlEs ?? null };
    metadata.emailText = { en: input.rendered.emailTextEn ?? null, es: input.rendered.emailTextEs ?? null };
  }
  if (input.rendered.subjectEn != null || input.rendered.subjectEs != null) {
    metadata.emailSubject = { en: input.rendered.subjectEn ?? null, es: input.rendered.subjectEs ?? null };
  }
  if (input.senderOverride) {
    metadata.senderOverride = input.senderOverride;
  }

  const [insertResult] = await conn.insert(notifications).ignore().values({
    userId: input.userId,
    communityId: input.communityId,
    type: input.type,
    category: input.category,
    audienceType: input.audienceType,
    titleEn: input.rendered.titleEn,
    titleEs: input.rendered.titleEs,
    bodyEn: input.rendered.bodyEn,
    bodyEs: input.rendered.bodyEs,
    deepLink: input.rendered.deepLink,
    imageUrl: input.imageUrl ?? null,
    priority: input.priority ?? "normal",
    templateKey: input.templateKey ?? null,
    templateVersion: input.templateVersion ?? null,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    campaignId: input.campaignId ?? null,
    idempotencyKey: input.idempotencyKey,
    expiresAt: input.expiresAt ?? null,
    metadata: metadata as Record<string, unknown>,
  });
  const insertId = (insertResult as unknown as { insertId: number }).insertId;
  const [notification] = await conn.select().from(notifications).where(eq(notifications.id, insertId)).limit(1);

  // in_app SIEMPRE se procesa, de forma síncrona (nunca falla, nunca sale del sistema).
  await createAndProcessDelivery(notification, "in_app", input.recipient, conn);

  for (const channel of input.additionalChannels ?? []) {
    if (channel === "in_app") continue; // ya procesado arriba, nunca duplicar
    if (input.sendImmediately) {
      await createAndProcessDelivery(notification, channel, input.recipient, conn);
    } else {
      await createDeliveryIfAllowed(notification, channel, input.category, input.audienceType, input.recipient, conn);
    }
  }

  return { status: "created", notification };
}

/** Remitente resuelto de forma centralizada (senderRouting.ts, spec §2) — 1) `senderOverride` explícito (envío manual CRM/Student 360, spec §25), 2) por templateKey (adminCategory, más preciso), 3) por category (fallback, cubre campañas manuales sin plantilla). Exportado: engagementScheduler.ts reutiliza esta misma función para las deliveries que procesa en su propio tick, nunca reimplementa el criterio de routing. */
export function resolveSenderIdentity(notification: Notification): SenderIdentity {
  const meta = (notification.metadata ?? {}) as NotificationEmailMetadata;
  if (meta.senderOverride) return SENDER_IDENTITIES[meta.senderOverride];
  const template = notification.templateKey ? ENGAGEMENT_TEMPLATES[notification.templateKey] : undefined;
  if (template) return resolveSenderByAdminCategory(template.adminCategory);
  return resolveSenderByNotificationCategory(notification.category);
}

/** Título/cuerpo/html/texto/asunto en el idioma correcto para ESTE destinatario — nunca hardcodear .titleEn/.bodyEn (ver communicationLocale.ts). */
async function resolveLocalizedContent(notification: Notification, conn: DbHandle) {
  const locale = await resolveCommunicationLocale({ userId: notification.userId, communityId: notification.communityId }, conn);
  const meta = (notification.metadata ?? {}) as NotificationEmailMetadata;
  const title = pickByLocale(locale, notification.titleEn, notification.titleEs);
  return {
    locale,
    title,
    subject: meta.emailSubject ? pickByLocale(locale, meta.emailSubject.en, meta.emailSubject.es) : title,
    body: pickByLocale(locale, notification.bodyEn, notification.bodyEs),
    htmlBody: meta.emailHtml ? pickByLocale(locale, meta.emailHtml.en, meta.emailHtml.es) : null,
    plainTextBody: meta.emailText ? pickByLocale(locale, meta.emailText.en, meta.emailText.es) : null,
    senderIdentity: resolveSenderIdentity(notification),
  };
}

/** Envía AHORA, de forma síncrona — usado para in_app (siempre) y para additionalChannels con sendImmediately:true. */
async function createAndProcessDelivery(
  notification: Notification,
  channel: NotificationChannel,
  recipient: CreateNotificationInput["recipient"],
  conn: DbHandle
): Promise<void> {
  const provider = getProvider(channel);
  const [insertResult] = await conn.insert(notificationDeliveries).ignore().values({
    notificationId: notification.id,
    channel,
    provider: channel,
    status: "pending",
    attemptCount: 0,
    scheduledAt: new Date(),
  });
  const insertId = (insertResult as unknown as { insertId: number }).insertId;
  if (!insertId) return; // ya existía (unique notification+channel) — no reprocesar

  if (channel !== "in_app" && !provider.capabilities.configured) {
    await conn.update(notificationDeliveries).set({ status: "skipped", lastError: `${channel} provider not configured` }).where(eq(notificationDeliveries.id, insertId));
    return;
  }

  const content = await resolveLocalizedContent(notification, conn);
  const result = await provider.send({
    userId: notification.userId,
    title: content.title,
    subject: content.subject,
    senderIdentity: content.senderIdentity,
    body: content.body,
    htmlBody: content.htmlBody,
    plainTextBody: content.plainTextBody,
    deepLink: notification.deepLink,
    imageUrl: notification.imageUrl,
    recipient: recipient ?? {},
  });

  await conn.update(notificationDeliveries).set({
    status: result.status,
    attemptCount: 1,
    sentAt: result.status === "sent" ? new Date() : null,
    failedAt: result.status === "failed" ? new Date() : null,
    lastError: result.error ?? null,
    externalMessageId: result.externalMessageId ?? null,
  }).where(eq(notificationDeliveries.id, insertId));
}

/** Para email/push/whatsapp: crea la fila 'pending' si el canal está permitido y el provider configurado — el envío real lo hace engagementScheduler.ts (respetando kill switches), nunca esta llamada. */
async function createDeliveryIfAllowed(
  notification: Notification,
  channel: NotificationChannel,
  category: NotificationCategory,
  audienceType: "transactional" | "marketing",
  recipient: CreateNotificationInput["recipient"],
  conn: DbHandle
): Promise<void> {
  const provider = getProvider(channel);
  const allowed = await isChannelAllowed({ userId: notification.userId, category, channel, audienceType }, conn);

  if (!allowed) {
    await conn.insert(notificationDeliveries).ignore().values({
      notificationId: notification.id, channel, provider: channel, status: "skipped",
      scheduledAt: new Date(), lastError: "Blocked by user preference",
    });
    return;
  }
  if (!provider.capabilities.configured) {
    await conn.insert(notificationDeliveries).ignore().values({
      notificationId: notification.id, channel, provider: channel, status: "skipped",
      scheduledAt: new Date(), lastError: `${channel} provider not configured`,
    });
    return;
  }

  await conn.insert(notificationDeliveries).ignore().values({
    notificationId: notification.id, channel, provider: channel, status: "pending",
    scheduledAt: new Date(),
  });
  void recipient; // el scheduler resuelve el destinatario real en el momento de procesar (evita datos de contacto obsoletos en un envío programado lejano)
}
