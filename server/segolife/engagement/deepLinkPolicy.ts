/**
 * deepLinkPolicy.ts — whitelist de rutas internas seguras para
 * `deep_link` (Fase 7, spec puntos 15/58). Nunca se acepta una URL externa
 * arbitraria, `javascript:`, ni cualquier otro esquema — solo rutas
 * relativas internas ya conocidas de la app pública de Segolife (Fase 6).
 * Rechazar silenciosamente (devolver null) es más seguro que lanzar: un
 * deep_link inválido no debe romper la creación de la notificación, solo
 * queda sin acción de navegación.
 */
const ALLOWED_PATTERNS: RegExp[] = [
  /^\/[a-z0-9-]+$/, // home de comunidad: /ie, /uva
  /^\/[a-z0-9-]+\/explore$/,
  /^\/[a-z0-9-]+\/events\/[a-z0-9-]+$/,
  /^\/[a-z0-9-]+\/venues\/[a-z0-9-]+$/,
  /^\/[a-z0-9-]+\/scan$/,
  /^\/[a-z0-9-]+\/rewards$/,
  /^\/[a-z0-9-]+\/benefits\/\d+$/,
  /^\/[a-z0-9-]+\/profile$/,
  /^\/[a-z0-9-]+\/activity$/,
  /^\/[a-z0-9-]+\/notifications$/,
  // COMUNITY (spec punto 20/45) — hub y detalle de una propuesta.
  /^\/[a-z0-9-]+\/comunity$/,
  /^\/[a-z0-9-]+\/comunity\/\d+$/,
  // Fase 16 — reset de contraseña (server/passwordReset.ts). Ruta global,
  // sin prefijo de comunidad. El token va en la query string, preservada
  // aparte por sanitizeDeepLink (solo el path se compara contra el patrón).
  /^\/nueva-contrasena$/,
];

export function sanitizeDeepLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null; // nunca esquemas externos ni javascript:
  if (trimmed.startsWith("//")) return null; // protocol-relative URL — trata de escapar del propio origen
  const pathOnly = trimmed.split(/[?#]/)[0];
  const isAllowed = ALLOWED_PATTERNS.some(pattern => pattern.test(pathOnly));
  return isAllowed ? trimmed : null;
}
