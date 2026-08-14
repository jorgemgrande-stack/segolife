/**
 * emailProvider.ts — adapter de email real (Fase 7, spec puntos 38-40;
 * extendido en Communication Center, spec §2/§20-21). REUTILIZA el
 * transporte genérico `sendEmailTracked()` de server/mailer.ts (Brevo API +
 * SMTP fallback) — pero NUNCA confía en `SMTP_FROM` directo: esa variable,
 * en este entorno, sigue siendo el placeholder heredado de la plantilla
 * `env.example.txt` ("Skicenter <reservas@skicenter.es>"), no un remitente
 * real de Segolife. Se exige una variable PROPIA,
 * `SEGOLIFE_ENGAGEMENT_EMAIL_FROM`, con su propio guard anti-marca-ajena —
 * mismo criterio que ya se aplicó a GA4/Meta Pixel en Fase 6 (sin fallback
 * a un valor de otro negocio). Sigue siendo el remitente por defecto/
 * fallback cuando el mensaje no trae un `senderIdentity` resuelto
 * (senderRouting.ts) — los remitentes reales por categoría (segolife@,
 * community@, tickets@...) SIEMPRE ganan cuando están disponibles.
 *
 * Sin `SEGOLIFE_ENGAGEMENT_EMAIL_FROM` (o si contiene una marca prohibida),
 * el provider queda `configured: false` y `send()` nunca intenta un envío
 * real — nunca "NOT CONFIGURED" silencioso que en realidad sí envía.
 *
 * Supresión técnica (spec §21): comprobada ANTES de intentar el envío —
 * una dirección con hard bounce/blocked/spam previo nunca reintenta,
 * independientemente de preferencias de marketing (concepto distinto).
 */
import { sendEmailTracked } from "../../../mailer";
import type { NotificationProvider, OutboundMessage, DeliveryResult } from "../notificationProvider";
import { EMAIL_CAPABILITIES_UNCONFIGURED, type ChannelCapabilities } from "../capabilities";
import { formatSender } from "../senderRouting";
import { isEmailSuppressed } from "../emailSuppressionService";

const FORBIDDEN_SENDER_SUBSTRINGS = ["nayade", "náyade", "skicenter", "rapalinahoteles"];

function resolveConfiguredFrom(): string | null {
  const raw = process.env.SEGOLIFE_ENGAGEMENT_EMAIL_FROM;
  if (!raw || !raw.includes("@")) return null;
  const lower = raw.toLowerCase();
  if (FORBIDDEN_SENDER_SUBSTRINGS.some(s => lower.includes(s))) {
    console.error(`[EmailProvider] SEGOLIFE_ENGAGEMENT_EMAIL_FROM contiene una marca ajena prohibida — tratado como NOT CONFIGURED: "${raw}"`);
    return null;
  }
  return raw;
}

export function createEmailProvider(): NotificationProvider {
  const defaultFrom = resolveConfiguredFrom();
  const capabilities: ChannelCapabilities = { ...EMAIL_CAPABILITIES_UNCONFIGURED, configured: !!defaultFrom, supportsDeliveryStatus: true };

  return {
    channel: "email",
    capabilities,
    async send(message: OutboundMessage): Promise<DeliveryResult> {
      if (!defaultFrom) {
        return { status: "skipped", error: "Email provider not configured (SEGOLIFE_ENGAGEMENT_EMAIL_FROM unset or invalid)" };
      }
      if (!message.recipient.email) {
        return { status: "skipped", error: "Recipient has no email address" };
      }
      if (await isEmailSuppressed(message.recipient.email)) {
        return { status: "skipped", error: "Email suppressed (hard bounce/blocked/spam/manual)" };
      }
      try {
        const html = message.htmlBody ?? `<p>${message.body}</p>${message.deepLink ? `<p><a href="${message.deepLink}">${message.deepLink}</a></p>` : ""}`;
        const text = message.plainTextBody ?? message.body;
        const from = message.senderIdentity ? formatSender(message.senderIdentity) : defaultFrom;
        const subject = message.subject ?? message.title;
        const result = await sendEmailTracked({
          to: message.recipient.email,
          from,
          subject,
          html,
          text,
        });
        return result.success
          ? { status: "sent", externalMessageId: result.messageId ?? null }
          : { status: "failed", error: "sendEmailTracked() returned failure" };
      } catch (err) {
        return { status: "failed", error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
