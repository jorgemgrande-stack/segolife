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
import type { RenderedTemplate } from "./templates";

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
}

export type CreateNotificationResult =
  | { status: "created"; notification: Notification }
  | { status: "already_exists"; notification: Notification };

export async function createNotification(input: CreateNotificationInput, db?: DbHandle): Promise<CreateNotificationResult> {
  const conn = db ?? (await getDb());

  const [existing] = await conn.select().from(notifications).where(eq(notifications.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing) return { status: "already_exists", notification: existing };

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
    metadata: {},
  });
  const insertId = (insertResult as unknown as { insertId: number }).insertId;
  const [notification] = await conn.select().from(notifications).where(eq(notifications.id, insertId)).limit(1);

  // in_app SIEMPRE se procesa, de forma síncrona (nunca falla, nunca sale del sistema).
  await createAndProcessDelivery(notification, "in_app", input.recipient, conn);

  for (const channel of input.additionalChannels ?? []) {
    await createDeliveryIfAllowed(notification, channel, input.category, input.audienceType, input.recipient, conn);
  }

  return { status: "created", notification };
}

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

  const result = await provider.send({
    userId: notification.userId,
    title: notification.titleEn, // el idioma de envío real lo decide el llamador vía i18nResolver — aquí solo se registra el intento
    body: notification.bodyEn,
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
