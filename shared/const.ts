export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

/**
 * Único email exento del modo mantenimiento (ver system_settings
 * "site_maintenance_mode_enabled"). Mientras el mantenimiento está activo,
 * server/_core/context.ts anula ctx.user para cualquier otra sesión —
 * incluidos otros admins — y MaintenanceGate.tsx bloquea el render en el
 * cliente con el mismo criterio.
 */
export const MAINTENANCE_BYPASS_EMAIL = 'jorgemgrande@gmail.com';

/**
 * true si `path` es una ruta interna segura para redirigir tras login/registro
 * (parámetro `returnTo`). Usado por Login.tsx y Register.tsx — misma política,
 * un único sistema (nunca dos implementaciones de returnTo distintas).
 * Rechaza cualquier cosa que no sea "/algo" dentro de la propia app: URLs
 * absolutas (http://, https://), protocol-relative ("//evil.com") y
 * pseudo-protocolos (javascript:, data:, etc.) — evita open redirect.
 */
export function isSafeInternalPath(path: string | null | undefined): path is string {
  if (!path) return false;
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return false; // descarta http://, https://, javascript:, data:, etc.
  if (trimmed.startsWith("//")) return false; // protocol-relative ("//evil.com")
  if (trimmed.includes("\\")) return false; // "/\evil.com" — algunos navegadores lo tratan como "//evil.com"
  return true;
}
