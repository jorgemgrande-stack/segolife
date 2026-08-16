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
 * Devuelve la URL absoluta de redirect si `hostname` es el apex exacto sin
 * `www`, o `null` si no hace falta redirigir (ya es canónico, o es un host
 * no reconocido — dominio interno de Railway, localhost, preview domain —
 * que nunca se toca).
 */
export function canonicalRedirectTarget(hostname: string, originalUrl: string): string | null {
  if (hostname !== APEX_HOST) return null;
  return `https://${CANONICAL_HOST}${originalUrl}`;
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
