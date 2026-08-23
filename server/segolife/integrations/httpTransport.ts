/**
 * httpTransport.ts — implementación real (fetch) de IntegrationTransport.
 * Fase 5: NUNCA se invoca en producción (ningún integration tiene
 * `enabled=true` por defecto, ver kill switch en integrationSyncService.ts)
 * — existe para que el adapter tenga una implementación real lista el día
 * que haya credenciales, sin tener que escribirla entonces.
 */
import type { IntegrationTransport } from "./externalTicketingProvider";

/**
 * Error con el status HTTP real accesible programáticamente (Fourvenues
 * Pagination Hardening, spec §21) — antes el status solo vivía dentro del
 * string del mensaje, así que un caller no podía distinguir "429 → reintentar"
 * de "400 → no reintentar" sin parsear texto. Cambio aditivo: cualquier
 * `catch (err)` existente que solo leía `err.message` sigue funcionando igual.
 */
export class HttpTransportError extends Error {
  constructor(public readonly status: number, method: string, path: string) {
    super(`${method} ${path} → HTTP ${status}`);
    this.name = "HttpTransportError";
  }
}

export function createHttpTransport(baseUrl: string): IntegrationTransport {
  return {
    async request<T>(opts: {
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      path: string;
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      headers?: Record<string, string>;
    }): Promise<T> {
      const url = new URL(opts.path.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
      for (const [key, value] of Object.entries(opts.query ?? {})) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
      // Weezevent (F71 cierre real) — POST /auth/access_token exige
      // application/x-www-form-urlencoded, no JSON (confirmado contra
      // api.weezevent.com/, "Request Format: application/x-www-form-urlencoded").
      // Fourvenues nunca manda body en POST, así que este caso nunca se había
      // ejercitado — JSON.stringify(opts.body) siempre habría fallado la
      // autenticación real con Weezevent aunque las credenciales fueran
      // correctas. El caller pide form-encoding pasando ese header explícito.
      const isFormEncoded = (opts.headers?.["Content-Type"] ?? opts.headers?.["content-type"]) === "application/x-www-form-urlencoded";
      const body = !opts.body
        ? undefined
        : isFormEncoded
          ? new URLSearchParams(opts.body as Record<string, string>).toString()
          : JSON.stringify(opts.body);
      const res = await fetch(url.toString(), {
        method: opts.method,
        headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
        body,
      });
      if (!res.ok) {
        // Nunca incluir el cuerpo de la respuesta en el mensaje de error sin
        // sanitizar — podría contener datos del proveedor no pensados para logs.
        throw new HttpTransportError(res.status, opts.method, opts.path);
      }
      return (await res.json()) as T;
    },
  };
}
