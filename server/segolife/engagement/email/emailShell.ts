/**
 * emailShell.ts — sistema de diseño de email SEGOLIFE (Communication Center).
 *
 * Reglas de esta capa (nunca romperlas):
 *  - Compatibilidad de email real: tablas, inline styles, sin CSS moderno
 *    (grid/flex), sin JS, sin fuentes externas críticas, contenedor 600px.
 *  - NUNCA importar/usar server/emailTemplates.ts (branding Náyade/Skicenter)
 *    — este archivo es la única fuente de HTML de email para comunicaciones
 *    SEGOLIFE nuevas.
 *  - Cada builder devuelve HTML puro (string) — nunca ejecuta ni interpola
 *    sin escapar; usar `escapeHtml()` en cualquier texto de origen usuario
 *    (nombre de estudiante, etc.) antes de pasarlo aquí.
 *  - Cada builder de contenido (`renderEmailShell`) también expone una
 *    versión texto plano razonable, no un strip-HTML mecánico.
 *
 * Identidad visual: violeta/lila sobre negro/blanco, estética nightlife/
 * university lifestyle premium — ver docs/engagement/communication-center.md.
 */
import { canonicalBaseUrl } from "../../../_core/canonicalHost";

// ─── Tokens ──────────────────────────────────────────────────────────────────

export const EMAIL_TOKENS = {
  ink: "#120B22", // negro con matiz violeta — cabecera/pie
  violet: "#6D28D9", // acento principal
  violetDark: "#4C1D95", // hover/borde de botón
  lilac: "#E9E1FA", // fondo de card suave
  lilacLine: "#D9CCF4", // borde de card
  white: "#FFFFFF",
  paper: "#F6F3FC", // fondo fuera del contenedor (fuera del control del cliente de correo, pero se declara)
  text: "#1D1730", // texto principal, casi negro con matiz violeta
  textMuted: "#6B6480", // texto secundario
  danger: "#B3261E",
  successBg: "#EFEAFB",
} as const;

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** Escapa cualquier texto de origen usuario antes de interpolarlo en HTML — nunca confiar en el llamador. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Componentes ─────────────────────────────────────────────────────────────

export function ctaButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:10px;background:${EMAIL_TOKENS.violet};">
    <a href="${url}" style="display:inline-block;padding:14px 28px;font-family:${FONT_STACK};font-size:16px;font-weight:700;color:${EMAIL_TOKENS.white};text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

export function secondaryButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:10px;border:1px solid ${EMAIL_TOKENS.violet};">
    <a href="${url}" style="display:inline-block;padding:12px 26px;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:${EMAIL_TOKENS.violet};text-decoration:none;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

export function heroBlock(opts: { eyebrow?: string; headline: string; subtext?: string }): string {
  return `<tr><td style="padding:8px 32px 4px;">
    ${opts.eyebrow ? `<p style="margin:0 0 8px;font-family:${FONT_STACK};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_TOKENS.violet};">${escapeHtml(opts.eyebrow)}</p>` : ""}
    <h1 style="margin:0 0 12px;font-family:${FONT_STACK};font-size:24px;line-height:1.3;font-weight:800;color:${EMAIL_TOKENS.text};">${escapeHtml(opts.headline)}</h1>
    ${opts.subtext ? `<p style="margin:0 0 4px;font-family:${FONT_STACK};font-size:15px;line-height:1.55;color:${EMAIL_TOKENS.textMuted};">${escapeHtml(opts.subtext)}</p>` : ""}
  </td></tr>`;
}

export function contentBlock(html: string): string {
  return `<tr><td style="padding:4px 32px 8px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${EMAIL_TOKENS.text};">${html}</td></tr>`;
}

function cardShell(accentColor: string, rows: string): string {
  return `<tr><td style="padding:12px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_TOKENS.lilac};border:1px solid ${EMAIL_TOKENS.lilacLine};border-left:4px solid ${accentColor};border-radius:12px;">
      <tr><td style="padding:18px 20px;">${rows}</td></tr>
    </table>
  </td></tr>`;
}

export function eventCard(opts: { posterUrl?: string | null; eventName: string; venueName: string; dateLabel: string; timeLabel?: string }): string {
  const poster = opts.posterUrl
    ? `<tr><td style="padding-bottom:12px;"><img src="${opts.posterUrl}" alt="${escapeHtml(opts.eventName)}" width="100%" style="display:block;border-radius:8px;max-width:100%;height:auto;" /></td></tr>`
    : "";
  return cardShell(EMAIL_TOKENS.violet, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${poster}
    <tr><td style="font-family:${FONT_STACK};font-size:17px;font-weight:700;color:${EMAIL_TOKENS.text};padding-bottom:4px;">${escapeHtml(opts.eventName)}</td></tr>
    <tr><td style="font-family:${FONT_STACK};font-size:14px;color:${EMAIL_TOKENS.textMuted};padding-bottom:2px;">${escapeHtml(opts.venueName)}</td></tr>
    <tr><td style="font-family:${FONT_STACK};font-size:14px;color:${EMAIL_TOKENS.textMuted};">${escapeHtml(opts.dateLabel)}${opts.timeLabel ? " · " + escapeHtml(opts.timeLabel) : ""}</td></tr>
  </table>`);
}

export function tokensCard(opts: { amountLabel: string; reason: string; balanceLabel: string }): string {
  return cardShell(EMAIL_TOKENS.violet, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="font-family:${FONT_STACK};font-size:26px;font-weight:800;color:${EMAIL_TOKENS.violetDark};padding-bottom:2px;">${escapeHtml(opts.amountLabel)}</td></tr>
    <tr><td style="font-family:${FONT_STACK};font-size:14px;color:${EMAIL_TOKENS.textMuted};padding-bottom:10px;">${escapeHtml(opts.reason)}</td></tr>
    <tr><td style="font-family:${FONT_STACK};font-size:13px;color:${EMAIL_TOKENS.text};border-top:1px solid ${EMAIL_TOKENS.lilacLine};padding-top:10px;">${escapeHtml(opts.balanceLabel)}</td></tr>
  </table>`);
}

export function benefitCard(opts: { benefitName: string; venueName?: string | null; expiryLabel?: string | null }): string {
  return cardShell(EMAIL_TOKENS.violet, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="font-family:${FONT_STACK};font-size:17px;font-weight:700;color:${EMAIL_TOKENS.text};padding-bottom:4px;">${escapeHtml(opts.benefitName)}</td></tr>
    ${opts.venueName ? `<tr><td style="font-family:${FONT_STACK};font-size:14px;color:${EMAIL_TOKENS.textMuted};padding-bottom:2px;">${escapeHtml(opts.venueName)}</td></tr>` : ""}
    ${opts.expiryLabel ? `<tr><td style="font-family:${FONT_STACK};font-size:13px;color:${EMAIL_TOKENS.textMuted};">${escapeHtml(opts.expiryLabel)}</td></tr>` : ""}
  </table>`);
}

export function infoBox(html: string): string {
  return `<tr><td style="padding:8px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_TOKENS.paper};border-radius:10px;">
      <tr><td style="padding:14px 18px;font-family:${FONT_STACK};font-size:13.5px;line-height:1.55;color:${EMAIL_TOKENS.textMuted};">${html}</td></tr>
    </table>
  </td></tr>`;
}

export function alertBox(html: string): string {
  return `<tr><td style="padding:8px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBEAE9;border:1px solid #F0C9C6;border-radius:10px;">
      <tr><td style="padding:14px 18px;font-family:${FONT_STACK};font-size:13.5px;line-height:1.55;color:${EMAIL_TOKENS.danger};">${html}</td></tr>
    </table>
  </td></tr>`;
}

// ─── Footer / shell ──────────────────────────────────────────────────────────

export interface EmailFooterOptions {
  locale: "en" | "es";
  preferencesUrl?: string | null; // solo marketing — transactional no lo necesita
  legalText?: string | null; // nunca fabricado — viene de SEGOLIFE_LEGAL_FOOTER_TEXT si existe
}

function footer(opts: EmailFooterOptions): string {
  const manage = opts.locale === "en" ? "Manage email preferences" : "Gestionar preferencias de email";
  return `<tr><td style="padding:28px 32px 32px;border-top:1px solid ${EMAIL_TOKENS.lilacLine};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="font-family:${FONT_STACK};font-size:13px;font-weight:800;letter-spacing:0.06em;color:${EMAIL_TOKENS.text};padding-bottom:6px;">SEGOLIFE</td></tr>
      ${opts.legalText ? `<tr><td style="font-family:${FONT_STACK};font-size:11.5px;color:${EMAIL_TOKENS.textMuted};padding-bottom:8px;">${escapeHtml(opts.legalText)}</td></tr>` : ""}
      ${opts.preferencesUrl ? `<tr><td style="font-family:${FONT_STACK};font-size:12px;padding-top:4px;"><a href="${opts.preferencesUrl}" style="color:${EMAIL_TOKENS.violet};text-decoration:underline;">${manage}</a></td></tr>` : ""}
    </table>
  </td></tr>`;
}

export interface EmailShellOptions {
  locale: "en" | "es";
  preheader: string; // texto oculto de precabecera — nunca repite el subject
  bodyRows: string; // filas <tr> ya construidas (heroBlock/contentBlock/cards/CTA)
  preferencesUrl?: string | null;
  legalText?: string | null;
}

/** Envuelve el contenido en la estructura de email completa (tabla 600px, header SEGOLIFE, footer). Compatible Gmail/Outlook/Apple Mail — sin CSS moderno. */
export function renderEmailShell(opts: EmailShellOptions): string {
  return `<!doctype html>
<html lang="${opts.locale}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>SEGOLIFE</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_TOKENS.paper};">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${EMAIL_TOKENS.paper};">${escapeHtml(opts.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_TOKENS.paper};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${EMAIL_TOKENS.white};border-radius:16px;overflow:hidden;">
<tr><td style="background:${EMAIL_TOKENS.ink};padding:18px 32px;">
<!-- .png, not .svg — Outlook desktop's Word rendering engine drops SVG <img> tags silently -->
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:10px;"><img src="${canonicalBaseUrl()}/icons/segolife-icon.png" width="28" height="28" alt="SEGOLIFE" style="display:block;border:0;border-radius:7px;" /></td>
<td><span style="font-family:${FONT_STACK};font-size:18px;font-weight:800;letter-spacing:0.04em;color:${EMAIL_TOKENS.white};">SEGO<span style="color:#C4B5FD;">LIFE</span></span></td>
</tr></table>
</td></tr>
${opts.bodyRows}
${footer({ locale: opts.locale, preferencesUrl: opts.preferencesUrl, legalText: opts.legalText })}
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Genera texto plano razonable a partir de piezas ya en texto (nunca strip-HTML mecánico de bodyRows). */
export function renderPlainText(opts: { locale: "en" | "es"; headline: string; paragraphs: string[]; ctaLabel?: string; ctaUrl?: string; preferencesUrl?: string | null }): string {
  const lines = ["SEGOLIFE", "", opts.headline, "", ...opts.paragraphs];
  if (opts.ctaLabel && opts.ctaUrl) lines.push("", `${opts.ctaLabel}: ${opts.ctaUrl}`);
  if (opts.preferencesUrl) {
    lines.push("", opts.locale === "en" ? `Manage email preferences: ${opts.preferencesUrl}` : `Gestionar preferencias: ${opts.preferencesUrl}`);
  }
  return lines.join("\n");
}
