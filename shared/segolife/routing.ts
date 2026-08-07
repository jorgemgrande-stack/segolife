/**
 * Resolución de comunidad a partir de una request (pathname/hostname).
 *
 * Genérica a propósito: NO conoce "ie"/"uva" ni ningún slug concreto — solo
 * sabe extraer un candidato de slug de la URL. La validación de si ese slug
 * corresponde a una comunidad real ocurre consultando la API
 * (communities.getBySlug), nunca aquí. Esto es lo que permite añadir un
 * tercer campus sin tocar código de lógica (ver CLAUDE.md, regla
 * arquitectónica fundamental, y docs/SEGOLIFE_MULTICOMMUNITY_ARCHITECTURE.md
 * Paso 7).
 *
 * Prioridad de resolución:
 *   1. Subdominio (ej. "ie.segolife.es" → "ie") — inerte hoy (no hay
 *      subdominios configurados), pero ya soportado para cuando se activen
 *      sin tener que reescribir esta función ni sus llamadores. Bajo
 *      subdominio, CUALQUIER ruta de ese host se considera potencialmente
 *      de comunidad (todo el subdominio es el sitio de esa comunidad).
 *   2. Primer segmento de la ruta (ej. "/ie/algo" → "ie") — solo si ese
 *      segmento está registrado como ruta de comunidad (ver
 *      SEGOLIFE_COMMUNITY_PATH_PREFIXES más abajo).
 *   3. null si no hay candidato.
 *
 * Usado tanto en cliente (client/src/contexts/CommunityContext.tsx, leyendo
 * window.location) como potencialmente en servidor (middleware Express
 * futuro leyendo req.hostname/req.path) sin duplicar lógica.
 */

const BASE_DOMAIN_SUFFIXES = ["segolife.es", "localhost"];

/**
 * Único lugar donde se listan los prefijos de ruta que SÍ pueden ser una
 * comunidad — no es "lógica de negocio" (no hay ningún `if slug === "ie"`),
 * es la misma clase de dato de configuración que ya son las propias rutas
 * registradas en client/src/App.tsx (`<Route path="/ie">`). Sirve para que
 * CommunityProvider no dispare una query de resolución en las ~40 páginas
 * públicas heredadas de Náyade que no son de ninguna comunidad.
 *
 * Añadir un campus nuevo por ruta = añadir aquí su prefijo + su <Route> en
 * App.tsx. Bajo el esquema de subdominio (ver resolveFromHostname) esto ni
 * siquiera hace falta: cualquier ruta de un subdominio de comunidad ya se
 * considera potencialmente de comunidad sin tocar esta lista.
 */
export const SEGOLIFE_COMMUNITY_PATH_PREFIXES = ["/ie", "/uva"] as const;

export interface CommunityResolutionInput {
  pathname: string;
  hostname?: string;
}

/** Extrae el subdominio "ie" de "ie.segolife.es", o null si no hay subdominio de comunidad. */
function resolveFromHostname(hostname: string | undefined): string | null {
  if (!hostname) return null;
  const suffix = BASE_DOMAIN_SUFFIXES.find(s => hostname.endsWith(`.${s}`) || hostname === s);
  if (!suffix) return null;
  const prefix = hostname.slice(0, hostname.length - suffix.length).replace(/\.$/, "");
  if (!prefix || prefix === "www") return null;
  return prefix;
}

/** Extrae el primer segmento no vacío de un pathname, o null si la ruta es raíz. */
function resolveFromPathname(pathname: string): string | null {
  const [first] = pathname.split("/").filter(Boolean);
  return first ?? null;
}

function pathnameMatchesCommunityPrefix(pathname: string): boolean {
  return SEGOLIFE_COMMUNITY_PATH_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * ¿Puede esta request corresponder a una comunidad? Es la comprobación que
 * decide si vale la pena intentar resolver (y consultar la API) — no decide
 * QUÉ comunidad es, solo si hay candidato razonable. Bajo subdominio de
 * comunidad, siempre es true (toda esa web es de esa comunidad). Bajo ruta,
 * solo si coincide con un prefijo registrado.
 */
export function isPotentialCommunityRequest(input: CommunityResolutionInput): boolean {
  if (resolveFromHostname(input.hostname)) return true;
  return pathnameMatchesCommunityPrefix(input.pathname);
}

/**
 * Resuelve el slug de comunidad candidato de una request. No valida contra
 * la lista real de comunidades — eso lo hace communities.getBySlug. Devuelve
 * null si la request no es potencialmente de comunidad (ver
 * isPotentialCommunityRequest) — así los llamadores no necesitan repetir esa
 * comprobación por separado.
 */
export function resolveCommunitySlug(input: CommunityResolutionInput): string | null {
  if (!isPotentialCommunityRequest(input)) return null;
  return resolveFromHostname(input.hostname) ?? resolveFromPathname(input.pathname);
}
