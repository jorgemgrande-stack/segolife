/**
 * templates.ts — catálogo de plantillas de sistema (Fase 7, spec punto 16;
 * extendido en el Communication Center — ver
 * docs/engagement/communication-center.md). NUNCA reutiliza
 * server/emailTemplates.ts heredado de Náyade. Plantillas puramente técnicas
 * → EN CÓDIGO (versionadas por commit, no por tabla — spec punto 78:
 * "preferir código/versionado salvo razón fuerte"). Interpolación simple
 * `{{variable}}`, solo variables declaradas en `allowedVariables` — nunca
 * injection arbitrario.
 *
 * `adminCategory` es la taxonomía de 10 categorías del panel de admin
 * (Communication Center, sección 61) — DISTINTA de `category`, que es el
 * enum real de `notifications.category` en BD (events/rewards/benefits/
 * promotions/account, usado para preferencias de canal). No se ha ampliado
 * el enum de BD para evitar una migración durante esta fase — la nueva
 * taxonomía vive solo en código, como capa de presentación.
 *
 * `status: "prepared"` = catalogado y con contenido EN/ES real, pero SIN
 * ningún listener de dominio conectado todavía (spec punto 51, "V2 /
 * preparados") — nunca se dispara en producción, solo existe para que el
 * panel de admin lo muestre y para no tener que rediseñar la arquitectura
 * cuando se active.
 */
import { sanitizeDeepLink } from "./deepLinkPolicy";
import { canonicalBaseUrl } from "../../_core/canonicalHost";
import type { NotificationCategory } from "./notificationPreferencesService";
import {
  renderEmailShell, renderPlainText, heroBlock, contentBlock, eventCard, tokensCard, benefitCard,
  ctaButton, secondaryButton, infoBox, alertBox, escapeHtml,
} from "./email/emailShell";

export type AdminTemplateCategory =
  | "ACCOUNT" | "SECURITY" | "COMMUNITY" | "EVENTS" | "TICKETING"
  | "SEGOTOKENS" | "BENEFITS" | "PLAN_AND_PLAY" | "ENGAGEMENT" | "SYSTEM";

type EmailBodyBuilder = (vars: Record<string, string>, locale: "en" | "es", ctx: { deepLinkUrl: string | null; preferencesUrl: string | null }) => { rows: string; paragraphs: string[]; headline: string };

export interface EngagementTemplate {
  key: string;
  version: number;
  category: NotificationCategory;
  adminCategory: AdminTemplateCategory;
  audienceType: "transactional" | "marketing";
  channels: Array<"in_app" | "email" | "push" | "whatsapp">;
  status: "active" | "prepared";
  description: string;
  triggerEvent: string;
  titleEn: string;
  titleEs: string;
  bodyEn: string;
  bodyEs: string;
  subjectEn?: string;
  subjectEs?: string;
  preheaderEn?: string;
  preheaderEs?: string;
  allowedVariables: string[];
  /** Solo si `channels` incluye "email" — construye el cuerpo HTML enriquecido (EmailShell). */
  buildEmailBody?: EmailBodyBuilder;
}

// ─── Shapes de email reutilizables ────────────────────────────────────────────

function simpleShape(headline: (v: Record<string, string>) => string, paragraph: (v: Record<string, string>) => string, ctaLabel?: (v: Record<string, string>) => string): EmailBodyBuilder {
  return (vars, _locale, ctx) => {
    const h = headline(vars);
    const p = paragraph(vars);
    const rows = heroBlock({ headline: h }) + contentBlock(`<p style="margin:0 0 8px;">${escapeHtml(p)}</p>`) +
      (ctaLabel && ctx.deepLinkUrl ? `<tr><td style="padding:0 32px;">${ctaButton(ctaLabel(vars), ctx.deepLinkUrl)}</td></tr>` : "");
    return { rows, paragraphs: [p], headline: h };
  };
}

// ─── Utilidades de interpolación ──────────────────────────────────────────────

function interpolate(text: string | undefined, allowedVariables: string[], vars: Record<string, string>): string {
  if (!text) return "";
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!allowedVariables.includes(key)) return match;
    return vars[key] ?? match;
  });
}

export interface RenderedTemplate {
  titleEn: string;
  titleEs: string;
  bodyEn: string;
  bodyEs: string;
  deepLink: string | null;
  subjectEn?: string;
  subjectEs?: string;
  emailHtmlEn?: string | null;
  emailHtmlEs?: string | null;
  emailTextEn?: string | null;
  emailTextEs?: string | null;
}

// ─── Catálogo ──────────────────────────────────────────────────────────────────

export const ENGAGEMENT_TEMPLATES: Record<string, EngagementTemplate> = {
  // ── ACCOUNT ──────────────────────────────────────────────────────────────
  account_welcome: {
    key: "account_welcome", version: 1, category: "account", adminCategory: "ACCOUNT",
    audienceType: "transactional", channels: ["in_app", "email"], status: "active",
    description: "Bienvenida al registrarse un estudiante nuevo.", triggerEvent: "StudentRegistered",
    titleEn: "You're in ✦", titleEs: "Ya estás dentro de SEGOLIFE ✦",
    bodyEn: "Welcome, {{studentFirstName}}.", bodyEs: "Bienvenido/a, {{studentFirstName}}.",
    subjectEn: "You're in ✦", subjectEs: "Ya estás dentro de SEGOLIFE ✦",
    preheaderEn: "Events, SegoTokens, benefits — all in one place.", preheaderEs: "Eventos, SegoTokens, beneficios — todo en un sitio.",
    allowedVariables: ["studentFirstName"],
    buildEmailBody: simpleShape(
      v => `Hi, ${v.studentFirstName || ""}.`.trim(),
      () => "You already have an account. Discover events, earn SegoTokens, unlock benefits at real venues.",
      () => "Enter SEGOLIFE",
    ),
  },
  profile_incomplete: {
    key: "profile_incomplete", version: 1, category: "account", adminCategory: "ACCOUNT",
    audienceType: "marketing", channels: ["in_app", "email"], status: "active",
    description: "Nudge si el perfil sigue incompleto 24-48h después del alta.", triggerEvent: "ProfileIncomplete (job programado, no inmediato)",
    titleEn: "Finish your profile", titleEs: "Completa tu perfil",
    bodyEn: "A couple of details left.", bodyEs: "Te faltan un par de datos.",
    subjectEn: "Two minutes to finish your profile", subjectEs: "Dos minutos para completar tu perfil",
    allowedVariables: [],
    buildEmailBody: simpleShape(
      () => "Almost there",
      () => "Finishing your profile helps us recommend the right events and benefits for you.",
      () => "Complete profile",
    ),
  },

  // ── SECURITY ─────────────────────────────────────────────────────────────
  password_reset_requested: {
    key: "password_reset_requested", version: 1, category: "account", adminCategory: "SECURITY",
    audienceType: "transactional", channels: ["email"], status: "active",
    description: "Enlace para restablecer contraseña — nunca in-app (el usuario no está logueado).", triggerEvent: "PasswordResetRequested",
    titleEn: "Reset your password", titleEs: "Recupera tu contraseña",
    bodyEn: "Use the button to set a new password.", bodyEs: "Usa el botón para elegir una nueva contraseña.",
    subjectEn: "Reset your SEGOLIFE password", subjectEs: "Recupera tu contraseña de SEGOLIFE",
    preheaderEn: "This link expires in {{expiryMinutes}} minutes.", preheaderEs: "Este enlace caduca en {{expiryMinutes}} minutos.",
    allowedVariables: ["expiryMinutes"],
    buildEmailBody: (vars, _locale, ctx) => {
      const headline = "Reset your password";
      const p1 = `This link expires in ${vars.expiryMinutes || "60"} minutes.`;
      const p2 = "If you didn't request this, you can safely ignore this email.";
      const rows = heroBlock({ headline }) +
        contentBlock(`<p style="margin:0 0 8px;">${escapeHtml(p1)}</p>`) +
        (ctx.deepLinkUrl ? `<tr><td style="padding:0 32px;">${ctaButton("Set new password", ctx.deepLinkUrl)}</td></tr>` : "") +
        infoBox(escapeHtml(p2));
      return { rows, paragraphs: [p1, p2], headline };
    },
  },
  password_changed: {
    key: "password_changed", version: 1, category: "account", adminCategory: "SECURITY",
    audienceType: "transactional", channels: ["email"], status: "active",
    description: "Confirmación de seguridad tras cambiar la contraseña.", triggerEvent: "PasswordChanged",
    titleEn: "Your password was changed", titleEs: "Tu contraseña ha sido cambiada",
    bodyEn: "If this wasn't you, contact support or reset it again.", bodyEs: "Si no fuiste tú, contacta con soporte o vuelve a restablecerla.",
    subjectEn: "Your SEGOLIFE password was changed", subjectEs: "Tu contraseña de SEGOLIFE ha cambiado",
    allowedVariables: [],
    buildEmailBody: simpleShape(
      () => "Password changed",
      () => "Your password was just changed. If this wasn't you, reset it again immediately.",
    ),
  },

  // ── COMMUNITY ────────────────────────────────────────────────────────────
  community_announcement: {
    key: "community_announcement", version: 1, category: "promotions", adminCategory: "COMMUNITY",
    audienceType: "marketing", channels: ["in_app", "email"], status: "active",
    description: "Anuncio importante del administrador de una comunidad (no COMUNITY encuestas — eso ya existe aparte).", triggerEvent: "ManualAnnouncement (admin)",
    titleEn: "{{title}}", titleEs: "{{title}}",
    bodyEn: "{{message}}", bodyEs: "{{message}}",
    subjectEn: "{{title}}", subjectEs: "{{title}}",
    allowedVariables: ["title", "message"],
    buildEmailBody: (vars, _locale, ctx) => {
      const headline = vars.title || "";
      const p = vars.message || "";
      const rows = heroBlock({ headline, eyebrow: "SEGOLIFE" }) + contentBlock(`<p style="margin:0;">${escapeHtml(p)}</p>`) +
        (ctx.deepLinkUrl ? `<tr><td style="padding:0 32px;">${secondaryButton("View", ctx.deepLinkUrl)}</td></tr>` : "");
      return { rows, paragraphs: [p], headline };
    },
  },

  // ── TICKETING ────────────────────────────────────────────────────────────
  ticket_purchased: {
    key: "ticket_purchased", version: 1, category: "events", adminCategory: "TICKETING",
    audienceType: "transactional", channels: ["in_app", "email"], status: "active",
    description: "Confirmación de compra de entrada.", triggerEvent: "TicketPurchased",
    titleEn: "Your ticket is ready 🎟️", titleEs: "Tu entrada está lista 🎟️",
    bodyEn: "{{eventName}} — {{venueName}}", bodyEs: "{{eventName}} — {{venueName}}",
    subjectEn: "Your ticket is ready 🎟️", subjectEs: "Tu entrada está lista 🎟️",
    preheaderEn: "See you at {{venueName}}.", preheaderEs: "Nos vemos en {{venueName}}.",
    allowedVariables: ["eventName", "venueName", "dateLabel", "timeLabel", "ticketTypeName", "quantity", "totalAmountLabel", "orderReference"],
    buildEmailBody: (vars, _locale, ctx) => {
      const headline = "Your ticket is ready";
      const rows = heroBlock({ headline }) +
        eventCard({ eventName: vars.eventName || "", venueName: vars.venueName || "", dateLabel: vars.dateLabel || "", timeLabel: vars.timeLabel }) +
        contentBlock(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13.5px;color:#6B6480;">
          <tr><td style="padding:2px 0;">${escapeHtml(vars.ticketTypeName || "")} × ${escapeHtml(vars.quantity || "1")}</td><td align="right">${escapeHtml(vars.totalAmountLabel || "")}</td></tr>
          <tr><td style="padding:2px 0;" colspan="2">Order ${escapeHtml(vars.orderReference || "")}</td></tr>
        </table>`) +
        (ctx.deepLinkUrl ? `<tr><td style="padding:0 32px;">${ctaButton("View my ticket", ctx.deepLinkUrl)}</td></tr>` : "");
      return { rows, paragraphs: [`${vars.eventName} — ${vars.venueName}`, `${vars.ticketTypeName} × ${vars.quantity} — ${vars.totalAmountLabel}`], headline };
    },
  },
  // SEGOLIFE — Native Ticket Sales (spec §31): `order_refunded`/`ticket_checked_in`
  // ya se emitían desde checkoutService.ts/ticketCancellationService.ts/
  // nativeCheckinService.ts sin ningún listener conectado (mismo "fires into
  // the void" que ticketPurchasedListener.ts ya corrigió para
  // ticket_purchased) — solo in_app, spec explícito: "NO implementar SMTP/
  // Brevo en esta fase".
  order_refunded: {
    key: "order_refunded", version: 1, category: "events", adminCategory: "TICKETING",
    audienceType: "transactional", channels: ["in_app"], status: "active",
    description: "Reembolso de un pedido de entradas confirmado.", triggerEvent: "OrderRefunded",
    titleEn: "Your refund is confirmed", titleEs: "Tu reembolso está confirmado",
    bodyEn: "{{eventName}} — {{amountLabel}}", bodyEs: "{{eventName}} — {{amountLabel}}",
    allowedVariables: ["eventName", "venueName", "amountLabel", "orderReference"],
  },
  ticket_checked_in: {
    key: "ticket_checked_in", version: 1, category: "events", adminCategory: "TICKETING",
    audienceType: "transactional", channels: ["in_app"], status: "active",
    description: "Confirmación de check-in validado en puerta.", triggerEvent: "TicketCheckedIn",
    titleEn: "You're checked in! 🎉", titleEs: "¡Ya estás dentro! 🎉",
    bodyEn: "{{eventName}} — {{venueName}}", bodyEs: "{{eventName}} — {{venueName}}",
    allowedVariables: ["eventName", "venueName"],
  },
  event_reminder_24h: {
    key: "event_reminder_24h", version: 1, category: "events", adminCategory: "EVENTS",
    audienceType: "transactional", channels: ["in_app", "email"], status: "active",
    description: "Recordatorio 24h antes, solo para quien tiene entrada.", triggerEvent: "EventReminder24h (job programado)",
    titleEn: "Tomorrow: {{eventName}}", titleEs: "Mañana: {{eventName}}",
    bodyEn: "{{venueName}}", bodyEs: "{{venueName}}",
    subjectEn: "Tomorrow this happens at {{venueName}}", subjectEs: "Mañana pasa esto en {{venueName}}",
    allowedVariables: ["eventName", "venueName", "dateLabel", "timeLabel"],
    buildEmailBody: (vars, _locale, ctx) => {
      const headline = `Tomorrow: ${vars.eventName || ""}`;
      const rows = heroBlock({ headline }) + eventCard({ eventName: vars.eventName || "", venueName: vars.venueName || "", dateLabel: vars.dateLabel || "", timeLabel: vars.timeLabel }) +
        (ctx.deepLinkUrl ? `<tr><td style="padding:0 32px;">${ctaButton("View ticket", ctx.deepLinkUrl)}</td></tr>` : "");
      return { rows, paragraphs: [`${vars.eventName} — ${vars.venueName}`], headline };
    },
  },
  event_updated: {
    key: "event_updated", version: 1, category: "events", adminCategory: "EVENTS",
    audienceType: "transactional", channels: ["in_app", "email"], status: "active",
    description: "Solo cambios materiales (fecha/hora/venue) — nunca ediciones menores.", triggerEvent: "EventUpdated (cambio material detectado)",
    titleEn: "{{eventName}} has changed", titleEs: "{{eventName}} ha cambiado",
    bodyEn: "{{changeDescription}}", bodyEs: "{{changeDescription}}",
    subjectEn: "Important update: {{eventName}}", subjectEs: "Cambio importante: {{eventName}}",
    allowedVariables: ["eventName", "changeDescription"],
    buildEmailBody: (vars, _locale, ctx) => {
      const headline = `${vars.eventName || ""} has changed`;
      const p = vars.changeDescription || "";
      const rows = heroBlock({ headline }) + alertBox(escapeHtml(p)) +
        (ctx.deepLinkUrl ? `<tr><td style="padding:0 32px;">${ctaButton("View event", ctx.deepLinkUrl)}</td></tr>` : "");
      return { rows, paragraphs: [p], headline };
    },
  },
  event_cancelled: {
    key: "event_cancelled", version: 1, category: "events", adminCategory: "EVENTS",
    audienceType: "transactional", channels: ["in_app", "email"], status: "active",
    description: "Cancelación de evento — nunca prometer refund si no está confirmado.", triggerEvent: "EventCancelled",
    titleEn: "{{eventName}} has been cancelled", titleEs: "{{eventName}} ha sido cancelado",
    bodyEn: "{{refundInfo}}", bodyEs: "{{refundInfo}}",
    subjectEn: "Cancelled: {{eventName}}", subjectEs: "Cancelado: {{eventName}}",
    allowedVariables: ["eventName", "refundInfo"],
    buildEmailBody: (vars, _locale, ctx) => {
      const headline = `${vars.eventName || ""} has been cancelled`;
      const p = vars.refundInfo || "";
      const rows = heroBlock({ headline }) + alertBox(escapeHtml(p)) +
        (ctx.deepLinkUrl ? `<tr><td style="padding:0 32px;">${secondaryButton("More info", ctx.deepLinkUrl)}</td></tr>` : "");
      return { rows, paragraphs: [p], headline };
    },
  },

  // ── SEGOTOKENS ───────────────────────────────────────────────────────────
  tokens_earned_relevant: {
    key: "tokens_earned_relevant", version: 1, category: "rewards", adminCategory: "SEGOTOKENS",
    audienceType: "transactional", channels: ["in_app", "email"], status: "active",
    description: "Solo montos relevantes/bonus/threshold — NO cada movimiento diminuto (política del llamador, no de la plantilla).", triggerEvent: "TokensEarned (filtrado por relevancia)",
    titleEn: "+{{amountLabel}} SegoTokens for you", titleEs: "+{{amountLabel}} SegoTokens para ti",
    bodyEn: "{{reason}}", bodyEs: "{{reason}}",
    subjectEn: "+{{amountLabel}} SegoTokens for you", subjectEs: "+{{amountLabel}} SegoTokens para ti",
    allowedVariables: ["amountLabel", "reason", "balanceLabel"],
    buildEmailBody: (vars, _locale, ctx) => {
      const headline = `+${vars.amountLabel || ""} SegoTokens`;
      const rows = heroBlock({ headline }) + tokensCard({ amountLabel: `+${vars.amountLabel || ""} ST`, reason: vars.reason || "", balanceLabel: vars.balanceLabel || "" }) +
        (ctx.deepLinkUrl ? `<tr><td style="padding:0 32px;">${ctaButton("View my SegoTokens", ctx.deepLinkUrl)}</td></tr>` : "");
      return { rows, paragraphs: [vars.reason || "", vars.balanceLabel || ""], headline };
    },
  },
  tokens_adjusted_admin: {
    key: "tokens_adjusted_admin", version: 1, category: "rewards", adminCategory: "SEGOTOKENS",
    audienceType: "transactional", channels: ["in_app", "email"], status: "active",
    description: "Ajuste manual de saldo por un admin — siempre con motivo.", triggerEvent: "TokensAdjustedAdmin",
    titleEn: "Your SegoTokens balance was adjusted", titleEs: "Tu saldo de SegoTokens se ha ajustado",
    bodyEn: "{{amountLabel}} — {{reason}}", bodyEs: "{{amountLabel}} — {{reason}}",
    subjectEn: "Your SegoTokens balance was adjusted", subjectEs: "Ajuste en tu saldo de SegoTokens",
    allowedVariables: ["amountLabel", "reason", "balanceLabel"],
    buildEmailBody: (vars, _locale, ctx) => {
      const headline = "Balance adjusted";
      const rows = heroBlock({ headline }) + tokensCard({ amountLabel: vars.amountLabel || "", reason: vars.reason || "", balanceLabel: vars.balanceLabel || "" }) +
        (ctx.deepLinkUrl ? `<tr><td style="padding:0 32px;">${secondaryButton("View my SegoTokens", ctx.deepLinkUrl)}</td></tr>` : "");
      return { rows, paragraphs: [vars.reason || ""], headline };
    },
  },

  // ── BENEFITS ─────────────────────────────────────────────────────────────
  benefit_granted: {
    key: "benefit_granted", version: 2, category: "benefits", adminCategory: "BENEFITS",
    audienceType: "transactional", channels: ["in_app", "email"], status: "active",
    description: "Beneficio nuevo desbloqueado. v2: añade subject/email real — v1 solo entregaba in-app pese a declarar el canal.", triggerEvent: "BenefitGranted",
    titleEn: "You unlocked a benefit", titleEs: "Has desbloqueado un beneficio",
    bodyEn: "{{benefitName}}", bodyEs: "{{benefitName}}",
    subjectEn: "You unlocked something new 🎁", subjectEs: "Has desbloqueado algo nuevo 🎁",
    allowedVariables: ["benefitName", "venueName", "expiryLabel"],
    buildEmailBody: (vars, _locale, ctx) => {
      const headline = "You unlocked something new";
      const rows = heroBlock({ headline }) + benefitCard({ benefitName: vars.benefitName || "", venueName: vars.venueName, expiryLabel: vars.expiryLabel }) +
        (ctx.deepLinkUrl ? `<tr><td style="padding:0 32px;">${ctaButton("Use benefit", ctx.deepLinkUrl)}</td></tr>` : "");
      return { rows, paragraphs: [vars.benefitName || ""], headline };
    },
  },
  benefit_expiring: {
    key: "benefit_expiring", version: 2, category: "benefits", adminCategory: "BENEFITS",
    audienceType: "transactional", channels: ["in_app", "email"], status: "active",
    description: "Aviso de caducidad próxima. v2: añade email (v1 era solo in-app).", triggerEvent: "BenefitExpiring (job programado)",
    titleEn: "A benefit is about to expire", titleEs: "Un beneficio está a punto de caducar",
    bodyEn: "{{benefitName}} expires soon — use it before it's gone.", bodyEs: "{{benefitName}} caduca pronto — úsalo antes de que se pierda.",
    subjectEn: "Your benefit expires soon", subjectEs: "Tu beneficio caduca pronto",
    allowedVariables: ["benefitName", "expiryLabel"],
    buildEmailBody: (vars, _locale, ctx) => {
      const headline = "Expiring soon";
      const rows = heroBlock({ headline }) + benefitCard({ benefitName: vars.benefitName || "", expiryLabel: vars.expiryLabel }) +
        (ctx.deepLinkUrl ? `<tr><td style="padding:0 32px;">${ctaButton("Use before it expires", ctx.deepLinkUrl)}</td></tr>` : "");
      return { rows, paragraphs: [vars.benefitName || ""], headline };
    },
  },

  // ── PLAN & PLAY (preparado, spec punto 50 lo pide activo en catálogo) ────
  planplay_new_poll: {
    key: "planplay_new_poll", version: 1, category: "events", adminCategory: "PLAN_AND_PLAY",
    audienceType: "marketing", channels: ["in_app", "email"], status: "active",
    description: "Nueva votación Plan & Play — catalogado y con wiring de evento preparado aunque Plan & Play como producto no esté 100% activo.", triggerEvent: "PlanPlayNewPoll",
    titleEn: "We want your take 👀", titleEs: "SEGOLIFE quiere saber qué opinas 👀",
    bodyEn: "{{pollTitle}}", bodyEs: "{{pollTitle}}",
    subjectEn: "We want your take 👀", subjectEs: "SEGOLIFE quiere saber qué opinas 👀",
    allowedVariables: ["pollTitle"],
    buildEmailBody: simpleShape(v => v.pollTitle || "", () => "Your answer takes 10 seconds and shapes what happens next.", () => "Vote"),
  },
  planplay_converted_event: {
    key: "planplay_converted_event", version: 1, category: "events", adminCategory: "PLAN_AND_PLAY",
    audienceType: "transactional", channels: ["in_app", "email"], status: "active",
    description: "Una propuesta votada se convirtió en evento real.", triggerEvent: "PlanPlayConvertedEvent",
    titleEn: "You asked for it. It's here.", titleEs: "Lo pedisteis. Ya está aquí.",
    bodyEn: "{{eventName}}", bodyEs: "{{eventName}}",
    subjectEn: "You asked for it. It's here.", subjectEs: "Lo pedisteis. Ya está aquí.",
    allowedVariables: ["eventName"],
    buildEmailBody: simpleShape(() => "It's happening", v => v.eventName || "", () => "View event"),
  },

  // ── V2 / PREPARADO — catalogados con contenido real, sin listener conectado (spec punto 51) ──
  payment_failed: {
    key: "payment_failed", version: 1, category: "events", adminCategory: "TICKETING",
    audienceType: "transactional", channels: ["email"], status: "prepared",
    description: "Requiere un PaymentProvider real configurado — no activar sin él.", triggerEvent: "PaymentFailed (preparado, sin PaymentProvider real todavía)",
    titleEn: "Your payment didn't go through", titleEs: "Tu pago no se ha completado",
    bodyEn: "{{eventName}} — try again to secure your spot.", bodyEs: "{{eventName}} — inténtalo de nuevo para asegurar tu plaza.",
    subjectEn: "Payment issue — {{eventName}}", subjectEs: "Problema con el pago — {{eventName}}",
    allowedVariables: ["eventName"],
    buildEmailBody: simpleShape(() => "Payment issue", v => `${v.eventName || ""} — try again to secure your spot.`, () => "Try again"),
  },
  ticket_refunded: {
    key: "ticket_refunded", version: 1, category: "events", adminCategory: "TICKETING",
    audienceType: "transactional", channels: ["in_app", "email"], status: "prepared",
    description: "Confirmación de reembolso ejecutado.", triggerEvent: "TicketRefunded",
    titleEn: "Your ticket was refunded", titleEs: "Tu entrada ha sido reembolsada",
    bodyEn: "{{eventName}} — {{amountLabel}}", bodyEs: "{{eventName}} — {{amountLabel}}",
    subjectEn: "Refund confirmed — {{eventName}}", subjectEs: "Reembolso confirmado — {{eventName}}",
    allowedVariables: ["eventName", "amountLabel"],
    buildEmailBody: simpleShape(() => "Refund confirmed", v => `${v.eventName || ""} — ${v.amountLabel || ""}`),
  },
  event_thank_you: {
    key: "event_thank_you", version: 1, category: "events", adminCategory: "EVENTS",
    audienceType: "marketing", channels: ["email"], status: "prepared",
    description: "Después del evento — evitar spam, no enviar siempre.", triggerEvent: "EventThankYou (post-evento, política pendiente)",
    titleEn: "Thanks for coming to {{eventName}}", titleEs: "Gracias por venir a {{eventName}}",
    bodyEn: "See what's next.", bodyEs: "Mira qué viene ahora.",
    subjectEn: "Thanks for coming 🙌", subjectEs: "Gracias por venir 🙌",
    allowedVariables: ["eventName"],
    buildEmailBody: simpleShape(v => `Thanks for coming to ${v.eventName || ""}`, () => "See what's next.", () => "Discover events"),
  },
  tokens_expiring: {
    key: "tokens_expiring", version: 1, category: "rewards", adminCategory: "SEGOTOKENS",
    audienceType: "transactional", channels: ["in_app", "email"], status: "prepared",
    description: "Requiere que exista expiración real de SegoTokens en el motor.", triggerEvent: "TokensExpiring (requiere expiración implementada en tokenEngine)",
    titleEn: "{{amountLabel}} SegoTokens expire in {{daysLabel}} days", titleEs: "{{amountLabel}} SegoTokens caducan en {{daysLabel}} días",
    bodyEn: "Use them before they're gone.", bodyEs: "Úsalos antes de que se pierdan.",
    subjectEn: "Your SegoTokens are expiring soon", subjectEs: "Tus SegoTokens caducan pronto",
    allowedVariables: ["amountLabel", "daysLabel"],
    buildEmailBody: simpleShape(v => `${v.amountLabel || ""} SegoTokens expire in ${v.daysLabel || ""} days`, () => "Use them before they're gone.", () => "View my SegoTokens"),
  },
  token_milestone: {
    key: "token_milestone", version: 1, category: "rewards", adminCategory: "SEGOTOKENS",
    audienceType: "marketing", channels: ["in_app", "email"], status: "prepared",
    description: "Gamificación — hito de saldo alcanzado.", triggerEvent: "TokenMilestone",
    titleEn: "You reached {{milestoneLabel}} SegoTokens", titleEs: "Has llegado a {{milestoneLabel}} SegoTokens",
    bodyEn: "Nice one.", bodyEs: "Bien jugado.",
    subjectEn: "Milestone unlocked 🏆", subjectEs: "Hito desbloqueado 🏆",
    allowedVariables: ["milestoneLabel"],
    buildEmailBody: simpleShape(v => `You reached ${v.milestoneLabel || ""} SegoTokens`, () => "Nice one."),
  },
  benefit_redeemed: {
    key: "benefit_redeemed", version: 1, category: "benefits", adminCategory: "BENEFITS",
    audienceType: "transactional", channels: ["in_app"], status: "prepared",
    description: "Confirmación de canje — deliberadamente solo in-app para evitar spam (spec punto 19).", triggerEvent: "BenefitRedeemed",
    titleEn: "Benefit redeemed", titleEs: "Beneficio canjeado",
    bodyEn: "{{benefitName}}", bodyEs: "{{benefitName}}",
    allowedVariables: ["benefitName"],
  },
  venue_recommendation: {
    key: "venue_recommendation", version: 1, category: "promotions", adminCategory: "COMMUNITY",
    audienceType: "marketing", channels: ["in_app", "email"], status: "prepared",
    description: "Recomendación de venue segmentada — nunca automática por existir el venue.", triggerEvent: "VenueRecommendation (campaña manual)",
    titleEn: "Tonight at {{venueName}}", titleEs: "Esta noche en {{venueName}}",
    bodyEn: "Worth checking out.", bodyEs: "Merece la pena.",
    subjectEn: "Tonight: {{venueName}}", subjectEs: "Esta noche: {{venueName}}",
    allowedVariables: ["venueName"],
    buildEmailBody: simpleShape(v => `Tonight at ${v.venueName || ""}`, () => "Worth checking out."),
  },
  planplay_flash: {
    key: "planplay_flash", version: 1, category: "events", adminCategory: "PLAN_AND_PLAY",
    audienceType: "marketing", channels: ["in_app"], status: "prepared",
    description: "Votación urgente — solo in-app por naturaleza (ventana muy corta).", triggerEvent: "PlanPlayFlash",
    titleEn: "Only {{minutesLabel}} minutes to vote", titleEs: "Solo tienes {{minutesLabel}} minutos para votar",
    bodyEn: "{{pollTitle}}", bodyEs: "{{pollTitle}}",
    allowedVariables: ["minutesLabel", "pollTitle"],
  },
  planplay_result: {
    key: "planplay_result", version: 1, category: "events", adminCategory: "PLAN_AND_PLAY",
    audienceType: "marketing", channels: ["in_app"], status: "prepared",
    description: "Resultado de una votación cerrada.", triggerEvent: "PlanPlayResult",
    titleEn: "{{percentageLabel}} said yes", titleEs: "El {{percentageLabel}} dijo que sí",
    bodyEn: "{{pollTitle}}", bodyEs: "{{pollTitle}}",
    allowedVariables: ["percentageLabel", "pollTitle"],
  },
  planplay_proposal_approved: {
    key: "planplay_proposal_approved", version: 1, category: "events", adminCategory: "PLAN_AND_PLAY",
    audienceType: "transactional", channels: ["in_app"], status: "prepared",
    description: "Idea de estudiante aprobada — hoy communityStudentProposalDb.ts no lo dispara (hueco real detectado en auditoría).", triggerEvent: "StudentProposalApproved",
    titleEn: "Your idea was approved", titleEs: "Tu propuesta ha sido aprobada",
    bodyEn: "{{proposalTitle}}", bodyEs: "{{proposalTitle}}",
    allowedVariables: ["proposalTitle"],
  },

  // Pre-16.1 — pago presencial con SegoTokens (TPV/puerta): un operador
  // solicitó, el Student debe confirmar/rechazar. Solo in_app — es una
  // acción urgente mientras el Student está físicamente en el venue, un
  // email nunca llegaría a tiempo. El cuerpo es deliberadamente genérico
  // (sin desglose de importes): el detalle completo y en vivo (nombre del
  // venue, tokens/valor/restante/saldo antes-después) se lee siempre del
  // propio tRPC al abrir la pantalla vía deepLink, nunca se congela en el
  // texto de la notificación.
  token_payment_requested: {
    key: "token_payment_requested", version: 1, category: "account", adminCategory: "SEGOTOKENS",
    audienceType: "transactional", channels: ["in_app"], status: "active",
    description: "Un operador de venue solicitó pagar parte de una compra con SegoTokens — requiere confirmación del Student.", triggerEvent: "TokenPaymentRequested",
    titleEn: "Confirm your SegoTokens payment", titleEs: "Confirma tu pago con SegoTokens",
    bodyEn: "{{venueName}} is requesting {{requestedTokens}} ST. Tap to review and confirm.", bodyEs: "{{venueName}} solicita {{requestedTokens}} ST. Toca para revisar y confirmar.",
    allowedVariables: ["venueName", "requestedTokens"],
  },

  // ── Pre-existentes (Fase 7 original) — sin tocar contenido, solo se les añade adminCategory/status ──
  recurrence_progress: {
    key: "recurrence_progress", version: 1, category: "rewards", adminCategory: "SEGOTOKENS",
    audienceType: "transactional", channels: ["in_app"], status: "active",
    description: "Progreso hacia un bonus por recurrencia de visitas.", triggerEvent: "RecurrenceProgress",
    titleEn: "You're close to a bonus", titleEs: "Estás cerca de un bonus",
    bodyEn: "One more visit to unlock +{{bonusAmount}} SegoTokens", bodyEs: "Una visita más para desbloquear +{{bonusAmount}} SegoTokens",
    allowedVariables: ["bonusAmount"],
  },
  event_tonight: {
    key: "event_tonight", version: 1, category: "events", adminCategory: "EVENTS",
    audienceType: "marketing", channels: ["in_app"], status: "active",
    description: "Recordatorio del mismo día.", triggerEvent: "EventToday",
    titleEn: "Tonight: {{eventName}}", titleEs: "Esta noche: {{eventName}}",
    bodyEn: "Don't miss it — check it out in Explore.", bodyEs: "No te lo pierdas — míralo en Explorar.",
    allowedVariables: ["eventName"],
  },
  community_proposal_published: {
    key: "community_proposal_published", version: 1, category: "events", adminCategory: "COMMUNITY",
    audienceType: "transactional", channels: ["in_app"], status: "active",
    description: "Publicación de una propuesta COMUNITY nueva.", triggerEvent: "CommunityProposalPublished",
    titleEn: "🔥 New question in COMUNITY", titleEs: "🔥 Nueva pregunta en COMUNITY",
    bodyEn: "{{title}}", bodyEs: "{{title}}",
    allowedVariables: ["title"],
  },
  community_interested_event_published: {
    key: "community_interested_event_published", version: 1, category: "events", adminCategory: "COMMUNITY",
    audienceType: "transactional", channels: ["in_app"], status: "active",
    description: "El evento convertido desde una propuesta COMUNITY ya se publicó.", triggerEvent: "CommunityInterestedEventPublished",
    titleEn: "You asked for it. It's here.", titleEs: "Lo pedisteis. Ya está aquí.",
    bodyEn: "{{eventName}}", bodyEs: "{{eventName}}",
    allowedVariables: ["eventName"],
  },
};

/**
 * `varsEs` es opcional — si se omite, se reutiliza `vars` (la mayoría de
 * variables, como cantidades o fechas, son iguales en ambos idiomas; solo
 * hace falta `varsEs` cuando la variable en sí es un texto traducido, p.ej.
 * el nombre de un beneficio con name_en/name_es distintos).
 *
 * `preferencesUrl` solo se usa para plantillas `audienceType: "marketing"` —
 * transactional nunca necesita link de baja (spec punto 45/60).
 */
export function renderTemplate(templateKey: string, vars: Record<string, string>, deepLink?: string | null, varsEs?: Record<string, string>, preferencesUrl?: string | null): RenderedTemplate {
  const template = ENGAGEMENT_TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown engagement template: ${templateKey}`);

  const safeDeepLink = sanitizeDeepLink(deepLink);
  const varsFinal = { ...vars };
  const varsEsFinal = varsEs ?? vars;

  const titleEn = interpolate(template.titleEn, template.allowedVariables, varsFinal);
  const titleEs = interpolate(template.titleEs, template.allowedVariables, varsEsFinal);

  const result: RenderedTemplate = {
    titleEn,
    titleEs,
    bodyEn: interpolate(template.bodyEn, template.allowedVariables, varsFinal),
    bodyEs: interpolate(template.bodyEs, template.allowedVariables, varsEsFinal),
    deepLink: safeDeepLink,
    // Fallback al título YA interpolado (nunca al texto crudo de la plantilla,
    // que podría contener placeholders {{var}} sin sustituir).
    subjectEn: template.subjectEn ? interpolate(template.subjectEn, template.allowedVariables, varsFinal) : titleEn,
    subjectEs: template.subjectEs ? interpolate(template.subjectEs, template.allowedVariables, varsEsFinal) : titleEs,
  };

  if (template.channels.includes("email") && template.buildEmailBody) {
    const preheaderEn = template.preheaderEn ? interpolate(template.preheaderEn, template.allowedVariables, varsFinal) : "";
    const preheaderEs = template.preheaderEs ? interpolate(template.preheaderEs, template.allowedVariables, varsEsFinal) : "";
    const prefsUrl = template.audienceType === "marketing" ? (preferencesUrl ?? null) : null;

    // Fase 16 (auditoría) — `safeDeepLink` es SIEMPRE relativo (sanitizeDeepLink
    // lo exige, es una whitelist anti-phishing). Correcto para deep links
    // in-app (push/notificaciones dentro de la propia SPA), pero un email no
    // tiene "origen actual" contra el que resolver una URL relativa — un
    // href="/ie/explore" en un cliente de correo no navega a ningún sitio.
    // Ningún llamador de renderTemplate() en todo el repo absolutizaba esto
    // antes de este fix — el botón CTA de CUALQUIER plantilla (incluida
    // password_reset_requested) quedaba con un href relativo roto en email.
    const emailDeepLinkUrl = safeDeepLink ? `${canonicalBaseUrl()}${safeDeepLink}` : null;
    const en = template.buildEmailBody(varsFinal, "en", { deepLinkUrl: emailDeepLinkUrl, preferencesUrl: prefsUrl });
    const es = template.buildEmailBody(varsEsFinal, "es", { deepLinkUrl: emailDeepLinkUrl, preferencesUrl: prefsUrl });

    result.emailHtmlEn = renderEmailShell({ locale: "en", preheader: preheaderEn || result.subjectEn!, bodyRows: en.rows, preferencesUrl: prefsUrl });
    result.emailHtmlEs = renderEmailShell({ locale: "es", preheader: preheaderEs || result.subjectEs!, bodyRows: es.rows, preferencesUrl: prefsUrl });
    result.emailTextEn = renderPlainText({ locale: "en", headline: en.headline, paragraphs: en.paragraphs, preferencesUrl: prefsUrl });
    result.emailTextEs = renderPlainText({ locale: "es", headline: es.headline, paragraphs: es.paragraphs, preferencesUrl: prefsUrl });
  }

  return result;
}
