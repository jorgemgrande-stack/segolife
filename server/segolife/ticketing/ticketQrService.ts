/**
 * ticketQrService.ts — token de QR de un event_ticket nativo (Fase 8, spec
 * punto 9). Auditoría de seguridad ANTES de decidir (spec: "haz auditoría
 * antes de decidir"): un ticket, como un Benefit, debe poder volver a
 * mostrarse repetidamente desde "My Tickets" hasta el momento del evento —
 * a diferencia del QR de consumición de Fase 3 (hash-only, un único
 * intento de lectura). Por eso replica el patrón de
 * benefitGrantService.ts/benefitRedemptionService.ts: token en claro
 * recuperable (`event_tickets.qr_token`) + hash único para la búsqueda del
 * staff (`event_tickets.qr_token_hash`) — el canje SIEMPRE resuelve por
 * hash, nunca compara el texto plano (evita timing attacks). Mismo perfil
 * de riesgo aceptado que Benefits (ver comentario en drizzle/schema.ts de
 * user_benefits): una fuga de este token permite a un tercero mostrar la
 * entrada de otro, exactamente igual que perder una entrada de papel.
 */
import crypto from "crypto";

export function generateTicketQrToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashTicketQrToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
