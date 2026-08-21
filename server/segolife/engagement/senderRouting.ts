/**
 * senderRouting.ts — Communication Center, routing centralizado de
 * remitentes (spec §2). Los 6 remitentes reales de segolife.es (dominio
 * autenticado en Brevo — DKIM/DMARC OK) mapeados desde la taxonomía de
 * `AdminTemplateCategory` (templates.ts) — nunca decidido por el listener/
 * caller individual, ni hardcodeado dentro de emailProvider.ts.
 *
 * Antes de esta fase, TODO el email de Engagement salía desde un único
 * `SEGOLIFE_ENGAGEMENT_EMAIL_FROM` — funcional pero sin distinguir
 * "confirmación de entrada" (tickets@) de "aviso de comunidad" (community@)
 * de "sistema/cuenta" (segolife@). Ese var sigue siendo el FALLBACK si el
 * remitente resuelto no está disponible (nunca bloquea un envío por falta
 * de mapeo).
 */
import type { AdminTemplateCategory } from "./templates";
import type { NotificationCategory } from "./notificationPreferencesService";

export type SenderKey = "system" | "human" | "support" | "community" | "tickets" | "partners";

export interface SenderIdentity {
  key: SenderKey;
  name: string;
  email: string;
}

/** Direcciones reales — segolife.es, autenticado (DKIM/DMARC OK). Nunca modificar sin decisión de negocio explícita (spec §33: no tocar DNS/remitentes verificados). */
export const SENDER_IDENTITIES: Record<SenderKey, SenderIdentity> = {
  system:    { key: "system",    name: "Segolife",           email: "segolife@segolife.es" },
  human:     { key: "human",     name: "Segolife Human",      email: "hola@segolife.es" },
  support:   { key: "support",   name: "Segolife Support",    email: "soporte@segolife.es" },
  community: { key: "community", name: "Segolife Community",  email: "community@segolife.es" },
  tickets:   { key: "tickets",   name: "Tickets Segolife",    email: "tickets@segolife.es" },
  partners:  { key: "partners",  name: "Partners Segolife",   email: "partners@segolife.es" },
};

/** Ruta orientativa del spec §2, aplicada a la taxonomía de 10 categorías real (adminCategory) — nunca una nueva por capricho. */
const SENDER_BY_ADMIN_CATEGORY: Record<AdminTemplateCategory, SenderKey> = {
  ACCOUNT: "system",
  SECURITY: "system",
  SYSTEM: "system",
  ENGAGEMENT: "system",
  SEGOTOKENS: "system",
  BENEFITS: "system",
  PLAN_AND_PLAY: "system",
  COMMUNITY: "community",
  EVENTS: "tickets",
  TICKETING: "tickets",
};

/** Fallback cuando no hay templateKey (p.ej. una campaña manual sin plantilla) — usa el enum real de BD, más pobre que adminCategory pero suficiente para no perder el routing por completo. */
const SENDER_BY_NOTIFICATION_CATEGORY: Record<NotificationCategory, SenderKey> = {
  account: "system",
  rewards: "system",
  benefits: "system",
  promotions: "system",
  events: "tickets",
  // COM-01 — nunca se envía por email hoy (in-app only), pero un remitente
  // correcto queda listo si algún día se añade ese canal.
  messages: "support",
};

export function resolveSenderByAdminCategory(adminCategory: AdminTemplateCategory | null | undefined): SenderIdentity {
  const key = adminCategory ? SENDER_BY_ADMIN_CATEGORY[adminCategory] : "system";
  return SENDER_IDENTITIES[key ?? "system"];
}

export function resolveSenderByNotificationCategory(category: NotificationCategory): SenderIdentity {
  return SENDER_IDENTITIES[SENDER_BY_NOTIFICATION_CATEGORY[category] ?? "system"];
}

export function formatSender(identity: SenderIdentity): string {
  return `${identity.name} <${identity.email}>`;
}
