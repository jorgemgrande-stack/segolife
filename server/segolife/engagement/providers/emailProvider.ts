/**
 * emailProvider.ts — adapter de email real (Fase 7, spec puntos 38-40).
 * REUTILIZA el transporte genérico `sendEmail()` de server/mailer.ts
 * (Brevo API + SMTP fallback) — pero NUNCA confía en `SMTP_FROM` directo:
 * esa variable, en este entorno, sigue siendo el placeholder heredado de
 * la plantilla `env.example.txt` ("Skicenter <reservas@skicenter.es>"),
 * no un remitente real de Segolife. Se exige una variable PROPIA,
 * `SEGOLIFE_ENGAGEMENT_EMAIL_FROM`, con su propio guard anti-marca-ajena —
 * mismo criterio que ya se aplicó a GA4/Meta Pixel en Fase 6 (sin fallback
 * a un valor de otro negocio).
 *
 * Sin esa variable (o si contiene una marca prohibida), el provider queda
 * `configured: false` y `send()` nunca intenta un envío real — nunca
 * "NOT CONFIGURED" silencioso que en realidad sí envía.
 */
import { sendEmail } from "../../../mailer";
import type { NotificationProvider, OutboundMessage, DeliveryResult } from "../notificationProvider";
import { EMAIL_CAPABILITIES_UNCONFIGURED, type ChannelCapabilities } from "../capabilities";

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
  const from = resolveConfiguredFrom();
  const capabilities: ChannelCapabilities = { ...EMAIL_CAPABILITIES_UNCONFIGURED, configured: !!from };

  return {
    channel: "email",
    capabilities,
    async send(message: OutboundMessage): Promise<DeliveryResult> {
      if (!from) {
        return { status: "skipped", error: "Email provider not configured (SEGOLIFE_ENGAGEMENT_EMAIL_FROM unset or invalid)" };
      }
      if (!message.recipient.email) {
        return { status: "skipped", error: "Recipient has no email address" };
      }
      try {
        const ok = await sendEmail({
          to: message.recipient.email,
          from,
          subject: message.title,
          html: `<p>${message.body}</p>${message.deepLink ? `<p><a href="${message.deepLink}">${message.deepLink}</a></p>` : ""}`,
          text: message.body,
        });
        return ok ? { status: "sent" } : { status: "failed", error: "sendEmail() returned false" };
      } catch (err) {
        return { status: "failed", error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
