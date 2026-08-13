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
import { eurosToCents } from "./priceConversion";
import { HttpTransportError } from "./httpTransport";

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
  url?: string;
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

const toCents = eurosToCents;

function mapTicketStatus(ticket: FourvenuesIntTicketDto): NormalizedTicket["status"] {
  if (ticket.refunded === 1) return "refunded";
  if (ticket.enter === 1) return "used";
  if (ticket.status && ticket.status !== "activated") return "cancelled";
  return "issued";
}

export interface FourvenuesSyncWindow {
  /** Días hacia atrás desde hoy (por defecto 180 — sección 53/54: primera activación productiva debe poder acotarse, p.ej. 30 días para el piloto Casanova). */
  historyFromDays?: number;
  /** Días hacia delante desde hoy (por defecto 365 — piloto recomendado: 90). */
  futureUntilDays?: number;
}

// La API exige start/end obligatorios en /events/ (confirmado: sin ellos,
// 400 "Date is empty") y no documenta un filtro `updated_since` a nivel de
// servidor — se usa una ventana amplia fija (configurable por sync run vía
// `FourvenuesSyncWindow`, ver createFourvenuesIntegrationsAdapter) y el
// "since" del contrato se aplica en memoria donde el DTO lo permite (tickets
// sí traen updated_at).
function defaultDateWindow(window?: FourvenuesSyncWindow): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getTime() - (window?.historyFromDays ?? 180) * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + (window?.futureUntilDays ?? 365) * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

// Fourvenues Pagination Hardening — confirmado empíricamente 2026-08-13
// contra la API real (Casanova, evento con 600 tickets reales):
//   - GET /tickets/?event_id= SIN parámetros → exactamente 500 registros,
//     sin metadata de paginación en el body ({success,data} nada más) ni
//     en headers. offset=500 → 100 registros MÁS, nunca vistos en la
//     primera página (0 solapes verificados por _id) → CONFIRMA
//     truncation real, no coincidencia.
//   - offset/limit SÍ son parámetros aceptados. limit=1000 → 400 Bad
//     Request (rechazado) → 500 es el tamaño de página MÁXIMO real.
//   - Sin campo total/count en ningún sitio — la única señal de "última
//     página" es que la página devuelta tenga MENOS de `limit` elementos
//     (o esté vacía), nunca un total a comparar (spec §20).
//   - GET /events/ y GET /tickets-rates/ aceptan el MISMO offset/limit,
//     pero en la práctica Casanova nunca se acerca a 500 eventos/tarifas
//     por evento (confirmado: 88 eventos, ≤15 tarifas/evento) — se pagina
//     igual por coherencia y por si algún día cambia, no porque hoy trunquen.
const FOURVENUES_MAX_PAGE_SIZE = 500;
// Guarda defensiva (spec §16-17): 100 páginas × 500 = 50.000 registros por
// event_id — muy por encima de cualquier volumen real de Casanover — nunca
// debe alcanzarse en producción. Si se alcanza, es señal de un bug del
// proveedor (cursor que nunca converge) o un evento genuinamente anómalo:
// en ambos casos se aborta con error explícito, NUNCA se devuelve un
// dataset parcial marcado como completo.
const FOURVENUES_MAX_PAGES = 100;

/** Nunca se persiste un dataset incompleto como si fuera completo (spec §17, §61). */
export class FourvenuesPaginationIncompleteError extends Error {
  constructor(path: string, contextLabel: string, pagesFetched: number) {
    super(`Fourvenues ${path} (${contextLabel}) superó ${pagesFetched} páginas sin terminar — abortando en vez de devolver un dataset parcial en silencio`);
    this.name = "FourvenuesPaginationIncompleteError";
  }
}

function isRetryableStatus(err: unknown): boolean {
  if (!(err instanceof HttpTransportError)) return false;
  return err.status === 429 || err.status >= 500;
}

/** Reintenta SOLO la página que falló (nunca reinicia el dataset completo) ante 429/5xx transitorios — spec §21. */
async function withTransientRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableStatus(err) || attempt >= maxRetries) throw err;
      await new Promise(resolve => setTimeout(resolve, 500 * 3 ** attempt)); // 500ms, 1500ms
    }
  }
}

export interface FourvenuesPageStats {
  pagesFetched: number;
  recordsFetched: number;
  duplicatesAcrossPages: number;
  complete: true;
}

/**
 * Trae TODAS las páginas de un listado Fourvenues vía offset/limit (spec
 * §13-20) — genérico, reutilizado por eventos/tarifas/tickets, nunca
 * duplicado por endpoint. Secuencial (nunca páginas concurrentes, spec §22
 * — respeta ~10 req/s/api-key). Deduplica por id entre páginas sin ocultar
 * el hallazgo (spec §18): cuenta pero nunca inserta dos veces.
 */
async function fetchAllPages<T>(
  transport: IntegrationTransport,
  credentials: ProviderCredentials,
  path: string,
  baseQuery: Record<string, string | number | boolean | undefined>,
  idOf: (item: T) => string,
  contextLabel: string
): Promise<{ items: T[]; stats: FourvenuesPageStats }> {
  const items: T[] = [];
  const seenIds = new Set<string>();
  let duplicatesAcrossPages = 0;
  let offset = 0;
  let page = 0;
  while (true) {
    page++;
    if (page > FOURVENUES_MAX_PAGES) {
      throw new FourvenuesPaginationIncompleteError(path, contextLabel, page - 1);
    }
    const result = await withTransientRetry(() => transport.request<{ data: T[] }>({
      method: "GET",
      path,
      query: { ...baseQuery, offset, limit: FOURVENUES_MAX_PAGE_SIZE },
      headers: authHeaders(credentials),
    }));
    const pageData = result.data ?? [];
    for (const item of pageData) {
      const id = idOf(item);
      if (seenIds.has(id)) { duplicatesAcrossPages++; continue; }
      seenIds.add(id);
      items.push(item);
    }
    if (pageData.length < FOURVENUES_MAX_PAGE_SIZE) break; // última página — Fourvenues no da total, esta es la condición real de fin (spec §20)
    offset += FOURVENUES_MAX_PAGE_SIZE;
  }
  const stats: FourvenuesPageStats = { pagesFetched: page, recordsFetched: items.length, duplicatesAcrossPages, complete: true };
  // Observability (spec §23) — nunca PII: solo path/contextLabel (event_id o rango de fechas) y counts estructurales.
  console.log(`[FourvenuesAdapter] ${path} ${contextLabel} — pages=${stats.pagesFetched} records=${stats.recordsFetched} duplicatesAcrossPages=${stats.duplicatesAcrossPages} complete=${stats.complete}`);
  return { items, stats };
}

/**
 * listOrders/listTickets/listAttendance derivan los TRES del mismo
 * GET /tickets/?event_id= — auditoría previa confirmó que, sin caché, un
 * sync completo de un evento llama a este endpoint 3 veces con la misma
 * query. `createTicketsFetcher` memoiza por `externalEventId` DENTRO de una
 * instancia de adapter (una instancia = un sync run, ver
 * integrationSyncService.ts) — 1 descarga LÓGICA por evento (que internamente
 * puede ser N páginas reales si el evento supera 500 tickets), 3 vistas
 * normalizadas derivadas en memoria. Importante por rate limit (~10 req/s/api-key).
 */
function createTicketsFetcher(transport: IntegrationTransport) {
  const cache = new Map<string, Promise<{ items: FourvenuesIntTicketDto[]; stats: FourvenuesPageStats }>>();
  return function fetchTickets(credentials: ProviderCredentials, externalEventId: string): Promise<{ items: FourvenuesIntTicketDto[]; stats: FourvenuesPageStats }> {
    const cached = cache.get(externalEventId);
    if (cached) return cached;
    const promise = fetchAllPages<FourvenuesIntTicketDto>(
      transport, credentials, "/tickets/", { event_id: externalEventId }, t => t._id, `event_id=${externalEventId}`
    );
    cache.set(externalEventId, promise);
    return promise;
  };
}

export function createFourvenuesIntegrationsAdapter(transport: IntegrationTransport, capabilities: ProviderCapabilities = FOURVENUES_INTEGRATIONS_API_CAPABILITIES, syncWindow?: FourvenuesSyncWindow): ExternalTicketingProvider {
  const fetchTickets = createTicketsFetcher(transport);
  return {
    providerKey: "fourvenues_integrations",
    capabilities,

    // Integrations API no documenta un endpoint dedicado de verificación de
    // auth (a diferencia de Channel Manager GET /auth) — se usa GET /events/
    // con una ventana corta como comprobación de solo lectura confirmada.
    async testConnection(credentials) {
      try {
        const { start, end } = defaultDateWindow(syncWindow);
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
      const { start, end } = defaultDateWindow(syncWindow);
      const { items } = await fetchAllPages<FourvenuesIntEventDto>(
        transport, credentials, "/events/", { start, end }, e => e._id, `${start}..${end}`
      );
      // Sin campo updated_at confirmado en el DTO de evento — "since" no se
      // puede aplicar de forma fiable aquí, se devuelve todo el rango.
      return items.map((e): NormalizedEvent => ({
        externalId: e._id,
        name: e.name,
        description: e.description ?? null,
        imageUrl: e.flyer ?? null,
        startsAt: e.start ? new Date(e.start * 1000) : new Date(0),
        endsAt: e.end ? new Date(e.end * 1000) : null,
        externalUrl: e.url ?? null,
      }));
    },

    // Una "rate" puede tener varias `options[]` (p.ej. precios escalonados
    // por franja horaria). `tickets[].rate_id` SOLO referencia la rate,
    // nunca la opción concreta comprada — confirmado en el DTO real, ver
    // docs/integrations/fourvenues.md — así que crear una fila de
    // event_ticket_types POR OPCIÓN sería una precisión falsa: nunca
    // podríamos saber a cuál de ellas pertenece un ticket ya emitido. Se
    // representa 1 fila por rate (la opción más barata como precio
    // representativo, criterio "precio de entrada") pero SIN descartar las
    // demás opciones: se preservan íntegras en `raw.options` para que
    // event_ticket_types.metadata las guarde (ver eventCatalogSync.ts) y un
    // futuro admin pueda mostrarlas, aunque hoy no se usen para segmentar.
    async listTicketTypes(credentials, externalEventId) {
      const { items } = await fetchAllPages<FourvenuesIntRateDto>(
        transport, credentials, "/tickets-rates/", { event_id: externalEventId }, r => r._id, `event_id=${externalEventId}`
      );
      return items.map((r): NormalizedTicketType => {
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
          raw: options.length > 0 ? { options } : undefined,
        };
      });
    },

    // Sin endpoint nativo de "pedido" en Integrations API (GET /sales/ sin
    // schema documentado) — se deriva agrupando tickets por `payment_id`,
    // confirmado presente y poblado en cada ticket real (ver
    // docs/integrations/fourvenues.md, "Esquemas reales verificados").
    async listOrders(credentials, externalEventId) {
      const { items: tickets } = await fetchTickets(credentials, externalEventId);
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
      const { items: tickets } = await fetchTickets(credentials, externalEventId);
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
        amountPaidCents: toCents(t.total_paid),
        feesCents: toCents(t.total_fees),
        purchasedAt: t.created_at ? new Date(t.created_at) : null,
      }));
    },

    // CONFIRMADO soportado en bulk — GET /tickets/ trae enter+entry_date por
    // ticket, sin necesidad de GET /tickets/check-in/{code} uno a uno (ver
    // docs/integrations/fourvenues.md).
    async listAttendance(credentials, externalEventId, since) {
      const { items: tickets } = await fetchTickets(credentials, externalEventId);
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
