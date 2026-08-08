/**
 * weezeventAdapter.ts — adapter de Weezevent. Basado EXCLUSIVAMENTE en los
 * endpoints documentados en docs/integrations/weezevent.md. API de solo
 * lectura confirmada (sin checkout/orders programáticos, sin webhooks) —
 * ver capabilities.ts, WEEZEVENT_CAPABILITIES.
 *
 * Auth de dos pasos: api_key (cuenta) + access_token obtenido vía
 * POST /auth/access_token. No hay sandbox documentado — solo producción
 * (`https://api.weezevent.com`).
 *
 * Terminología Weezevent ≠ terminología Segolife: su endpoint `/tickets`
 * son TIPOS de entrada (→ NormalizedTicketType), mientras que las entradas
 * INDIVIDUALES emitidas son "participants" (→ NormalizedTicket /
 * NormalizedAttendance vía `control_status`). No confundir con
 * fourvenuesAdapter.ts, donde `/tickets` sí son entradas individuales.
 */
import { CapabilityNotSupportedError, type ExternalTicketingProvider, type IntegrationTransport, type NormalizedAttendance, type NormalizedCommerceTransaction, type NormalizedEvent, type NormalizedOrder, type NormalizedTicket, type NormalizedTicketType, type ProviderCredentials } from "./externalTicketingProvider";
import { WEEZEVENT_CAPABILITIES, type ProviderCapabilities } from "./capabilities";

export const WEEZEVENT_BASE_URL = "https://api.weezevent.com";

interface WeezeventEventDto {
  id: number;
  name: string;
  start?: string;
  end?: string;
  site_url?: string;
}

interface WeezeventTicketRateDto {
  id: number;
  id_event: number;
  name: string;
  price?: number;
  start_sale?: string;
  end_sale?: string;
}

interface WeezeventParticipantDto {
  id_participant: number;
  id_event: number;
  id_ticket?: number;
  id_transaction?: string;
  owner?: { email?: string; phone?: string; first_name?: string; last_name?: string };
  control_status?: { status?: string; scan_date?: string; scan_user_name?: string };
  deleted?: boolean;
  refund?: { status?: string };
}

function authHeaders(credentials: ProviderCredentials): Record<string, string> {
  // Weezevent requiere api_key + access_token (obtenido previamente vía
  // POST /auth/access_token, ver getAccessToken()) — ambos como query params
  // según la documentación pública, no headers.
  return {};
}

function authQuery(credentials: ProviderCredentials): Record<string, string> {
  return { api_key: credentials.apiKey ?? "", access_token: credentials.accessToken ?? "" };
}

/** POST /auth/access_token — obtiene un access_token a partir de username+password+api_key. Se llama una vez y el token se persiste (es "persistente" según la doc). */
export async function getWeezeventAccessToken(transport: IntegrationTransport, credentials: ProviderCredentials): Promise<string> {
  const result = await transport.request<{ accessToken: string }>({
    method: "POST",
    path: "/auth/access_token",
    body: { username: credentials.username, password: credentials.password, api_key: credentials.apiKey },
  });
  return result.accessToken;
}

function participantName(owner: WeezeventParticipantDto["owner"]): string | null {
  if (!owner) return null;
  const parts = [owner.first_name, owner.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export function createWeezeventAdapter(transport: IntegrationTransport, capabilities: ProviderCapabilities = WEEZEVENT_CAPABILITIES): ExternalTicketingProvider {
  return {
    providerKey: "weezevent",
    capabilities,

    async testConnection(credentials) {
      try {
        await transport.request<{ data: unknown[] }>({
          method: "GET",
          path: "/events",
          query: authQuery(credentials),
          headers: authHeaders(credentials),
        });
        return { ok: true, message: "Conectado" };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Error de conexión" };
      }
    },

    async listEvents(credentials) {
      const result = await transport.request<{ events: WeezeventEventDto[] }>({
        method: "GET",
        path: "/events",
        query: authQuery(credentials),
      });
      return (result.events ?? []).map((e): NormalizedEvent => ({
        externalId: String(e.id),
        name: e.name,
        startsAt: e.start ? new Date(e.start) : new Date(0),
        endsAt: e.end ? new Date(e.end) : null,
        externalUrl: e.site_url ?? null,
      }));
    },

    async listTicketTypes(credentials, externalEventId) {
      const result = await transport.request<{ tickets: WeezeventTicketRateDto[] }>({
        method: "GET",
        path: "/tickets",
        query: { ...authQuery(credentials), id_event: externalEventId },
      });
      return (result.tickets ?? []).map((t): NormalizedTicketType => ({
        externalId: String(t.id),
        externalEventId: String(t.id_event),
        name: t.name,
        priceCents: Math.round((t.price ?? 0) * 100),
        currency: "EUR",
        salesStart: t.start_sale ? new Date(t.start_sale) : null,
        salesEnd: t.end_sale ? new Date(t.end_sale) : null,
      }));
    },

    // Sin endpoint de escritura de pedidos documentado — API de solo lectura
    // (ver weezevent.md). Un "id_transaction" existe por participante, pero
    // no hay un endpoint de listado de transacciones/pedidos independiente.
    async listOrders(): Promise<NormalizedOrder[]> {
      throw new CapabilityNotSupportedError("weezevent", "orders");
    },

    // Cada "participant" de Weezevent ES una entrada individual emitida.
    async listTickets(credentials, externalEventId, since) {
      const result = await transport.request<{ participants: WeezeventParticipantDto[] }>({
        method: "GET",
        path: "/participant/list",
        query: { ...authQuery(credentials), id_event: externalEventId, last_update: since?.toISOString() },
      });
      return (result.participants ?? [])
        .filter(p => !p.deleted)
        .map((p): NormalizedTicket => ({
          externalId: String(p.id_participant),
          externalEventId: String(p.id_event),
          externalTicketTypeId: p.id_ticket != null ? String(p.id_ticket) : null,
          externalOrderId: p.id_transaction ?? null,
          participant: { email: p.owner?.email ?? null, phone: p.owner?.phone ?? null, name: participantName(p.owner) },
          status: p.refund?.status === "refunded" ? "refunded" : "issued",
        }));
    },

    // CONFIRMED individual — control_status por participante (scan_date,
    // scan_user_name). Solo se normaliza si status indica "escaneado"
    // (distinto de "0" = no escaneado, valor por defecto documentado).
    // El significado exacto de cada valor de status más allá de "0" es
    // UNKNOWN (sin leyenda documentada) — se trata como "cualquier valor
    // distinto de '0' con scan_date real = asistencia" (heurística
    // conservadora, a confirmar con credenciales reales).
    async listAttendance(credentials, externalEventId, since) {
      const result = await transport.request<{ participants: WeezeventParticipantDto[] }>({
        method: "GET",
        path: "/participant/list",
        query: { ...authQuery(credentials), id_event: externalEventId, last_update: since?.toISOString() },
      });
      return (result.participants ?? [])
        .filter(p => p.control_status && p.control_status.status !== "0" && p.control_status.scan_date && p.control_status.scan_date !== "0000-00-00 00:00:00")
        .map((p): NormalizedAttendance => ({
          externalAttendanceId: `${p.id_participant}:${p.control_status!.scan_date}`,
          externalEventId: String(p.id_event),
          externalTicketId: String(p.id_participant),
          participant: { email: p.owner?.email ?? null, phone: p.owner?.phone ?? null, name: participantName(p.owner) },
          occurredAt: new Date(p.control_status!.scan_date!),
        }));
    },

    // Sin concepto de POS/consumiciones documentado en Weezevent.
    async listCommerceTransactions(): Promise<NormalizedCommerceTransaction[]> {
      throw new CapabilityNotSupportedError("weezevent", "consumptions");
    },
  };
}
