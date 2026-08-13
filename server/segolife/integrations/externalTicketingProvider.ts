/**
 * externalTicketingProvider.ts — contrato único que implementa cada adapter
 * (FourvenuesAdapter, WeezeventAdapter, futuros). Fourvenues y Weezevent son
 * CANALES — ningún llamador debe conocer sus formas de datos originales;
 * todo entra por aquí ya normalizado a los tipos `Normalized*` (nunca
 * "FourvenuesTicket"/"WeezeventOrder" como entidad central — ver
 * docs/integrations/ticketing-commerce-architecture.md).
 *
 * El `transport` es inyectable/mockable a propósito (spec Fase 5, punto 19)
 * — permite tests de contrato sin red real y sin credenciales.
 */
import type { ProviderCapabilities } from "./capabilities";

export interface IntegrationTransport {
  request<T>(opts: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<T>;
}

/** Credenciales ya desencriptadas, en memoria solo durante la llamada — nunca persistidas en claro, nunca logueadas. */
export interface ProviderCredentials {
  [key: string]: string | undefined;
}

export interface NormalizedEvent {
  externalId: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  /**
   * Tía Felisa rollout (2026-08-13) — nullable a propósito: `events.starts_at`
   * es TIMESTAMP NOT NULL en MySQL, y en modo estricto (Railway, default)
   * rechaza el epoch — mismo patrón exacto que causó el bug real del
   * scheduler (integration_sync_state.updated_since). Cuando el proveedor no
   * da fecha de inicio (campo opcional en el DTO real), el adapter NUNCA
   * inventa `new Date(0)` — devuelve `null` y el evento queda observable
   * (`eventCatalogSync.ts`, outcome "invalid_missing_startsAt"), nunca
   * silenciosamente descartado ni escrito con una fecha falsa.
   */
  startsAt: Date | null;
  endsAt?: Date | null;
  externalUrl?: string | null;
  raw?: Record<string, unknown>;
}

export interface NormalizedTicketType {
  externalId: string;
  externalEventId: string;
  name: string;
  priceCents: number;
  currency: string;
  capacity?: number | null;
  salesStart?: Date | null;
  salesEnd?: Date | null;
  /** Forma original del proveedor cuando aplanar a un único precio pierde información real (p.ej. varias `options[]` de Fourvenues) — se persiste en event_ticket_types.metadata, nunca se descarta. */
  raw?: Record<string, unknown>;
}

export interface NormalizedBuyerOrParticipant {
  externalCustomerId?: string | null;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

export interface NormalizedOrder {
  externalId: string;
  externalEventId: string;
  externalPaymentId?: string | null;
  status: "pending" | "paid" | "cancelled" | "refunded" | "failed";
  subtotalCents: number;
  feesCents: number;
  totalCents: number;
  currency: string;
  buyer: NormalizedBuyerOrParticipant;
  purchasedAt?: Date | null;
}

export interface NormalizedTicket {
  externalId: string;
  externalEventId: string;
  externalTicketTypeId?: string | null;
  externalOrderId?: string | null;
  participant: NormalizedBuyerOrParticipant;
  status: "issued" | "cancelled" | "refunded" | "used";
  /** Precio/fecha REALES de esta entrada individual (no el agregado del pedido) — opcional porque no todo proveedor los expone a nivel de ticket (ver ticketPurchasePipeline.ts). */
  amountPaidCents?: number;
  feesCents?: number;
  purchasedAt?: Date | null;
}

/** Salida del pipeline de asistencia — nunca inventada si individualAttendance no está confirmado. */
export interface NormalizedAttendance {
  externalAttendanceId: string;
  externalEventId: string;
  externalTicketId?: string | null;
  participant: NormalizedBuyerOrParticipant;
  occurredAt: Date;
}

/** Solo se produce si `consumptions` está confirmado para la integración — nunca inventado. */
export interface NormalizedCommerceTransaction {
  externalTransactionId: string;
  status: "pending" | "confirmed" | "cancelled" | "refunded";
  subtotalCents: number;
  feesCents: number;
  totalCents: number;
  currency: string;
  paymentMethod?: string | null;
  buyer: NormalizedBuyerOrParticipant;
  occurredAt: Date;
  items: Array<{ venueProductId?: number | null; externalProductId?: string | null; description: string; quantity: number; unitAmountCents: number; totalAmountCents: number }>;
}

/**
 * Contrato único. Cada método que dependa de una capacidad no confirmada
 * debe lanzar `CapabilityNotSupportedError` en vez de devolver datos
 * inventados — ver capabilities.ts.
 */
export interface ExternalTicketingProvider {
  readonly providerKey: string;
  readonly capabilities: ProviderCapabilities;

  testConnection(credentials: ProviderCredentials): Promise<{ ok: boolean; message: string }>;

  listEvents(credentials: ProviderCredentials, since?: Date): Promise<NormalizedEvent[]>;
  listTicketTypes(credentials: ProviderCredentials, externalEventId: string): Promise<NormalizedTicketType[]>;
  listOrders(credentials: ProviderCredentials, externalEventId: string, since?: Date): Promise<NormalizedOrder[]>;
  listTickets(credentials: ProviderCredentials, externalEventId: string, since?: Date): Promise<NormalizedTicket[]>;
  listAttendance(credentials: ProviderCredentials, externalEventId: string, since?: Date): Promise<NormalizedAttendance[]>;
  listCommerceTransactions(credentials: ProviderCredentials, externalEventId: string, since?: Date): Promise<NormalizedCommerceTransaction[]>;
}

export class CapabilityNotSupportedError extends Error {
  constructor(public readonly provider: string, public readonly capability: string) {
    super(`${provider} no soporta (o no tiene confirmada) la capacidad "${capability}" — ver docs/integrations/${provider}.md`);
    this.name = "CapabilityNotSupportedError";
  }
}
