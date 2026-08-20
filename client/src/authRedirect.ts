/**
 * authRedirect.ts — SEC-02 (sesión deslizante y reautenticación segura).
 *
 * Extraído de main.tsx para poder testear esta lógica de forma aislada sin
 * levantar todo el bootstrap de la app (createRoot/render).
 *
 * Antes: main.tsx redirigía a /login de forma instantánea e incondicional
 * ante CUALQUIER error tRPC con message===UNAUTHED_ERR_MSG, sin distinguir
 * un fallo puntual/transitorio (ver findUserByIdWithRetry en
 * server/localAuth.ts) de una sesión realmente inválida, y sin conservar
 * returnTo (getLoginUrl() se llamaba sin argumento). Eso amplificaba
 * cualquier 401 aislado en una pérdida completa de la pantalla/trabajo en
 * curso — el bug real reportado ("pierdo la sesión en mitad de una
 * operación").
 *
 * Fix: ante el primer 401, confirmar en fresco (REST directo a
 * /api/auth/me, sin caché de React Query) si la sesión sigue realmente
 * muerta antes de redirigir. Solo si esa confirmación TAMBIÉN falla se
 * concluye sesión genuinamente inválida, y se redirige conservando la ruta
 * actual como returnTo y una señal `reason=expired` para que Login.tsx
 * muestre un mensaje claro.
 */
import { getLoginUrl } from "./const";

let confirmingSessionDeath = false;

/** Solo para tests — resetea el flag de deduplicación entre casos. */
export function _resetConfirmingSessionDeathForTests(): void {
  confirmingSessionDeath = false;
}

export function buildExpiredLoginUrl(currentPath: string): string {
  const base = getLoginUrl(currentPath);
  return `${base}${base.includes("?") ? "&" : "?"}reason=expired`;
}

/**
 * Confirma si la sesión sigue viva antes de redirigir. Deduplicada: si ya
 * hay una confirmación en curso (varios 401 llegando a la vez, p.ej. un
 * batch de tRPC), las llamadas adicionales no disparan una segunda
 * confirmación ni una segunda redirección.
 */
export async function handleUnauthorized(): Promise<void> {
  if (confirmingSessionDeath) return;
  if (typeof window === "undefined") return;
  confirmingSessionDeath = true;
  try {
    const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
    if (res.ok) {
      // Confirmado: la sesión sigue viva — el 401 original era un fallo
      // aislado/transitorio. No se redirige ni se pierde la pantalla actual.
      return;
    }
    const currentPath = window.location.pathname + window.location.search;
    window.location.href = buildExpiredLoginUrl(currentPath);
  } catch {
    // Fallo de red al confirmar (offline, etc.) — no concluir sesión
    // muerta por un problema de conectividad ajeno a la autenticación.
  } finally {
    confirmingSessionDeath = false;
  }
}
