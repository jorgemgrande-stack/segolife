/**
 * communicationChannelMatrix.ts — matriz central de canales por plantilla
 * (Communication Center, spec punto 27: "No hardcodear decisiones en 20
 * listeners"). Cada listener de dominio llama a `resolveAdditionalChannels()`
 * en vez de decidir `additionalChannels` por su cuenta — la decisión de qué
 * canales intentar vive en UN sitio.
 *
 * La fuente de verdad real de "¿soporta este canal?" sigue siendo
 * `EngagementTemplate.channels` (templates.ts) — esta matriz solo decide,
 * PARA LOS CANALES YA SOPORTADOS por la plantilla, si además de in_app
 * (siempre intentado) merece la pena intentar email/whatsapp. Nunca activa
 * un canal que la plantilla no declare.
 */
import { ENGAGEMENT_TEMPLATES } from "./templates";
import type { NotificationChannel } from "./notificationPreferencesService";

/** future_transactional/future_optional: documentan la intención para cuando WhatsApp vía GHL se active — hoy nunca se traducen a un canal real. */
export type WhatsappPolicy = "future_transactional" | "future_optional" | "never";

export function resolveAdditionalChannels(templateKey: string): NotificationChannel[] {
  const template = ENGAGEMENT_TEMPLATES[templateKey];
  if (!template || template.status !== "active") return [];
  // Solo "email" se traduce hoy a un intento real. "push" queda fuera porque
  // no hay flujo de registro de push_subscriptions todavía; "whatsapp" queda
  // fuera EXPLÍCITAMENTE aunque una plantilla lo declare — el canal está
  // preparado en el contrato (capabilities/provider) pero nunca se activa en
  // esta fase (spec: "NO ACTIVES WHATSAPP"), ni siquiera como delivery
  // 'skipped' inerte. Ver resolveWhatsappPolicy() para lo que el admin UI sí
  // debe mostrar (la intención futura, no un intento real).
  return template.channels.includes("email") ? ["email"] : [];
}

/** Política de WhatsApp declarada por plantilla — informativa hoy (canal OFF), consumida por el futuro FutureGhlWebhookProvider y por el admin UI. */
export function resolveWhatsappPolicy(templateKey: string): WhatsappPolicy {
  const template = ENGAGEMENT_TEMPLATES[templateKey];
  if (!template) return "never";
  if (!template.channels.includes("whatsapp")) return "never";
  return template.audienceType === "transactional" ? "future_transactional" : "future_optional";
}
