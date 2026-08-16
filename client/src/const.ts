export { COOKIE_NAME, ONE_YEAR_MS, isSafeInternalPath } from "@shared/const";

/**
 * Devuelve la URL de login según el modo de autenticación:
 *  - LOCAL_AUTH=true  → /login?returnTo=<returnPath>  (auth propia)
 *  - Por defecto       → Manus OAuth portal
 */
export const isLocalAuth = (): boolean => {
  // VITE_LOCAL_AUTH se inyecta desde el servidor vía Vite define o meta.env
  // Si VITE_OAUTH_PORTAL_URL no está configurado, asumimos modo local
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL ?? "";
  const localAuthFlag = import.meta.env.VITE_LOCAL_AUTH ?? "";
  return localAuthFlag === "true" || !oauthPortalUrl;
};

export const getLoginUrl = (returnPath = "/") => {
  if (isLocalAuth()) {
    // Modo local: formulario propio en /login
    return `/login${returnPath !== "/" ? `?returnTo=${encodeURIComponent(returnPath)}` : ""}`;
  }

  // Modo Manus OAuth
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(JSON.stringify({ origin: window.location.origin, returnPath }));

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};

/**
 * Devuelve la URL de registro de estudiante (/register). Solo tiene sentido
 * en modo LOCAL_AUTH (el registro propio de SEGOLIFE es REST local — ver
 * server/localAuth.ts); en modo Manus OAuth no existe un flujo de registro
 * propio, así que cae a getLoginUrl (el portal OAuth gestiona alta de cuenta).
 *
 * `communitySlug` (Fase 15, remate) — preselecciona la comunidad en el paso 2
 * del formulario vía `?community=<slug>` (mecanismo que Register.tsx ya leía
 * pero que hasta ahora ningún sitio del código construía). La selección
 * sigue validándose siempre server-side en registerStudent(): esto es solo
 * una comodidad de UX, nunca una fuente de verdad.
 */
export const getRegisterUrl = (returnPath = "/", communitySlug?: string) => {
  if (!isLocalAuth()) return getLoginUrl(returnPath);
  const params = new URLSearchParams();
  if (returnPath !== "/") params.set("returnTo", returnPath);
  if (communitySlug) params.set("community", communitySlug);
  const qs = params.toString();
  return `/register${qs ? `?${qs}` : ""}`;
};
