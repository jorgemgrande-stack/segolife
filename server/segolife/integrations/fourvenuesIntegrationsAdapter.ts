/**
 * fourvenuesIntegrationsAdapter.ts — adapter de Fourvenues **Integrations
 * API** (distinta de Channel Manager — ver fourvenuesAdapter.ts). Es el
 * modelo que corresponde a las credenciales reales de Segolife: cada local
 * (Casanova, Tía Felisa, Limoncello) tiene su propia API key `ik_live_...`,
 * confirmado empíricamente 2026-08-12 — ver docs/integrations/fourvenues.md,
 * secciones "resuelto" y "Esquemas reales verificados".
 *
 * Auth: header `X-Api-Key`. Entornos:
 *   alpha:      https://api-alpha.fourvenues.com/integrations
 *   producción: https://api.fourvenues.com/integrations
 *
 * NUNCA se instancia con un transport real fuera de un test o de un sync
 * explícitamente habilitado (mismo kill switch de 4 capas que
 * fourvenuesAdapter.ts — ver integrationSyncService.ts).
 */
import { CapabilityNotSupportedError, type ExternalTicketingProvider, type IntegrationTransport, type NormalizedAttendance, type NormalizedCommerceTransaction, type NormalizedEvent, type NormalizedOrder, type NormalizedTicket, type NormalizedTicketType, type ProviderCredentials } from "./externalTicketingProvider";
import { FOURVENUES_INTEGRATIONS_API_CAPABILITIES, type ProviderCapabilities } from "./capabilities";

export const FOURVENUES_INTEGRATIONS_BASE_URL = {
  sandbox: "https://api-alpha.fourvenues.com/integrations",
  production: "https://api.fourvenues.com/integrations",
} as const;

interface FourvenuesIntEventDto {
  _id: string;
  name: string;
  slug?: string;
  description?: string;
  flyer?: string;
  start?: number; // unix segundos
  end?: number;
}

interface FourvenuesIntRateOptionDto {
  _id: string;
  until?: number;
  max_quantity?: number;
  price?: number; // unidades enteras (euros), NO céntimos — confirmado empíricamente
  age?: number;
  content?: string;
}

interface FourvenuesIntRateDto {
  _id: string;
  slug?: string;
  name: string;
  options?: FourvenuesIntRateOptionDto[];
}

interface FourvenuesIntTicketDto {
  _id: string;
  code?: string;
  event_id: string;
  rate_id?: string;
  status: string;
  name?: string;
  email?: string;
  phone?: string;
  total_paid?: number;
  total_fees?: number;
  refunded?: number; // 0 | 1
  payment_id?: string;
  enter?: number; // 0 | 1 — confirmado presente en la respuesta bulk
  entry_date?: number; // unix segundos
  created_at?: string;
  updated_at?: string;
}

function authHeaders(credentials: ProviderCredentials): Record<string, string> {
  return { "X-Api-Key": credentials.apiKey ?? "" };
}

function toCents(amount: number | undefined): number {
  return Math.round((amount ?? 0) * 100);
}

function mapTicketStatus(ticket: FourvenuesIntTicketDto): NormalizedTicket["status"] {
  if (ticket.refunded === 1) return "refunded";
  if (ticket.enter === 1) return "used";
  if (ticket.status && ticket.status !== "activated") return "cancelled";
  return "issued";
}

// La API exige start/end obligatorios en /events/ (confirmado: sin ellos,
// 400 "Date is empty") y no documenta un filtro `updated_since` a nivel de
// servidor — se usa una ventana amplia fija y el "since" del contrato se
// aplica en memoria donde el DTO lo permite (tickets sí traen updated_at).
function defaultDateWindow(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function fetchTickets(transport: IntegrationTransport, credentials: ProviderCredentials, externalEventId: string): Promise<FourvenuesIntTicketDto[]> {
  const result = await transport.request<{ data: FourvenuesIntTicketDto[] }>({
    method: "GET",
    path: "/tickets/",
    query: { event_id: externalEventId },
    headers: authHeaders(credentials),
  });
  return result.data ?? [];
}

export function createFourvenuesIntegrationsAdapter(transport: IntegrationTransport, capabilities: ProviderCapabilities = FOURVENUES_INTEGRATIONS_API_CAPABILITIES): ExternalTicketingProvider {
  return {
    providerKey: "fourvenues_integrations",
    capabilities,

    // Integrations API no documenta un endpoint dedicado de verificación de
    // auth (a diferencia de Channel Manager GET /auth) — se usa GET /events/
    // con una ventana corta como comprobación de solo lectura confirmada.
    async testConnection(credentials) {
      try {
        const { start, end } = defaultDateWindow();
        const result = await transport.request<{ data: FourvenuesIntEventDto[] }>({
          method: "GET",
          path: "/events/",
          query: { start, end },
          headers: authHeaders(credentials),
        });
        const count = Array.isArray(result.data) ? result.data.length : 0;
        return { ok: true, message: `Conectado — ${count} evento(s) visibles en el rango de prueba` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Error de conexión" };
      }
    },

    async listEvents(credentials) {
      const { start, end } = defaultDateWindow();
      const result = await transport.request<{ data: FourvenuesIntEventDto[] }>({
        method: "GET",
        path: "/events/",
        query: { start, end },
        headers: authHeaders(credentials),
      });
      // Sin campo updated_at confirmado en el DTO de evento — "since" no se
      // puede aplicar de forma fiable aquí, se devuelve todo el rango.
      return (result.data ?? []).map((e): NormalizedEvent => ({
        externalId: e._id,
        name: e.name,
        description: e.description ?? null,
        imageUrl: e.flyer ?? null,
        startsAt: e.start ? new Date(e.start * 1000) : new Date(0),
        endsAt: e.end ? new Date(e.end * 1000) : null,
      }));
    },

    // Una "rate" puede tener varias `options[]` (p.ej. precios escalonados
    // por franja horaria) — el contrato NormalizedTicketType es plano, así
    // que se representa una fila por rate usando la opción más barata como
    // precio representativo (decisión de normalización propia, documentada
    // — no existe forma sin pérdida de aplanar N opciones a 1). Consistente
    // con que `tickets[].rate_id` solo referencia la rate, nunca la opción.
    async listTicketTypes(credentials, externalEventId) {
      const result = await transport.request<{ data: FourvenuesIntRateDto[] }>({
        method: "GET",
        path: "/tickets-rates/",
        query: { event_id: externalEventId },
        headers: authHeaders(credentials),
      });
      return (result.data ?? []).map((r): NormalizedTicketType => {
        const options = r.options ?? [];
        const cheapest = options.reduce<FourvenuesIntRateOptionDto | null>((min, o) =>
          min === null || (o.price ?? Infinity) < (min.price ?? Infinity) ? o : min, null);
        return {
          externalId: r._id,
          externalEventId,
          name: r.name,
          priceCents: toCents(cheapest?.price),
          currency: "EUR",
          capacity: cheapest?.max_quantity ?? null,
          salesStart: null, // `until` observado no es una fecha de calendario confirmada — no se inventa un mapeo
          salesEnd: null,
        };
      });
    },

    // Sin endpoint nativo de "pedido" en Integrations API (GET /sales/ sin
    // schema documentado) — se deriva agrupando tickets por `payment_id`,
    // confirmado presente y poblado en cada ticket real (ver
    // docs/integrations/fourvenues.md, "Esquemas reales verificados").
    async listOrders(credentials, externalEventId) {
      const tickets = await fetchTickets(transport, credentials, externalEventId);
      const byPayment = new Map<string, FourvenuesIntTicketDto[]>();
      for (const t of tickets) {
        if (!t.payment_id) continue;
        const list = byPayment.get(t.payment_id) ?? [];
        list.push(t);
        byPayment.set(t.payment_id, list);
      }
      return Array.from(byPayment.entries()).map(([paymentId, group]): NormalizedOrder => {
        const feesCents = group.reduce((sum, t) => sum + toCents(t.total_fees), 0);
        const totalCents = group.reduce((sum, t) => sum + toCents(t.total_paid), 0);
        // Simplificación documentada: si CUALQUIER ticket del grupo está
        // reembolsado se marca el pedido entero como "refunded" — el
        // contrato NormalizedOrder no tiene un estado de reembolso parcial.
        const anyRefunded = group.some(t => t.refunded === 1);
        return {
          externalId: paymentId,
          externalEventId,
          externalPaymentId: paymentId,
          status: anyRefunded ? "refunded" : "paid",
          subtotalCents: totalCents - feesCents,
          feesCents,
          totalCents,
          currency: "EUR",
          buyer: { email: group[0]?.email ?? null, phone: group[0]?.phone ?? null, name: group[0]?.name ?? null },
          purchasedAt: group[0]?.created_at ? new Date(group[0].created_at) : null,
        };
      });
    },

    async listTickets(credentials, externalEventId, since) {
      const tickets = await fetchTickets(transport, credentials, externalEventId);
      const filtered = since
        ? tickets.filter(t => t.updated_at && new Date(t.updated_at).getTime() >= since.getTime())
        : tickets;
      return filtered.map((t): NormalizedTicket => ({
        externalId: t._id,
        externalEventId: t.event_id,
        externalTicketTypeId: t.rate_id ?? null,
        externalOrderId: t.payment_id ?? null,
        participant: { email: t.email ?? null, phone: t.phone ?? null, name: t.name ?? null },
        status: mapTicketStatus(t),
      }));
    },

    // CONFIRMADO soportado en bulk — GET /tickets/ trae enter+entry_date por
    // ticket, sin necesidad de GET /tickets/check-in/{code} uno a uno (ver
    // docs/integrations/fourvenues.md).
    async listAttendance(credentials, externalEventId, since) {
      const tickets = await fetchTickets(transport, credentials, externalEventId);
      return tickets
        .filter(t => t.enter === 1 && t.entry_date != null)
        .filter(t => !since || t.entry_date! * 1000 >= since.getTime())
        .map((t): NormalizedAttendance => ({
          externalAttendanceId: t._id,
          externalEventId,
          externalTicketId: t._id,
          participant: { email: t.email ?? null, phone: t.phone ?? null, name: t.name ?? null },
          occurredAt: new Date(t.entry_date! * 1000),
        }));
    },

    // Sin endpoint genérico de POS/venta de barra confirmado — `supplements[]`
    // en cada ticket es un perk YA incluido en la compra (p.ej. "1 copa"),
    // no una venta nueva. Nunca inventar datos de consumo — ver
    // docs/integrations/fourvenues.md, sección Consumiciones/POS.
    async listCommerceTransactions(): Promise<NormalizedCommerceTransaction[]> {
      throw new CapabilityNotSupportedError("fourvenues_integrations", "consumptions");
    },
  };
}
