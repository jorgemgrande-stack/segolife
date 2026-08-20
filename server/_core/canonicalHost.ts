/**
 * canonicalHost.ts — Fase 15 (spec §33, "ROOT DOMAIN"). Único host canónico
 * público = www.segolife.es (coincide con RAILWAY_PUBLIC_DOMAIN ya
 * configurado). Extraído a un archivo aparte de server/_core/index.ts
 * (que arranca el servidor real al importarse) para poder testear la
 * decisión de redirect sin levantar nada.
 */
const CANONICAL_HOST = "www.segolife.es";
const APEX_HOST = "segolife.es";

/**
 * SEC-01: el dominio público auto-generado de Railway
 * (segolife-production.up.railway.app) servía la app de forma IDÉNTICA a
 * www.segolife.es, sin redirigir — dos "mundos" de sesión reales y no
 * relacionados (sessionCookieOptions en localAuth.ts, correctamente,
 * NUNCA comparte cookie entre ambos: segolife.es y railway.app no
 * comparten parent domain, y no deben forzarse a compartirlo). Un usuario
 * que entraba directamente por la URL de Railway (marcador antiguo,
 * enlace compartido, etc.) veía una sesión completamente distinta a la de
 * www.segolife.es — "la misma cuenta funciona en una URL y no en la
 * otra", pese a que el login en sí funcionaba correctamente en ambas por
 * separado.
 *
 * Fix: redirigir también ese dominio concreto (nunca un sufijo genérico
 * `.up.railway.app` — eso capturaría también cualquier preview/staging
 * deployment de Railway, que debe seguir sin tocarse) al host canónico —
 * PERO NUNCA las rutas `/api/*`. Los webhooks externos ya configurados (Redsys,
 * Brevo, GHL, Fourvenues) pueden seguir apuntando históricamente al
 * dominio de Railway; forzar un 301 en una petición POST de un webhook es
 * un riesgo real de pago/notificación silenciosamente roto que esta fase
 * no puede verificar (no hay acceso a los paneles externos para confirmar
 * sus URLs configuradas) — el healthcheck de Railway (`/api/health`,
 * railway.toml) y todo `/api/*` quedan exentos por la misma razón que ya
 * exime al apex del healthcheck (ver server/_core/index.ts, healthRouter
 * montado ANTES que este middleware). Solo las cargas de página real del
 * humano (la app React) se canonicalizan.
 */
// Dominio público auto-generado de ESTE despliegue concreto — no un sufijo
// genérico `.up.railway.app` (eso incluiría cualquier preview/staging
// deployment de Railway, que debe seguir sin tocarse, ver test
// "un host completamente distinto (preview domain, etc.)").
const RAILWAY_APP_DOMAIN = "segolife-production.up.railway.app";

/**
 * Devuelve la URL absoluta de redirect si `hostname` es el apex exacto sin
 * `www`, o el dominio interno de Railway fuera de `/api/*`, o `null` si no
 * hace falta redirigir (ya es canónico, o es un host no reconocido —
 * localhost, preview domain — que nunca se toca).
 */
export function canonicalRedirectTarget(hostname: string, originalUrl: string): string | null {
  if (hostname === APEX_HOST) return `https://${CANONICAL_HOST}${originalUrl}`;
  if (hostname === RAILWAY_APP_DOMAIN && !originalUrl.startsWith("/api/")) {
    return `https://${CANONICAL_HOST}${originalUrl}`;
  }
  return null;
}

/**
 * Base URL pública canónica — para enlaces salientes reales (invite links,
 * sitemap, meta canonical/OG) que deben apuntar a algo que un humano/crawler
 * pueda de verdad abrir. Auditoría de esta fase (Fase 15, spec §33) encontró
 * ~25+ sitios en el repo con `process.env.APP_URL ?? "https://www.skicenter.es"`
 * (resto heredado de Náyade, fuera de alcance aquí) y, en el caso específico
 * de referralService.ts, un fallback vacío (`appBaseUrl() === ""` si
 * `APP_URL` no está definida) que producía enlaces de invitación rotos como
 * `/invite/CODE` sin host. `APP_URL` sigue siendo la fuente de verdad SI
 * está configurada (permite apuntar a un entorno de staging, etc.); si no,
 * cae al host canónico real de esta fase — nunca a un dominio heredado o
 * vacío.
 */
export function canonicalBaseUrl(): string {
  const explicit = process.env.APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  return `https://${CANONICAL_HOST}`;
}
