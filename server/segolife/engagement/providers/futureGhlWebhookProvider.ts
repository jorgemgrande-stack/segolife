/**
 * futureGhlWebhookProvider.ts — FUTURO, NO ACTIVADO. Define el contrato y el
 * payload normalizado que un día recibirá GHL para reenviar por WhatsApp,
 * pero:
 *  - NUNCA llama a ninguna API real (no hay fetch a GHL en este archivo).
 *  - NUNCA se registra en providerRegistry.ts — no sustituye a
 *    whatsappProvider.ts (que sigue siendo el provider real "no configurado"
 *    del canal `whatsapp`). Este archivo es la referencia de implementación
 *    para cuando se decida activarlo — ver docs/engagement/ghl-whatsapp-integration.md.
 *  - NUNCA guarda credenciales — `resolveConfigured()` siempre devuelve
 *    false hasta que exista una implementación real deliberada.
 *
 * `buildNormalizedGhlPayload()` sí es información real y usable: es el
 * contrato exacto que notificationService.ts usaría para construir el body
 * del webhook el día que se active — payload MÍNIMO, nunca password/JWT/
 * secrets/perfil completo del estudiante (spec punto 29).
 */
import type { CommunicationLocale } from "../communicationLocale";

export interface NormalizedGhlWebhookPayload {
  eventId: string; // idempotency key propio de la notificación (notifications.idempotency_key), NUNCA el id numérico interno
  communicationType: string; // templateKey (p.ej. "ticket_purchased")
  userId: number;
  locale: CommunicationLocale;
  transactional: boolean;
  recipient: {
    firstName: string | null;
    phone: string | null;
  };
  content: {
    title: string;
    shortText: string;
    ctaLabel: string | null;
    ctaUrl: string | null;
  };
  context: {
    eventId: number | null;
    venueId: number | null;
    benefitId: number | null;
    tokens: number | null;
  };
}

export interface BuildNormalizedGhlPayloadInput {
  idempotencyKey: string;
  templateKey: string;
  userId: number;
  locale: CommunicationLocale;
  transactional: boolean;
  firstName: string | null;
  phone: string | null;
  title: string;
  shortText: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  context?: Partial<NormalizedGhlWebhookPayload["context"]>;
}

/** Construye el payload — pura función, sin red. Es lo que se firmaría/enviaría el día que se active el canal. */
export function buildNormalizedGhlPayload(input: BuildNormalizedGhlPayloadInput): NormalizedGhlWebhookPayload {
  return {
    eventId: input.idempotencyKey,
    communicationType: input.templateKey,
    userId: input.userId,
    locale: input.locale,
    transactional: input.transactional,
    recipient: { firstName: input.firstName, phone: input.phone },
    content: { title: input.title, shortText: input.shortText, ctaLabel: input.ctaLabel, ctaUrl: input.ctaUrl },
    context: {
      eventId: input.context?.eventId ?? null,
      venueId: input.context?.venueId ?? null,
      benefitId: input.context?.benefitId ?? null,
      tokens: input.context?.tokens ?? null,
    },
  };
}

/**
 * Interfaz de referencia para el futuro provider — deliberadamente NO
 * implementa NotificationProvider real ni se instancia en ningún sitio.
 * Cuando se active de verdad: firma HMAC del body, endpoint configurable vía
 * env propia (nunca hardcodeada), idempotency real en el lado de GHL además
 * del `eventId` aquí, retry con backoff — ver docs/engagement/ghl-whatsapp-integration.md.
 */
export interface FutureGhlWebhookProvider {
  readonly configured: false; // literal — nunca true hasta una implementación real deliberada
  send(payload: NormalizedGhlWebhookPayload): Promise<{ status: "not_implemented" }>;
}

export const futureGhlWebhookProvider: FutureGhlWebhookProvider = {
  configured: false,
  async send() {
    return { status: "not_implemented" };
  },
};
