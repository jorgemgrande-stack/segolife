/**
 * brevoWebhookRoutes.ts — endpoint REST para eventos de entrega de Brevo
 * (Communication Center, spec §20). Espejo del mismo patrón que
 * ticketPaymentWebhookRoutes.ts (Express Router standalone, montado en
 * _core/index.ts) — agnóstico de negocio, solo actualiza
 * `notification_deliveries` por `externalMessageId` (capturado al enviar,
 * ver mailer.ts::sendEmailTracked / emailProvider.ts).
 *
 * AUTENTICIDAD: Brevo no firma sus webhooks con HMAC de forma nativa (a
 * diferencia de Redsys/Stripe) — la validación "razonable" real que ofrece
 * es un token compartido en la propia URL del webhook, configurado en el
 * panel de Brevo al dar de alta el webhook. `BREVO_WEBHOOK_TOKEN` se exige
 * aquí como query param `?token=`; sin coincidencia exacta, 401 — nunca se
 * procesa un evento sin token válido. Sin la variable configurada, el
 * endpoint responde 503 (nunca "acepta cualquier cosa" por defecto).
 *
 * IDEMPOTENCIA: Brevo puede reenviar el mismo evento — cada actualización es
 * un UPDATE por campo (timestamp/estado), nunca un INSERT — reprocesar el
 * mismo evento nunca duplica nada, como mucho re-escribe el mismo valor.
 */
import express from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { timingSafeEqual } from "crypto";
import { notificationDeliveries } from "../drizzle/schema";
import { suppressEmail } from "./segolife/engagement/emailSuppressionService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

const brevoWebhookRouter = express.Router();

const brevoEventSchema = z.object({
  event: z.string(),
  email: z.string().email().optional(),
  "message-id": z.string().optional(),
});

// PRE-16.15 (auditoría overnight): antes comparaba con `===` — una
// comparación de string normal en V8 puede salir antes en el primer byte
// distinto, filtrando por temporización cuánto del token es correcto.
// timingSafeEqual compara en tiempo constante; solo se aplica cuando ambas
// cadenas ya tienen la MISMA longitud (una longitud distinta ya descarta el
// match sin necesitar comparación byte a byte, y timingSafeEqual lanzaría
// si los buffers no miden igual).
function isTokenValid(req: express.Request): boolean {
  const expected = process.env.BREVO_WEBHOOK_TOKEN;
  if (!expected) return false;
  const provided = req.query.token;
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

brevoWebhookRouter.get("/api/engagement/brevo-webhook/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), service: "brevo-webhook", configured: !!process.env.BREVO_WEBHOOK_TOKEN });
});

async function handleBrevoEvent(payload: z.infer<typeof brevoEventSchema>): Promise<{ handled: boolean; reason?: string }> {
  const messageId = payload["message-id"];
  if (!messageId) return { handled: false, reason: "no_message_id" };

  const [delivery] = await _db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.externalMessageId, messageId)).limit(1);
  if (!delivery) return { handled: false, reason: "delivery_not_found" };

  const now = new Date();
  switch (payload.event) {
    case "delivered":
      await _db.update(notificationDeliveries).set({ status: "delivered", deliveredAt: now }).where(eq(notificationDeliveries.id, delivery.id));
      break;
    case "opened":
    case "unique_opened":
      await _db.update(notificationDeliveries).set({ openedAt: now }).where(eq(notificationDeliveries.id, delivery.id));
      break;
    case "click":
    case "clicked":
      await _db.update(notificationDeliveries).set({ clickedAt: now }).where(eq(notificationDeliveries.id, delivery.id));
      break;
    case "hard_bounce":
      await _db.update(notificationDeliveries).set({ status: "failed", failedAt: now, lastError: "Hard bounce" }).where(eq(notificationDeliveries.id, delivery.id));
      if (payload.email) await suppressEmail({ email: payload.email, reason: "hard_bounce", source: "brevo_webhook" });
      break;
    case "blocked":
      await _db.update(notificationDeliveries).set({ status: "failed", failedAt: now, lastError: "Blocked by Brevo" }).where(eq(notificationDeliveries.id, delivery.id));
      if (payload.email) await suppressEmail({ email: payload.email, reason: "blocked", source: "brevo_webhook" });
      break;
    case "spam":
    case "invalid_email":
      await _db.update(notificationDeliveries).set({ lastError: payload.event === "spam" ? "Marked as spam" : "Invalid email" }).where(eq(notificationDeliveries.id, delivery.id));
      if (payload.event === "spam" && payload.email) await suppressEmail({ email: payload.email, reason: "spam", source: "brevo_webhook" });
      break;
    case "soft_bounce":
    case "deferred":
      // Transitorio — Brevo reintenta por su cuenta; se registra sin marcar failed ni suprimir (spec §21: distinto de hard bounce).
      await _db.update(notificationDeliveries).set({ lastError: `Brevo: ${payload.event}` }).where(eq(notificationDeliveries.id, delivery.id));
      break;
    case "unsubscribed":
      // Unsubscribe nativo de Brevo — distinto del opt-out real (notification_preferences, gestionado por el propio Student). Se registra, no se actúa sobre preferencias sin una vinculación explícita userId↔email verificada.
      await _db.update(notificationDeliveries).set({ lastError: "Unsubscribed via Brevo" }).where(eq(notificationDeliveries.id, delivery.id));
      break;
    default:
      return { handled: false, reason: `unmapped_event:${payload.event}` };
  }
  return { handled: true };
}

brevoWebhookRouter.post("/api/engagement/brevo-webhook", express.json({ limit: "1mb" }), async (req, res) => {
  if (!isTokenValid(req)) {
    res.status(process.env.BREVO_WEBHOOK_TOKEN ? 401 : 503).json({ ok: false, error: process.env.BREVO_WEBHOOK_TOKEN ? "invalid_token" : "not_configured" });
    return;
  }

  const events = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];
  for (const raw of events) {
    const parsed = brevoEventSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ handled: false, reason: "invalid_payload_shape" });
      continue;
    }
    try {
      results.push(await handleBrevoEvent(parsed.data));
    } catch (err) {
      console.error("[brevo-webhook] fallo procesando evento:", err);
      results.push({ handled: false, reason: "internal_error" });
    }
  }

  res.status(200).json({ ok: true, processed: results.length, results });
});

export default brevoWebhookRouter;
