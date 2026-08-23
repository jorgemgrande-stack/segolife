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
  participants?: number;
  multiple_dates?: boolean | number | string;
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
  // deleted/refund: la doc oficial (api.weezevent.com/) los describe como
  // valores escalares ("0"/"1"), no como booleanos JS reales — normalizados
  // más abajo (isDeletedFlag/isRefundedFlag) en vez de asumir un tipo. deleted
  // podría llegar como boolean real, string "0"/"1" o number — se acepta
  // cualquiera de los tres para no fallar según el formato exacto que
  // devuelva la API real (nunca comprobado contra una respuesta real hasta
  // este cierre F71).
  deleted?: boolean | string | number;
  refund?: { status?: string } | string | boolean | number;
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

/**
 * POST /auth/access_token — obtiene un access_token a partir de
 * username+password+api_key. Se llama una vez y el token se persiste (es
 * "persistente" según la doc). Cierre real F71 (2026-08-23): confirmado
 * contra api.weezevent.com/ que este endpoint exige
 * application/x-www-form-urlencoded, no JSON — sin este header, la
 * autenticación real habría fallado siempre aunque las credenciales fueran
 * correctas (ver httpTransport.ts).
 */
export async function getWeezeventAccessToken(transport: IntegrationTransport, credentials: ProviderCredentials): Promise<string> {
  const result = await transport.request<{ accessToken: string }>({
    method: "POST",
    path: "/auth/access_token",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: { username: credentials.username ?? "", password: credentials.password ?? "", api_key: credentials.apiKey ?? "" },
  });
  return result.accessToken;
}

function participantName(owner: WeezeventParticipantDto["owner"]): string | null {
  if (!owner) return null;
  const parts = [owner.first_name, owner.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** "0"/"1" (string), 0/1 (number) o boolean real — nunca confiar en la truthiness JS de una string "0" (que es truthy). Weezevent devuelve varios flags booleanos así (deleted, multiple_dates...). */
function toTolerantBoolean(v: boolean | string | number | null | undefined): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return v !== "0" && v !== "" && v.toLowerCase() !== "false";
}

function isDeletedFlag(v: WeezeventParticipantDto["deleted"]): boolean {
  return toTolerantBoolean(v);
}

/** refund puede llegar como objeto {status}, o como escalar "0"/"1"/boolean/number según la doc oficial — se aceptan ambas formas. */
function isRefundedFlag(v: WeezeventParticipantDto["refund"]): boolean {
  if (v == null) return false;
  if (typeof v === "object") return v.status === "refunded" || v.status === "1";
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return v !== "" && v !== "0";
}

/**
 * `/participant/list` pagina con `max`/`page` (doc oficial, sin tamaño
 * máximo de página documentado) — sin esto, un evento con más participantes
 * que el tamaño de página por defecto de Weezevent perdería silenciosamente
 * el resto. Se pide un tamaño de página grande a propósito (fair use: menos
 * llamadas totales que paginar de 20 en 20). Límite de 200 páginas como
 * cinturón de seguridad ante un bug de paginación infinita — muy por encima
 * de cualquier volumen real esperado (200 × 500 = 100.000 participantes).
 */
const PARTICIPANT_PAGE_SIZE = 500;
const PARTICIPANT_MAX_PAGES = 200;

async function fetchAllParticipants(
  transport: IntegrationTransport,
  credentials: ProviderCredentials,
  filters: { id_event: string; last_update?: string }
): Promise<WeezeventParticipantDto[]> {
  const all: WeezeventParticipantDto[] = [];
  for (let page = 1; page <= PARTICIPANT_MAX_PAGES; page++) {
    const result = await transport.request<{ participants: WeezeventParticipantDto[] }>({
      method: "GET",
      path: "/participant/list",
      query: { ...authQuery(credentials), ...filters, max: PARTICIPANT_PAGE_SIZE, page },
    });
    const batch = result.participants ?? [];
    all.push(...batch);
    if (batch.length < PARTICIPANT_PAGE_SIZE) break; // última página (o vacía)
  }
  return all;
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
        startsAt: e.start ? new Date(e.start) : null, // nunca epoch — ver NormalizedEvent.startsAt
        endsAt: e.end ? new Date(e.end) : null,
        externalUrl: e.site_url ?? null,
        sourcePublicationStatus: "unknown", // FIX-04 — Weezevent es event_integration (nunca pasa por eventCatalogSync, ver integrationSyncService.ts); sin señal real de publicación conocida
        // Cierre F71 (2026-08-23) — participants/multiple_dates confirmados en
        // la doc oficial de /events; se guardan en `raw` (nunca en el
        // interface compartido con Fourvenues) para que el descubrimiento de
        // eventos en /admin/integrations pueda mostrarlos sin inventar nada.
        raw: { participants: e.participants ?? null, multipleDates: toTolerantBoolean(e.multiple_dates) },
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
      const participants = await fetchAllParticipants(transport, credentials, {
        id_event: externalEventId, last_update: since?.toISOString(),
      });
      return participants
        .filter(p => !isDeletedFlag(p.deleted))
        .map((p): NormalizedTicket => ({
          externalId: String(p.id_participant),
          externalEventId: String(p.id_event),
          externalTicketTypeId: p.id_ticket != null ? String(p.id_ticket) : null,
          externalOrderId: p.id_transaction ?? null,
          participant: { email: p.owner?.email ?? null, phone: p.owner?.phone ?? null, name: participantName(p.owner) },
          status: isRefundedFlag(p.refund) ? "refunded" : "issued",
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
      const participants = await fetchAllParticipants(transport, credentials, {
        id_event: externalEventId, last_update: since?.toISOString(),
      });
      return participants
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
