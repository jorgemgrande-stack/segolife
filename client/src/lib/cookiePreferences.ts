/**
 * Reabrir el banner de cookies desde cualquier punto de la app (footer,
 * /cookies) — spec "FASE LEGAL" punto 12: la elección debe poder cambiarse
 * después, no solo en la primera visita. Additive: CookieBanner.tsx escucha
 * este evento sin que el resto de su lógica de consentimiento cambie.
 */
export const OPEN_COOKIE_PREFERENCES_EVENT = "segolife:open-cookie-preferences";

export function openCookiePreferences() {
  window.dispatchEvent(new Event(OPEN_COOKIE_PREFERENCES_EVENT));
}
