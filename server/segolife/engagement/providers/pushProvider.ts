/**
 * pushProvider.ts — F67 (Push + WhatsApp). Antes: `configured` siempre
 * `false`, sin ninguna dependencia real ni VAPID keys (Fase 7, "preparado,
 * no activado"). Ahora: implementación REAL vía `web-push` — mismo criterio
 * exacto que `emailProvider.ts::createEmailProvider()` (factory que
 * comprueba el entorno en el momento de instanciar, `configured` refleja
 * disponibilidad real, nunca una falsa luz verde).
 *
 * Requiere `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (un
 * `mailto:` o URL de contacto exigido por el estándar Web Push) — sin las
 * tres, `configured` queda `false` y `send()` nunca intenta un envío real,
 * exactamente igual que el email sin `SEGOLIFE_ENGAGEMENT_EMAIL_FROM`.
 *
 * Multi-dispositivo real (spec: un estudiante puede tener el Student App
 * instalada en varios navegadores/móviles a la vez): `send()` recibe
 * `message.userId` (ya viene en OutboundMessage, no hace falta tocar su
 * contrato) y envía a TODAS las suscripciones activas de ese usuario —
 * nunca solo "la última". Una suscripción que el navegador ya invalidó
 * (404/410 de la propia API de push) se revoca aquí mismo
 * (`revokeSubscription`) — auto-limpieza sin job aparte.
 *
 * DeliveryResult agregado: "sent" si al menos una suscripción recibió el
 * push con éxito; "skipped" si el usuario no tiene ninguna suscripción
 * activa (nunca un error — no tener push activado es un estado válido,
 * igual que no tener email); "failed" solo si había suscripciones y TODAS
 * fallaron por un motivo que no sea "ya no existe".
 */
import webpush from "web-push";
import type { NotificationProvider, OutboundMessage, DeliveryResult } from "../notificationProvider";
import { PUSH_CAPABILITIES_UNCONFIGURED, type ChannelCapabilities } from "../capabilities";
import { listActiveSubscriptionsForUser, revokeSubscriptionByEndpoint } from "../pushSubscriptionService";

function resolveVapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function createPushProvider(): NotificationProvider {
  const vapid = resolveVapidConfig();
  const capabilities: ChannelCapabilities = { ...PUSH_CAPABILITIES_UNCONFIGURED, configured: !!vapid };
  if (vapid) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  return {
    channel: "push",
    capabilities,
    async send(message: OutboundMessage): Promise<DeliveryResult> {
      if (!vapid) {
        return { status: "skipped", error: "Push provider not configured (faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT)" };
      }
      const subscriptions = await listActiveSubscriptionsForUser(message.userId);
      if (subscriptions.length === 0) {
        return { status: "skipped", error: "El usuario no tiene ninguna suscripción push activa" };
      }

      const payload = JSON.stringify({
        title: message.title,
        body: message.body,
        deepLink: message.deepLink,
        imageUrl: message.imageUrl,
      });

      let anySent = false;
      let lastError: string | null = null;
      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.keysP256dh ?? "", auth: sub.keysAuth ?? "" } },
            payload,
          );
          anySent = true;
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // El navegador/OS ya invalidó este endpoint — limpieza real, no un fallo de envío.
            await revokeSubscriptionByEndpoint(sub.endpoint).catch(() => {});
          } else {
            lastError = err instanceof Error ? err.message : String(err);
          }
        }
      }

      if (anySent) return { status: "sent" };
      return { status: "failed", error: lastError ?? "Todas las suscripciones activas fallaron" };
    },
  };
}
