/**
 * mockTransport.ts — IntegrationTransport de prueba, sin red real. Usado
 * por los contract tests (adapter ↔ fixture oficial-shaped) y por "Test
 * connection" en desarrollo cuando no hay credenciales reales (spec Fase 5,
 * punto 54).
 */
import type { IntegrationTransport } from "./externalTicketingProvider";

type RouteKey = string; // `${method} ${path}`

/**
 * Segundo parámetro opcional (`opts` completo, incluyendo headers/body) —
 * añadido para poder probar peticiones POST con body/headers concretos
 * (p.ej. Weezevent auth form-urlencoded) sin romper ninguna ruta existente
 * que solo destructura `query` (JS ignora argumentos extra en llamadas a
 * funciones con menos parámetros declarados).
 */
export function createMockTransport(routes: Record<RouteKey, unknown | ((query?: Record<string, unknown>, opts?: { method: string; path: string; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> }) => unknown)>): IntegrationTransport {
  return {
    async request<T>(opts: { method: string; path: string; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> }): Promise<T> {
      const key = `${opts.method} ${opts.path}`;
      const entry = routes[key];
      if (entry === undefined) {
        throw new Error(`mockTransport: sin ruta registrada para ${key}`);
      }
      const value = typeof entry === "function"
        ? (entry as (q?: Record<string, unknown>, o?: typeof opts) => unknown)(opts.query, opts)
        : entry;
      return value as T;
    },
  };
}
