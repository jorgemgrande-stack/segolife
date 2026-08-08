/**
 * httpTransport.ts — implementación real (fetch) de IntegrationTransport.
 * Fase 5: NUNCA se invoca en producción (ningún integration tiene
 * `enabled=true` por defecto, ver kill switch en integrationSyncService.ts)
 * — existe para que el adapter tenga una implementación real lista el día
 * que haya credenciales, sin tener que escribirla entonces.
 */
import type { IntegrationTransport } from "./externalTicketingProvider";

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
      const res = await fetch(url.toString(), {
        method: opts.method,
        headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (!res.ok) {
        // Nunca incluir el cuerpo de la respuesta en el mensaje de error sin
        // sanitizar — podría contener datos del proveedor no pensados para logs.
        throw new Error(`${opts.method} ${opts.path} → HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    },
  };
}
