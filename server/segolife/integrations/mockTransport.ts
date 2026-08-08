/**
 * mockTransport.ts — IntegrationTransport de prueba, sin red real. Usado
 * por los contract tests (adapter ↔ fixture oficial-shaped) y por "Test
 * connection" en desarrollo cuando no hay credenciales reales (spec Fase 5,
 * punto 54).
 */
import type { IntegrationTransport } from "./externalTicketingProvider";

type RouteKey = string; // `${method} ${path}`

export function createMockTransport(routes: Record<RouteKey, unknown | ((query?: Record<string, unknown>) => unknown)>): IntegrationTransport {
  return {
    async request<T>(opts: { method: string; path: string; query?: Record<string, unknown> }): Promise<T> {
      const key = `${opts.method} ${opts.path}`;
      const entry = routes[key];
      if (entry === undefined) {
        throw new Error(`mockTransport: sin ruta registrada para ${key}`);
      }
      const value = typeof entry === "function" ? (entry as (q?: Record<string, unknown>) => unknown)(opts.query) : entry;
      return value as T;
    },
  };
}
