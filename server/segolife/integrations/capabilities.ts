/**
 * capabilities.ts — contrato de capacidades del Integration Hub (Fase 5).
 *
 * Regla central de la fase: EL CÓDIGO SIEMPRE CONSULTA capabilities, NUNCA
 * ASUME. Un proveedor puede soportar una capacidad en teoría (según su
 * documentación pública) pero Segolife puede no tener autorizado ese scope
 * en la práctica — por eso `ProviderCapabilities` distingue explícitamente
 * boolean (confirmado sí/no) de `"unknown"` (no verificable hasta tener
 * credenciales reales, ver docs/integrations/fourvenues.md y weezevent.md).
 *
 * `integration_providers.capabilities` guarda el catálogo por proveedor
 * (lo que la documentación oficial confirma). `venue_integrations.capabilities`
 * / `event_integrations.capabilities` pueden SOBREESCRIBIR esos valores por
 * integración concreta (p.ej. Casanova podría no tener autorizado el scope
 * de "consumptions" aunque la API de Fourvenues lo soporte en teoría para
 * otros clientes) — ver resolveCapabilities().
 */

export interface ProviderCapabilities {
  events: boolean | "unknown";
  ticketTypes: boolean | "unknown";
  orders: boolean | "unknown";
  tickets: boolean | "unknown";
  payments: boolean | "unknown";
  refunds: boolean | "unknown";
  individualAttendance: boolean | "unknown";
  consumptions: boolean | "unknown";
  checkout: boolean | "unknown";
  webhooks: boolean | "unknown";
}

export const EMPTY_CAPABILITIES: ProviderCapabilities = {
  events: "unknown",
  ticketTypes: "unknown",
  orders: "unknown",
  tickets: "unknown",
  payments: "unknown",
  refunds: "unknown",
  individualAttendance: "unknown",
  consumptions: "unknown",
  checkout: "unknown",
  webhooks: "unknown",
};

/**
 * Capacidades del proveedor `fourvenues` vía **Channel Manager API** (el
 * modelo relevante para Segolife como marketplace multi-venue) — ver
 * docs/integrations/fourvenues.md. Distinto de las capacidades si un venue
 * concreto le diera a Segolife acceso a su propia Integrations API (más
 * amplio en check-in, pero no documentado como el modelo por defecto).
 */
export const FOURVENUES_CHANNEL_MANAGER_CAPABILITIES: ProviderCapabilities = {
  events: true,
  ticketTypes: true,
  orders: true,
  tickets: true,
  payments: true,
  refunds: true,
  individualAttendance: false, // CONFIRMED NOT SUPPORTED vía Channel Manager — ver fourvenues.md
  consumptions: false, // sin endpoint documentado de POS/venta de barra genérica
  checkout: true,
  webhooks: true,
};

/**
 * Capacidades reales de Fourvenues **Integrations API** — confirmado
 * 2026-08-12 con las tres API keys reales (`ik_live_...`) de Casanova, Tía
 * Felisa y Limoncello. Es el modelo que Segolife usa de verdad hoy (no
 * Channel Manager) — ver docs/integrations/fourvenues.md, sección "resuelto".
 */
export const FOURVENUES_INTEGRATIONS_API_CAPABILITIES: ProviderCapabilities = {
  events: true,
  ticketTypes: true,
  orders: true, // CONFIRMADO derivado: GET /tickets/ trae payment_id+total_paid+total_fees+refunded por ticket — se agrupa por payment_id, no hay endpoint nativo de "pedido"
  tickets: true,
  payments: "unknown", // external-payments existe pero no confirmado como venta primaria — el importe ya viene embebido en cada ticket, ver "orders"
  refunds: false, // Integrations API confirmado SOLO LECTURA en refunds
  individualAttendance: true, // CONFIRMADO doble: PUT /tickets/{id}/checkin (escritura) y GET /tickets/ trae enter+entry_date por ticket (lectura bulk, sin pedir ticket a ticket)
  consumptions: false, // CONFIRMADO no soportado: supplements[] es un perk ya incluido en el ticket, no una venta de barra nueva — ver fourvenues.md
  checkout: false, // sin endpoint de venta primaria confirmado
  webhooks: false, // sin webhooks documentados en Integrations API
};

export const WEEZEVENT_CAPABILITIES: ProviderCapabilities = {
  events: true,
  ticketTypes: true,
  orders: false, // sin endpoint de escritura de pedidos encontrado — API de solo lectura
  tickets: true,
  payments: "unknown",
  refunds: false,
  individualAttendance: true, // CONFIRMED — control_status por participante (scan_date/scan_user)
  consumptions: false,
  checkout: false, // sin checkout programático documentado
  webhooks: false, // no documentado — solo polling
};

export const SEGOLIFE_NATIVE_CAPABILITIES: ProviderCapabilities = {
  events: true,
  ticketTypes: true,
  orders: true,
  tickets: true,
  payments: false, // no activado en esta fase — sin PaymentProvider real
  refunds: false,
  individualAttendance: true,
  consumptions: true,
  checkout: false, // preparado, NO activado (spec Fase 5, punto 45)
  webhooks: false,
};

/** Combina el catálogo del proveedor con el override de la integración concreta (si existe). */
export function resolveCapabilities(
  providerCapabilities: ProviderCapabilities,
  integrationOverride: Partial<ProviderCapabilities> | null | undefined
): ProviderCapabilities {
  return { ...providerCapabilities, ...(integrationOverride ?? {}) };
}

export function hasCapability(capabilities: ProviderCapabilities, key: keyof ProviderCapabilities): boolean {
  return capabilities[key] === true;
}
