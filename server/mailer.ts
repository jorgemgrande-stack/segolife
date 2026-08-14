/**
 * mailer.ts — Sistema de envío de emails
 *
 * Estrategia dual:
 *   1. PRIMARIO: Brevo HTTP API (puerto 443 HTTPS — funciona desde Railway/cloud)
 *   2. FALLBACK:  Nodemailer SMTP (solo funciona si el host no bloquea puertos SMTP)
 *
 * Railway bloquea conexiones SMTP salientes (465/587), por lo que el modo
 * primario es siempre la API HTTP de Brevo cuando BREVO_API_KEY está definida.
 *
 * Variables de entorno necesarias:
 *   BREVO_API_KEY   — clave API de Brevo (preferido en Railway)
 *   SMTP_FROM       — remitente visible, ej: "Skicenter <reservas@nayadeexperiences.es>"
 *   SMTP_HOST/PORT/USER/PASS/SECURE — fallback SMTP (entornos locales o no-cloud)
 */

import nodemailer from "nodemailer";
import { getSystemSettingSync } from "./config";

// ─── Tipos ────────────────────────────────────────────────────────────────────
export interface MailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  cc?: string | string[];
  /** Adjuntos por URL pública (p.ej. el PDF de la factura en el CDN). */
  attachments?: { name: string; url: string }[];
}

// ─── Helper: parsea el SMTP_FROM en nombre + email ───────────────────────────
function parseSender(raw: string): { name: string; email: string } {
  // Formatos: "Nombre <email>" o solo "email"
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: getSystemSettingSync("brand_name", "Skicenter"), email: raw.trim() };
}

// ─── Modo 1: Brevo HTTP API ───────────────────────────────────────────────────

export interface SendResult { success: boolean; messageId?: string; }

async function sendViaBrevoApiTracked(params: MailParams): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { success: false };

  const noreplyEmail = getSystemSettingSync("email_noreply_sender", "");
  const brandName = getSystemSettingSync("brand_name", "Skicenter");
  const fromRaw = params.from
    ?? process.env.SMTP_FROM
    ?? (noreplyEmail ? `${brandName} <${noreplyEmail}>` : `${brandName} <noreply@example.com>`);
  const sender = parseSender(fromRaw);

  const toList = Array.isArray(params.to)
    ? params.to.map(e => ({ email: e }))
    : [{ email: params.to }];

  const ccList = params.cc
    ? (Array.isArray(params.cc) ? params.cc : [params.cc]).map(e => ({ email: e }))
    : undefined;

  const body = {
    sender,
    to: toList,
    subject: params.subject,
    htmlContent: params.html,
    ...(params.text ? { textContent: params.text } : {}),
    ...(ccList ? { cc: ccList } : {}),
    // Adjuntos por URL (Brevo descarga el fichero público y lo adjunta)
    ...(params.attachments?.length
      ? { attachment: params.attachments.map(a => ({ url: a.url, name: a.name })) }
      : {}),
    // Desactivar click-tracking de Brevo para que los enlaces lleguen directos sin redirección
    headers: { "X-Mailin-no-track": "1" },
  };

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const json = await res.json() as { messageId?: string };
      console.log(`[Mailer] ✓ Brevo API → ${Array.isArray(params.to) ? params.to.join(", ") : params.to} | messageId: ${json.messageId ?? "—"}`);
      return { success: true, messageId: json.messageId };
    }

    const errText = await res.text();
    console.error(`[Mailer] ✗ Brevo API error ${res.status}: ${errText}`);
    return { success: false };
  } catch (err) {
    console.error("[Mailer] ✗ Brevo API fetch error:", err);
    return { success: false };
  }
}

// ─── Modo 2: Nodemailer SMTP (fallback) ───────────────────────────────────────
export function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === "true";

  if (!host || !user || !pass) {
    console.warn("[Mailer] SMTP no configurado — faltan SMTP_HOST, SMTP_USER o SMTP_PASS");
    return null;
  }

  console.log(`[Mailer] SMTP transporter → ${host}:${port} secure=${secure}`);

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false, minVersion: "TLSv1.2" },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
}

async function sendViaSMTP(params: MailParams): Promise<boolean> {
  const transporter = createTransporter();
  if (!transporter) return false;

  const fromAddress = params.from
    ?? process.env.SMTP_FROM
    ?? process.env.SMTP_USER
    ?? getSystemSettingSync("email_noreply_sender", "");

  try {
    await transporter.sendMail({
      from: fromAddress,
      to: Array.isArray(params.to) ? params.to.join(", ") : params.to,
      subject: params.subject,
      html: params.html,
      ...(params.text ? { text: params.text } : {}),
      ...(params.cc ? { cc: Array.isArray(params.cc) ? params.cc.join(", ") : params.cc } : {}),
      ...(params.attachments?.length
        ? { attachments: params.attachments.map(a => ({ filename: a.name, path: a.url })) }
        : {}),
    });
    console.log(`[Mailer] ✓ SMTP → ${Array.isArray(params.to) ? params.to.join(", ") : params.to}`);
    return true;
  } catch (err) {
    console.error("[Mailer] ✗ SMTP error:", err);
    return false;
  }
}

// ─── CC global ───────────────────────────────────────────────────────────────
// Dirección que recibe copia de TODOS los emails salientes.
// Se configura explícitamente con la variable de entorno GLOBAL_CC_EMAIL.
// Sin valor por defecto: un deployment nuevo no debe copiar correos a nadie
// hasta que se configure explícitamente su propia dirección.
const GLOBAL_CC_EMAIL = process.env.GLOBAL_CC_EMAIL ?? "";

function mergeGlobalCc(params: MailParams): MailParams {
  const existing = params.cc
    ? (Array.isArray(params.cc) ? params.cc : [params.cc])
    : [];
  const merged = [...new Set([...existing, GLOBAL_CC_EMAIL].filter(Boolean))];
  return { ...params, cc: merged };
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Envía un email usando Brevo API (primario) o SMTP (fallback).
 * Devuelve true si el envío fue exitoso.
 */
export async function sendEmail(params: MailParams): Promise<boolean> {
  const result = await sendEmailTracked(params);
  return result.success;
}

/**
 * Igual que `sendEmail()`, pero devuelve el `messageId` de Brevo cuando
 * existe — necesario para correlacionar el webhook de entrega/apertura/click
 * (Communication Center, spec §20) con el envío original.
 * `sendEmail()` sigue siendo la función que usan los ~15 módulos de negocio
 * de Náyade/Skicenter — su contrato (booleano) no cambia; esta es aditiva.
 */
export async function sendEmailTracked(params: MailParams): Promise<SendResult> {
  const enriched = mergeGlobalCc(params);

  // Intentar primero con Brevo API
  if (process.env.BREVO_API_KEY) {
    const result = await sendViaBrevoApiTracked(enriched);
    if (result.success) return result;
    console.warn("[Mailer] Brevo API falló, intentando SMTP...");
  }

  // Fallback SMTP — sin messageId (Nodemailer no lo devuelve en un formato correlacionable con webhooks de Brevo)
  const ok = await sendViaSMTP(enriched);
  return { success: ok };
}
