/**
 * templates.ts — catálogo de plantillas de sistema (Fase 7, spec punto 16).
 * NUNCA reutiliza server/emailTemplates.ts heredado de Náyade. Plantillas
 * puramente técnicas → EN CÓDIGO (versionadas por commit, no por tabla),
 * como pidió el spec punto 78 ("preferir código/versionado salvo razón
 * fuerte"). Interpolación simple `{{variable}}`, solo variables declaradas
 * en `allowedVariables` — nunca injection arbitrario.
 */
import { sanitizeDeepLink } from "./deepLinkPolicy";

export interface EngagementTemplate {
  key: string;
  version: number;
  category: "events" | "rewards" | "benefits" | "promotions" | "account";
  audienceType: "transactional" | "marketing";
  channels: Array<"in_app" | "email" | "push" | "whatsapp">;
  titleEn: string;
  titleEs: string;
  bodyEn: string;
  bodyEs: string;
  allowedVariables: string[];
}

export const ENGAGEMENT_TEMPLATES: Record<string, EngagementTemplate> = {
  benefit_granted: {
    key: "benefit_granted",
    version: 1,
    category: "benefits",
    audienceType: "transactional",
    channels: ["in_app", "email"],
    titleEn: "You unlocked a benefit",
    titleEs: "Has desbloqueado un beneficio",
    bodyEn: "{{benefitName}}",
    bodyEs: "{{benefitName}}",
    allowedVariables: ["benefitName"],
  },
  benefit_expiring: {
    key: "benefit_expiring",
    version: 1,
    category: "benefits",
    audienceType: "transactional",
    channels: ["in_app"],
    titleEn: "A benefit is about to expire",
    titleEs: "Un beneficio está a punto de caducar",
    bodyEn: "{{benefitName}} expires soon — use it before it's gone.",
    bodyEs: "{{benefitName}} caduca pronto — úsalo antes de que se pierda.",
    allowedVariables: ["benefitName"],
  },
  recurrence_progress: {
    key: "recurrence_progress",
    version: 1,
    category: "rewards",
    audienceType: "transactional",
    channels: ["in_app"],
    titleEn: "You're close to a bonus",
    titleEs: "Estás cerca de un bonus",
    bodyEn: "One more visit to unlock +{{bonusAmount}} SegoTokens",
    bodyEs: "Una visita más para desbloquear +{{bonusAmount}} SegoTokens",
    allowedVariables: ["bonusAmount"],
  },
  event_tonight: {
    key: "event_tonight",
    version: 1,
    category: "events",
    audienceType: "marketing",
    channels: ["in_app"],
    titleEn: "Tonight: {{eventName}}",
    titleEs: "Esta noche: {{eventName}}",
    bodyEn: "Don't miss it — check it out in Explore.",
    bodyEs: "No te lo pierdas — míralo en Explorar.",
    allowedVariables: ["eventName"],
  },
  // COMUNITY (spec punto 20) — publicación de una propuesta nueva.
  community_proposal_published: {
    key: "community_proposal_published",
    version: 1,
    category: "events",
    audienceType: "transactional",
    channels: ["in_app"],
    titleEn: "🔥 New question in COMUNITY",
    titleEs: "🔥 Nueva pregunta en COMUNITY",
    bodyEn: "{{title}}",
    bodyEs: "{{title}}",
    allowedVariables: ["title"],
  },
  // COMUNITY (spec punto 47) — el Event convertido ya se publicó, notificar
  // a quien respondió con intención positiva.
  community_interested_event_published: {
    key: "community_interested_event_published",
    version: 1,
    category: "events",
    audienceType: "transactional",
    channels: ["in_app"],
    titleEn: "You asked for it. It's here.",
    titleEs: "Lo pedisteis. Ya está aquí.",
    bodyEn: "{{eventName}}",
    bodyEs: "{{eventName}}",
    allowedVariables: ["eventName"],
  },
};

/** Sustituye SOLO las variables declaradas en allowedVariables — cualquier otra clave del objeto vars se ignora silenciosamente. */
function interpolate(text: string, template: EngagementTemplate, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!template.allowedVariables.includes(key)) return match;
    return vars[key] ?? match;
  });
}

export interface RenderedTemplate {
  titleEn: string;
  titleEs: string;
  bodyEn: string;
  bodyEs: string;
  deepLink: string | null;
}

/**
 * `varsEs` es opcional — si se omite, se reutiliza `vars` (la mayoría de
 * variables, como cantidades o fechas, son iguales en ambos idiomas; solo
 * hace falta `varsEs` cuando la variable en sí es un texto traducido, p.ej.
 * el nombre de un beneficio con name_en/name_es distintos).
 */
export function renderTemplate(templateKey: string, vars: Record<string, string>, deepLink?: string | null, varsEs?: Record<string, string>): RenderedTemplate {
  const template = ENGAGEMENT_TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown engagement template: ${templateKey}`);
  return {
    titleEn: interpolate(template.titleEn, template, vars),
    titleEs: interpolate(template.titleEs, template, varsEs ?? vars),
    bodyEn: interpolate(template.bodyEn, template, vars),
    bodyEs: interpolate(template.bodyEs, template, varsEs ?? vars),
    deepLink: sanitizeDeepLink(deepLink),
  };
}
