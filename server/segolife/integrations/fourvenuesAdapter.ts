/**
 * fourvenuesAdapter.ts — adapter de Fourvenues **Channel Manager API**
 * (el modelo relevante para Segolife como marketplace multi-venue — ver
 * docs/integrations/fourvenues.md). Basado EXCLUSIVAMENTE en los endpoints
 * documentados ahí; ningún endpoint inventado.
 *
 * Auth: header `X-Api-Key`. Entornos confirmados:
 *   alpha:      https://channels-service-alpha.fourvenues.com
 *   producción: https://channels-service.fourvenues.com
 *
 * NUNCA se instancia con un transport real fuera de un test o de un sync
 * explícitamente habilitado (ver integrationSyncService.ts, kill switch).
 */
import { CapabilityNotSupportedError, type ExternalTicketingProvider, type IntegrationTransport, type NormalizedAttendance, type NormalizedCommerceTransaction, type NormalizedEvent, type NormalizedOrder, type NormalizedTicket, type NormalizedTicketType, type ProviderCredentials } from "./externalTicketingProvider";
import { FOURVENUES_CHANNEL_MANAGER_CAPABILITIES, type ProviderCapabilities } from "./capabilities";

export const FOURVENUES_BASE_URL = {
  sandbox: "https://channels-service-alpha.fourvenues.com",
  production: "https://channels-service.fourvenues.com",
} as const;

interface FourvenuesEventDto {
  _id: string;
  name: string;
  slug?: string;
  description?: string;
  image?: string;
  start_date?: string;
  end_date?: string;
  location_id?: string;
}

interface FourvenuesTicketRateDto {
  _id: string;
  event_id: string;
  name: string;
  current_price?: { amount_cents?: number; currency?: string };
  availability?: { available?: number };
  start_sale?: string;
  end_sale?: string;
}

interface FourvenuesPaymentDto {
  _id: string;
  status: string;
  event_id: string;
  resource_ids?: string[];
  total?: { amount_cents?: number; fees_cents?: number; currency?: string };
  paid_at?: string;
}

interface FourvenuesTicketDto {
  _id: string;
  event_id: string;
  ticket_rate_id?: string;
  status: string;
  full_name?: string;
  email?: string;
  phone?: string;
}

function authHeaders(credentials: ProviderCredentials): Record<string, string> {
  return { "X-Api-Key": credentials.apiKey ?? "" };
}

function mapOrderStatus(status: string): NormalizedOrder["status"] {
  if (status === "paid" || status === "completed") return "paid";
  if (status === "refunded") return "refunded";
  if (status === "failed") return "failed";
  if (status === "cancelled" || status === "voided") return "cancelled";
  return "pending";
}

// Channel Manager no expone check-in (individualAttendance=false) — un
// ticket nunca puede llegar aquí como "used", solo issued/cancelled/refunded.
function mapTicketStatus(status: string): NormalizedTicket["status"] {
  if (status === "voided") return "cancelled";
  if (status === "refunded") return "refunded";
  return "issued";
}

export function createFourvenuesAdapter(transport: IntegrationTransport, capabilities: ProviderCapabilities = FOURVENUES_CHANNEL_MANAGER_CAPABILITIES): ExternalTicketingProvider {
  return {
    providerKey: "fourvenues",
    capabilities,

    async testConnection(credentials) {
      try {
        const result = await transport.request<{ hosts?: unknown[] }>({
          method: "GET",
          path: "/auth",
          headers: authHeaders(credentials),
        });
        const hostCount = Array.isArray(result.hosts) ? result.hosts.length : 0;
        return { ok: true, message: `Conectado — ${hostCount} organización(es) partner visibles` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Error de conexión" };
      }
    },

    async listEvents(credentials, since) {
      const result = await transport.request<{ data: FourvenuesEventDto[] }>({
        method: "GET",
        path: "/events",
        query: { updated_since: since?.toISOString() },
        headers: authHeaders(credentials),
      });
      return (result.data ?? []).map((e): NormalizedEvent => ({
        externalId: e._id,
        name: e.name,
        description: e.description ?? null,
        imageUrl: e.image ?? null,
        startsAt: e.start_date ? new Date(e.start_date) : new Date(0),
        endsAt: e.end_date ? new Date(e.end_date) : null,
        raw: { location_id: e.location_id },
      }));
    },

    async listTicketTypes(credentials, externalEventId) {
      const result = await transport.request<{ data: FourvenuesTicketRateDto[] }>({
        method: "GET",
        path: "/ticket-rates",
        query: { event_id: externalEventId },
        headers: authHeaders(credentials),
      });
      return (result.data ?? []).map((r): NormalizedTicketType => ({
        externalId: r._id,
        externalEventId: r.event_id,
        name: r.name,
        priceCents: r.current_price?.amount_cents ?? 0,
        currency: r.current_price?.currency ?? "EUR",
        capacity: r.availability?.available ?? null,
        salesStart: r.start_sale ? new Date(r.start_sale) : null,
        salesEnd: r.end_sale ? new Date(r.end_sale) : null,
      }));
    },

    // No hay un endpoint "orders" directo en Channel Manager — se deriva de
    // GET /payments (resource_type='ticket'), que es el nivel de agregación
    // más cercano a "pedido" documentado. Decisión de normalización propia,
    // no un endpoint inventado — ver docs/integrations/fourvenues.md, sección Pagos.
    async listOrders(credentials, externalEventId, since) {
      const result = await transport.request<{ data: FourvenuesPaymentDto[] }>({
        method: "GET",
        path: "/payments",
        query: { event_id: externalEventId, updated_since: since?.toISOString() },
        headers: authHeaders(credentials),
      });
      return (result.data ?? []).map((p): NormalizedOrder => ({
        externalId: p._id,
        externalEventId: p.event_id,
        status: mapOrderStatus(p.status),
        subtotalCents: (p.total?.amount_cents ?? 0) - (p.total?.fees_cents ?? 0),
        feesCents: p.total?.fees_cents ?? 0,
        totalCents: p.total?.amount_cents ?? 0,
        currency: p.total?.currency ?? "EUR",
        buyer: {}, // Channel Manager no expone comprador a nivel de payment — solo a nivel de ticket individual
        purchasedAt: p.paid_at ? new Date(p.paid_at) : null,
      }));
    },

    async listTickets(credentials, externalEventId, since) {
      const result = await transport.request<{ data: FourvenuesTicketDto[] }>({
        method: "GET",
        path: "/tickets",
        query: { event_id: externalEventId, updated_since: since?.toISOString() },
        headers: authHeaders(credentials),
      });
      return (result.data ?? []).map((t): NormalizedTicket => ({
        externalId: t._id,
        externalEventId: t.event_id,
        externalTicketTypeId: t.ticket_rate_id ?? null,
        externalOrderId: null,
        participant: { email: t.email ?? null, phone: t.phone ?? null, name: t.full_name ?? null },
        status: mapTicketStatus(t.status),
      }));
    },

    // CONFIRMED NOT SUPPORTED vía Channel Manager (ver fourvenues.md, "Check-in / asistencia").
    // Nunca inventar datos de asistencia — lanza explícitamente.
    async listAttendance(): Promise<NormalizedAttendance[]> {
      throw new CapabilityNotSupportedError("fourvenues", "individualAttendance");
    },

    // Sin endpoint de POS/consumiciones genérico confirmado — ver fourvenues.md.
    async listCommerceTransactions(): Promise<NormalizedCommerceTransaction[]> {
      throw new CapabilityNotSupportedError("fourvenues", "consumptions");
    },
  };
}
