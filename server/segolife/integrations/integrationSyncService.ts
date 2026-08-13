/**
 * integrationSyncService.ts — orquestador de sincronización del Integration
 * Hub (Fase 5, puntos 35-36). NINGÚN worker arranca solo — este servicio
 * expone funciones que un futuro job/cron o un botón "Sync now" del admin
 * invocarán explícitamente. server/_core/index.ts NUNCA importa este
 * archivo (mismo criterio que scripts/db-migrate.ts: STARTUP != SYNC).
 *
 * KILL SWITCH (spec punto 36) — los CUATRO deben cumplirse:
 *   1. process.env.EXTERNAL_INTEGRATIONS_ENABLED === "true" (default false)
 *   2. integration.enabled === true (fila concreta)
 *   3. credenciales configuradas (credentialsEncrypted no vacío)
 *   4. capability de sync habilitada (integration.syncEnabled === true)
 * En una BD nueva sin ninguna fila de integración, o con
 * EXTERNAL_INTEGRATIONS_ENABLED sin definir, `canSync()` siempre es false —
 * ningún sync puede ejecutarse por accidente.
 */
import { eq, and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { venues, communityVenues, eventTickets, type VenueIntegration, type EventIntegration } from "../../../drizzle/schema";
import { startSyncRun, finishSyncRun, recordVenueIntegrationResult, getVenueIntegrationRaw, getProviderById, setSyncCursor, findInternalIdForExternal, tryAcquireSyncLock, isDueForScheduledSync, getCurrentLockStatus } from "./integrationsDb";
import { CapabilityNotSupportedError, type ExternalTicketingProvider, type NormalizedOrder, type NormalizedTicket } from "./externalTicketingProvider";
import { decryptCredentials } from "./integrationCredentialCrypto";
import { createFourvenuesIntegrationsAdapter, FOURVENUES_INTEGRATIONS_BASE_URL } from "./fourvenuesIntegrationsAdapter";
import { createHttpTransport } from "./httpTransport";
import { resolveIdentity } from "./identityResolver";
import { syncEventCatalog, syncTicketTypes } from "./eventCatalogSync";
import { ingestTicketPurchase, ingestPaymentlessTicket } from "../ticketing/ticketPurchasePipeline";
import { ingestAttendance } from "../ticketing/attendancePipeline";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);
type DbHandle = typeof _db;
async function getDb(): Promise<DbHandle> { return _db; }

export function isExternalIntegrationsGloballyEnabled(): boolean {
  return process.env.EXTERNAL_INTEGRATIONS_ENABLED === "true";
}

export function canSync(integration: Pick<VenueIntegration | EventIntegration, "enabled" | "credentialsEncrypted" | "syncEnabled">): boolean {
  return (
    isExternalIntegrationsGloballyEnabled() &&
    integration.enabled === true &&
    !!integration.credentialsEncrypted &&
    integration.syncEnabled === true
  );
}

export interface SyncOutcome {
  status: "success" | "partial" | "failed" | "skipped_disabled";
  fetchedCount: number;
  createdCount: number;
  updatedCount: number;
  unresolvedCount: number;
  failedCount: number;
  message?: string;
}

/**
 * Sync incremental de eventos+tipos de entrada de UNA integración concreta.
 * Deliberadamente NO sincroniza attendance/commerce aquí — eso vive en
 * attendancePipeline.ts/commercePipeline.ts, invocados por separado con el
 * resultado ya normalizado (separación de responsabilidades: este servicio
 * solo orquesta fetch+throttle+registro de resultado, nunca decide loyalty).
 */
export async function runIntegrationSync(
  integration: VenueIntegration | EventIntegration,
  integrationType: "venue_integration" | "event_integration",
  adapter: ExternalTicketingProvider,
  externalEventId: string
): Promise<SyncOutcome> {
  if (!canSync(integration)) {
    return { status: "skipped_disabled", fetchedCount: 0, createdCount: 0, updatedCount: 0, unresolvedCount: 0, failedCount: 0, message: "Integración deshabilitada (kill switch) — ver EXTERNAL_INTEGRATIONS_ENABLED / integration.enabled / credenciales / syncEnabled" };
  }

  const credentials = decryptCredentials(integration.credentialsEncrypted);
  if (!credentials) {
    return { status: "failed", fetchedCount: 0, createdCount: 0, updatedCount: 0, unresolvedCount: 0, failedCount: 0, message: "No se pudieron descifrar las credenciales" };
  }

  const run = await startSyncRun({ integrationType, integrationId: integration.id, syncType: "incremental" });

  let fetchedCount = 0;
  let failedCount = 0;
  let errorMessage: string | null = null;

  try {
    const events = await adapter.listEvents(credentials);
    fetchedCount += events.length;
    for (const event of events) {
      if (event.externalId !== externalEventId) continue;
      try {
        await adapter.listTicketTypes(credentials, event.externalId);
      } catch (err) {
        if (err instanceof CapabilityNotSupportedError) continue; // capability no confirmada — no es un fallo del sync
        failedCount++;
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    }
    await finishSyncRun(run.id, { fetchedCount, createdCount: 0, updatedCount: 0, unresolvedCount: 0, failedCount }, failedCount > 0 ? "partial" : "success");
    if (integrationType === "venue_integration") await recordVenueIntegrationResult(integration.id, true, null);
    return { status: failedCount > 0 ? "partial" : "success", fetchedCount, createdCount: 0, updatedCount: 0, unresolvedCount: 0, failedCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishSyncRun(run.id, { fetchedCount, createdCount: 0, updatedCount: 0, unresolvedCount: 0, failedCount: fetchedCount || 1 }, "failed", message);
    if (integrationType === "venue_integration") await recordVenueIntegrationResult(integration.id, false, message);
    return { status: "failed", fetchedCount, createdCount: 0, updatedCount: 0, unresolvedCount: 0, failedCount: fetchedCount || 1, message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FOURVENUES OPERATIONAL SYNC — orquestador completo (venue_integration)
// ═══════════════════════════════════════════════════════════════════════════
// syncVenueIntegration() COMPLETA runIntegrationSync() (no lo sustituye ni
// crea un framework paralelo): reutiliza startSyncRun/finishSyncRun/
// recordVenueIntegrationResult/decryptCredentials/canSync ya existentes en
// este mismo archivo, y añade la cadena real que faltaba: EVENTS → RATES →
// ORDERS/TICKETS → ATTENDANCE (orden obligatorio — nunca se procesa
// attendance de un evento sin mapping resuelto, ver eventCatalogSync.ts).
//
// Hoy solo soporta el provider "fourvenues_integrations" — es el único
// venue_integration real (Weezevent es event_integration, otro modelo). Un
// futuro segundo provider de venue_integration se añadiría aquí, nunca
// bifurcando el resto del orquestador.

function resolveFourvenuesBaseUrl(environment: VenueIntegration["environment"]): string {
  return FOURVENUES_INTEGRATIONS_BASE_URL[environment];
}

/**
 * Paymentless Tickets & Admissions Hardening — clasificación PURA (sin I/O)
 * de los tickets crudos de un evento: agrupados por externalOrderId
 * (payment_id) para el pipeline de pedidos existente, o aparte si no tienen
 * ninguno (tickets reales sin checkout online — ver ingestPaymentlessTicket
 * para el porqué). Extraída como función independiente para poder probar
 * la mezcla "pedido + paymentless" sin mockear todo el orquestador —
 * ticketsWithOrder + ticketsWithoutOrder === tickets.length siempre, por
 * construcción (spec "ZERO SILENT DROP").
 */
export function classifyTicketsByOrder(tickets: NormalizedTicket[]): { ticketsByOrder: Map<string, NormalizedTicket[]>; paymentlessTickets: NormalizedTicket[] } {
  const ticketsByOrder = new Map<string, NormalizedTicket[]>();
  const paymentlessTickets: NormalizedTicket[] = [];
  for (const t of tickets) {
    if (!t.externalOrderId) { paymentlessTickets.push(t); continue; }
    const list = ticketsByOrder.get(t.externalOrderId) ?? [];
    list.push(t);
    ticketsByOrder.set(t.externalOrderId, list);
  }
  return { ticketsByOrder, paymentlessTickets };
}

export interface VenueSyncOptions {
  /** spec §53/54 — ventana de sync configurable (piloto Casanova recomendado: 30/90). Sin especificar, usa el default amplio del adapter (180/365). */
  historyFromDays?: number;
  futureUntilDays?: number;
  /** spec §39-40 — compras/asistencias anteriores a esta fecha se persisten pero NUNCA generan tokens/Benefits. */
  loyaltyEffectiveFrom?: Date | null;
  /**
   * Casanova Historical Validation (spec §22/§27): fuerza `suppressLoyalty`
   * en CADA `ingestTicketPurchase`/`ingestAttendance` de este run, sin
   * excepción y sin depender de `loyaltyEffectiveFrom` — para una ventana
   * histórica deliberada no queremos que un `purchasedAt`/`occurredAt` nulo
   * o mal interpretado deje pasar un reward por accidente. Persistencia de
   * events/orders/tickets/attendance/Student 360 NUNCA se ve afectada — solo
   * earnTokens/evaluateBenefitsForOrigin/el domain event "ticket_purchased".
   * Por defecto `false` — un sync en vivo no cambia de comportamiento.
   */
  historicalImport?: boolean;
  /**
   * Production Scheduler (2026-08-13) — override EXPLÍCITO por encima de
   * `historicalImport`/`integration.loyaltyEnabled` (precedencia completa en
   * `resolveSuppressLoyalty()` más abajo). Existe para separar dos ejes que
   * antes estaban acoplados: "¿sincronizamos datos en vivo?" (sí, siempre
   * que canSync() lo permita) y "¿concedemos loyalty por ellos?" (NO todavía
   * — piloto scheduler con loyalty_enabled=false por defecto). Un sync
   * programado (scheduler) NUNCA usa `historicalImport: true` — sería una
   * etiqueta semánticamente falsa (no es una importación histórica) — usa
   * en su lugar el gate real: `integration.loyaltyEnabled`.
   */
  suppressLoyalty?: boolean;
  /** Production Scheduler — quién disparó este run, solo para observabilidad (integration_sync_runs.metadata). Nunca cambia el comportamiento del sync. */
  trigger?: "manual" | "scheduler";
  /** Production Scheduler — ventana estrecha/frecuente vs amplia/espaciada (spec §15-17), solo para observabilidad. */
  mode?: "incremental" | "reconciliation";
}

/**
 * Precedencia completa (Production Scheduler, spec §41-43): un flag
 * explícito SIEMPRE gana; si no se pasa ninguno, se suprime loyalty salvo
 * que `integration.loyaltyEnabled` esté activado explícitamente en la fila
 * — "no default-on": una integración recién creada (loyalty_enabled=false
 * por columna DEFAULT) nunca concede tokens aunque el scheduler ya esté
 * sincronizando datos en vivo.
 */
function resolveSuppressLoyalty(opts: VenueSyncOptions, integration: Pick<VenueIntegration, "loyaltyEnabled">): boolean {
  if (opts.suppressLoyalty !== undefined) return opts.suppressLoyalty;
  if (opts.historicalImport) return true;
  return !integration.loyaltyEnabled;
}

export interface DryRunEventPreview {
  externalId: string;
  name: string;
  alreadyMapped: boolean;
}

export interface DryRunResult {
  status: "ok" | "blocked";
  message?: string;
  venueId: number | null;
  eventsFound: number;
  mappedEvents: number;
  newEvents: number;
  ratesFound: number;
  ordersFound: number;
  ticketsFound: number;
  /** Paymentless Tickets & Admissions Hardening — tickets crudos SIN externalOrderId (payment_id ausente en Fourvenues). ticketsFound = ticketsWithOrder + ticketsWithoutOrder, siempre. */
  ticketsWithOrder: number;
  ticketsWithoutOrder: number;
  attendanceFound: number;
  identitiesResolvable: number;
  identitiesUnresolved: number;
  events: DryRunEventPreview[];
}

function blockedDryRun(venueId: number | null, message: string): DryRunResult {
  return {
    status: "blocked", message, venueId,
    eventsFound: 0, mappedEvents: 0, newEvents: 0, ratesFound: 0, ordersFound: 0, ticketsFound: 0,
    ticketsWithOrder: 0, ticketsWithoutOrder: 0, attendanceFound: 0,
    identitiesResolvable: 0, identitiesUnresolved: 0, events: [],
  };
}

/**
 * PREVIEW / DRY RUN (spec §10, §83-84): Fourvenues → normalize, SIN
 * persistir ningún dato de negocio — ni events/ticket_types/orders/tickets/
 * attendance ni identity mappings (`resolveIdentity()` es de solo lectura
 * por diseño, ver identityResolver.ts — seguro llamarla aquí). Requiere el
 * kill switch global + credenciales configuradas (mismo listón que
 * testVenueConnection, NO exige `syncEnabled` — un dry run es cómo se
 * decide si activar el sync real, no puede depender de que ya esté activo).
 */
export async function dryRunVenueIntegration(venueIntegrationId: number, opts: VenueSyncOptions = {}, db?: DbHandle): Promise<DryRunResult> {
  const integration = await getVenueIntegrationRaw(venueIntegrationId);
  if (!integration) return blockedDryRun(null, "Integración no encontrada");
  if (!isExternalIntegrationsGloballyEnabled()) return blockedDryRun(integration.venueId, "Kill switch global desactivado (EXTERNAL_INTEGRATIONS_ENABLED)");
  if (!integration.credentialsEncrypted) return blockedDryRun(integration.venueId, "Sin credenciales configuradas");
  const credentials = decryptCredentials(integration.credentialsEncrypted);
  if (!credentials) return blockedDryRun(integration.venueId, "No se pudieron descifrar las credenciales");
  const provider = await getProviderById(integration.providerId);
  if (provider?.key !== "fourvenues_integrations") {
    return blockedDryRun(integration.venueId, `Proveedor "${provider?.key ?? "desconocido"}" no soportado por el sync operativo — solo fourvenues_integrations`);
  }

  const adapter = createFourvenuesIntegrationsAdapter(
    createHttpTransport(resolveFourvenuesBaseUrl(integration.environment)),
    undefined,
    { historyFromDays: opts.historyFromDays, futureUntilDays: opts.futureUntilDays }
  );
  const conn = db ?? (await getDb());
  const events = await adapter.listEvents(credentials);

  let mappedEvents = 0, ratesFound = 0, ordersFound = 0, ticketsFound = 0, attendanceFound = 0;
  let ticketsWithOrder = 0, ticketsWithoutOrder = 0;
  let identitiesResolvable = 0, identitiesUnresolved = 0;
  const preview: DryRunEventPreview[] = [];

  for (const ev of events) {
    const internalId = await findInternalIdForExternal("fourvenues_integrations", "event", ev.externalId, conn);
    const alreadyMapped = internalId != null;
    if (alreadyMapped) mappedEvents++;
    preview.push({ externalId: ev.externalId, name: ev.name, alreadyMapped });

    let orders: NormalizedOrder[] = [];
    let tickets: NormalizedTicket[] = [];
    try {
      ratesFound += (await adapter.listTicketTypes(credentials, ev.externalId)).length;
    } catch (err) { if (!(err instanceof CapabilityNotSupportedError)) throw err; }
    try {
      orders = await adapter.listOrders(credentials, ev.externalId);
      ordersFound += orders.length;
    } catch (err) { if (!(err instanceof CapabilityNotSupportedError)) throw err; }
    try {
      tickets = await adapter.listTickets(credentials, ev.externalId);
      ticketsFound += tickets.length;
      for (const t of tickets) { if (t.externalOrderId) ticketsWithOrder++; else ticketsWithoutOrder++; }
    } catch (err) { if (!(err instanceof CapabilityNotSupportedError)) throw err; }
    try {
      attendanceFound += (await adapter.listAttendance(credentials, ev.externalId)).length;
    } catch (err) { if (!(err instanceof CapabilityNotSupportedError)) throw err; }

    const orderByExternalId = new Map(orders.map(o => [o.externalId, o]));
    for (const t of tickets) {
      const order = t.externalOrderId ? orderByExternalId.get(t.externalOrderId) : undefined;
      const identity = await resolveIdentity({ provider: "fourvenues_integrations", participant: t.participant, buyer: order?.buyer ?? null }, conn);
      if (identity.userId) identitiesResolvable++; else identitiesUnresolved++;
    }
  }

  return {
    status: "ok", venueId: integration.venueId,
    eventsFound: events.length, mappedEvents, newEvents: events.length - mappedEvents,
    ratesFound, ordersFound, ticketsFound, ticketsWithOrder, ticketsWithoutOrder, attendanceFound,
    identitiesResolvable, identitiesUnresolved, events: preview,
  };
}

export interface VenueSyncResult {
  /** "skipped_locked" — Production Scheduler: ya había un run en curso para esta integración (manual+scheduler o scheduler+scheduler en 2 instancias) — nunca se ejecuta en paralelo, ver tryAcquireSyncLock. */
  status: "success" | "partial" | "failed" | "skipped_disabled" | "skipped_locked";
  message?: string;
  venueId: number | null;
  eventsFound: number;
  eventsCreated: number;
  eventsUpdated: number;
  eventsAmbiguous: number;
  ratesSynced: number;
  ordersCreated: number;
  ordersUpdated: number;
  ticketsUnresolved: number;
  /**
   * Paymentless Tickets & Admissions Hardening — desglose completo de
   * `ticketsFound` (spec "ZERO SILENT DROP", 929 = ticketsWithOrder +
   * ticketsWithoutOrder, siempre, por construcción: todo ticket crudo entra
   * por la rama de pedido O por la de paymentless, nunca se descarta en
   * silencio). No existen categorías "ignored"/"invalid" en esta
   * implementación — el DTO real de Fourvenues siempre trae externalId y
   * eventId válidos, así que la única forma de que un ticket no termine
   * clasificado es una excepción concreta durante su inserción, ya cubierta
   * por `failedCount` (mismo criterio de aislamiento de fallos que el resto
   * del sync).
   */
  ticketsFound: number;
  ticketsWithOrder: number;
  ticketsWithoutOrder: number;
  paymentlessCreated: number;
  paymentlessAlreadyExists: number;
  paymentlessUnresolved: number;
  /** Cuántos de los tickets paymentless también aparecen en listAttendance() de su evento — real, medido, no estimado. */
  paymentlessAttended: number;
  attendanceProcessed: number;
  attendanceUnresolved: number;
  failedCount: number;
}

function emptyVenueSyncResult(status: VenueSyncResult["status"], venueId: number | null, message?: string): VenueSyncResult {
  return {
    status, message, venueId, eventsFound: 0, eventsCreated: 0, eventsUpdated: 0, eventsAmbiguous: 0,
    ratesSynced: 0, ordersCreated: 0, ordersUpdated: 0, ticketsUnresolved: 0,
    ticketsFound: 0, ticketsWithOrder: 0, ticketsWithoutOrder: 0,
    paymentlessCreated: 0, paymentlessAlreadyExists: 0, paymentlessUnresolved: 0, paymentlessAttended: 0,
    attendanceProcessed: 0, attendanceUnresolved: 0, failedCount: 0,
  };
}

/**
 * SYNC REAL de escritura — 1 venue_integration. Orden obligatorio (spec §49):
 * EVENTS → RATES → ORDERS/TICKETS → ATTENDANCE; un evento AMBIGUO
 * (eventCatalogSync no pudo mapearlo sin ambigüedad) se omite de este run
 * por completo — nunca se ingiere una compra/asistencia de un evento sin
 * mapping resuelto. Aislamiento de fallos (spec §56): un error recuperable
 * en UN evento (o UN pedido/una asistencia) se cuenta y se continúa; solo un
 * error ANTES de listEvents (auth/credenciales/red) aborta el run completo.
 */
export async function syncVenueIntegration(venueIntegrationId: number, opts: VenueSyncOptions = {}, db?: DbHandle): Promise<VenueSyncResult> {
  const integration = await getVenueIntegrationRaw(venueIntegrationId);
  if (!integration) return emptyVenueSyncResult("failed", null, "Integración no encontrada");
  if (!canSync(integration)) {
    return emptyVenueSyncResult("skipped_disabled", integration.venueId, "Integración deshabilitada (kill switch) — ver EXTERNAL_INTEGRATIONS_ENABLED / integration.enabled / credenciales / syncEnabled");
  }

  const credentials = decryptCredentials(integration.credentialsEncrypted);
  if (!credentials) return emptyVenueSyncResult("failed", integration.venueId, "No se pudieron descifrar las credenciales");

  const provider = await getProviderById(integration.providerId);
  if (provider?.key !== "fourvenues_integrations") {
    return emptyVenueSyncResult("failed", integration.venueId, `Proveedor "${provider?.key ?? "desconocido"}" no soportado por syncVenueIntegration`);
  }

  const adapter = createFourvenuesIntegrationsAdapter(
    createHttpTransport(resolveFourvenuesBaseUrl(integration.environment)),
    undefined,
    { historyFromDays: opts.historyFromDays, futureUntilDays: opts.futureUntilDays }
  );

  // Lock (Production Scheduler, spec §26-31): manual Sync Now y el scheduler
  // automático comparten EXACTAMENTE este mismo punto de entrada — si ya hay
  // un run "running" no obsoleto para esta integración (el otro disparador,
  // u otra instancia de Railway), este intento se rinde inmediatamente sin
  // tocar Fourvenues ni la BD de negocio. Nunca dos syncs de la misma
  // integración en paralelo.
  const lock = await tryAcquireSyncLock(
    "venue_integration", integration.id, "incremental",
    { trigger: opts.trigger ?? "manual", mode: opts.mode ?? "incremental", historyFromDays: opts.historyFromDays ?? null, futureUntilDays: opts.futureUntilDays ?? null },
  );
  if (!lock.acquired || !lock.run) {
    return emptyVenueSyncResult("skipped_locked", integration.venueId, lock.reason ?? "sync already running");
  }
  const run = lock.run;
  const suppressLoyalty = resolveSuppressLoyalty(opts, integration);
  const conn = db ?? (await getDb());

  let fetchedCount = 0, failedCount = 0;
  let eventsCreated = 0, eventsUpdated = 0, eventsAmbiguous = 0, ratesSynced = 0;
  let ordersCreated = 0, ordersUpdated = 0, ticketsUnresolved = 0;
  let ticketsFound = 0, ticketsWithOrder = 0, ticketsWithoutOrder = 0;
  let paymentlessCreated = 0, paymentlessAlreadyExists = 0, paymentlessUnresolved = 0, paymentlessAttended = 0;
  let attendanceProcessed = 0, attendanceUnresolved = 0;

  try {
    const communityIds = (
      await conn.select({ communityId: communityVenues.communityId }).from(communityVenues).where(eq(communityVenues.venueId, integration.venueId))
    ).map(r => r.communityId);

    const normalizedEvents = await adapter.listEvents(credentials);
    fetchedCount += normalizedEvents.length;

    const catalogResult = await syncEventCatalog({
      provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: integration.id,
      venueId: integration.venueId, communityIds, normalizedEvents,
    }, conn);
    eventsCreated = catalogResult.createdCount;
    eventsAmbiguous = catalogResult.ambiguousCount;
    eventsUpdated = catalogResult.items.filter(i => i.outcome === "mapped_existing" || i.outcome === "candidate_adopted").length;

    for (const item of catalogResult.items) {
      if (item.eventId == null) continue; // ambiguo — sin mapping resuelto, se omite (spec §12/§48)
      try {
        const rateTypes = await adapter.listTicketTypes(credentials, item.externalId);
        const rateResult = await syncTicketTypes({
          provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: integration.id,
          eventId: item.eventId, normalizedTicketTypes: rateTypes,
        }, conn);
        ratesSynced += rateResult.createdCount + rateResult.updatedCount;

        const [orders, tickets]: [NormalizedOrder[], NormalizedTicket[]] = await Promise.all([
          adapter.listOrders(credentials, item.externalId),
          adapter.listTickets(credentials, item.externalId),
        ]);
        ticketsFound += tickets.length;
        const { ticketsByOrder, paymentlessTickets } = classifyTicketsByOrder(tickets);
        ticketsWithOrder += tickets.length - paymentlessTickets.length;
        ticketsWithoutOrder += paymentlessTickets.length;

        for (const order of orders) {
          try {
            const result = await ingestTicketPurchase({
              provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: integration.id,
              eventId: item.eventId, venueId: integration.venueId,
              order, tickets: ticketsByOrder.get(order.externalId) ?? [],
              resolveTicketTypeId: (externalId) => (externalId ? rateResult.ticketTypeIdByExternalId.get(externalId) ?? null : null),
              loyaltyEffectiveFrom: opts.loyaltyEffectiveFrom ?? null,
              suppressLoyalty,
            }, conn);
            if (result.status === "created") { ordersCreated++; ticketsUnresolved += result.unresolvedTickets; }
            else if (result.status === "updated") ordersUpdated++;
          } catch {
            failedCount++; // pedido concreto irrecuperable — se cuenta y se continúa con el resto (spec §56)
          }
        }

        // Paymentless Tickets & Admissions Hardening — tickets reales SIN
        // externalOrderId (payment_id ausente en Fourvenues) nunca se
        // descartan en silencio: se persisten como event_tickets con
        // order_id=null (ver ingestPaymentlessTicket, ya soportado por el
        // schema real sin migración). Nunca toca loyalty.
        const attendanceListForLinking = await adapter.listAttendance(credentials, item.externalId);
        const attendedExternalTicketIds = new Set(attendanceListForLinking.map(a => a.externalTicketId).filter((id): id is string => !!id));
        for (const t of paymentlessTickets) {
          try {
            const result = await ingestPaymentlessTicket({
              provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: integration.id,
              eventId: item.eventId, venueId: integration.venueId,
              ticket: t,
              resolveTicketTypeId: (externalId) => (externalId ? rateResult.ticketTypeIdByExternalId.get(externalId) ?? null : null),
            }, conn);
            if (result.status === "created") {
              paymentlessCreated++;
              if (!result.identityResolved) paymentlessUnresolved++;
            } else {
              paymentlessAlreadyExists++;
            }
            if (attendedExternalTicketIds.has(t.externalId)) paymentlessAttended++;
          } catch {
            failedCount++;
          }
        }

        // Vincula event_attendance.ticket_id al event_ticket real cuando se
        // conoce (con order o paymentless) — antes nunca se poblaba, para
        // NINGÚN ticket. Consulta única por evento, no por página/proveedor externo.
        const allExternalTicketIds = tickets.map(t => t.externalId);
        const ticketIdByExternalId = new Map<string, number>();
        if (allExternalTicketIds.length > 0) {
          const rows = await conn.select({ id: eventTickets.id, externalTicketId: eventTickets.externalTicketId })
            .from(eventTickets)
            .where(and(eq(eventTickets.provider, "fourvenues_integrations"), inArray(eventTickets.externalTicketId, allExternalTicketIds)));
          for (const r of rows) if (r.externalTicketId) ticketIdByExternalId.set(r.externalTicketId, r.id);
        }

        for (const a of attendanceListForLinking) {
          try {
            const result = await ingestAttendance({
              provider: "fourvenues_integrations", integrationType: "venue_integration", integrationId: integration.id,
              eventId: item.eventId, venueId: integration.venueId, attendance: a,
              ticketId: a.externalTicketId ? ticketIdByExternalId.get(a.externalTicketId) ?? null : null,
              suppressLoyalty,
            }, conn);
            if (result.status === "processed") attendanceProcessed++;
            else if (result.status === "unresolved") attendanceUnresolved++;
          } catch {
            failedCount++;
          }
        }
      } catch {
        failedCount++; // fallo recuperable a nivel de EVENTO completo — no aborta el venue entero
      }
    }

    const createdCount = eventsCreated + ordersCreated + paymentlessCreated;
    const updatedCount = eventsUpdated + ordersUpdated;
    const unresolvedCount = ticketsUnresolved + attendanceUnresolved + paymentlessUnresolved;

    await setSyncCursor("venue_integration", integration.id, null, new Date(), conn);
    const status: VenueSyncResult["status"] = failedCount > 0 ? "partial" : "success";
    await finishSyncRun(run.id, { fetchedCount, createdCount, updatedCount, unresolvedCount, failedCount }, status);
    await recordVenueIntegrationResult(integration.id, true, null);

    return {
      status, venueId: integration.venueId, eventsFound: normalizedEvents.length,
      eventsCreated, eventsUpdated, eventsAmbiguous, ratesSynced, ordersCreated, ordersUpdated,
      ticketsUnresolved, ticketsFound, ticketsWithOrder, ticketsWithoutOrder,
      paymentlessCreated, paymentlessAlreadyExists, paymentlessUnresolved, paymentlessAttended,
      attendanceProcessed, attendanceUnresolved, failedCount,
    };
  } catch (err) {
    // Error NO recuperable (auth/credenciales/red antes de poder listar eventos) — aborta el run completo (spec §56).
    const message = err instanceof Error ? err.message : String(err);
    await finishSyncRun(run.id, { fetchedCount, createdCount: 0, updatedCount: 0, unresolvedCount: 0, failedCount: failedCount || 1 }, "failed", message);
    await recordVenueIntegrationResult(integration.id, false, message);
    return emptyVenueSyncResult("failed", integration.venueId, message);
  }
}

// ─── ADMIN STATUS (Production Scheduler, spec §61/§101) ───────────────────────
// Sin dashboard — solo lo mínimo para responder "¿está el scheduler activo,
// cuándo sincronizó por última vez, cuándo toca la próxima?" en el panel de
// integración ya existente. `schedulerProcessRunning` llega desde
// integrationScheduler.ts (estado del proceso, no de BD — un cron registrado
// en ESTA instancia de Railway).
export interface IntegrationSchedulerStatus {
  schedulerProcessRunning: boolean;
  due: boolean | null;
  locked: boolean;
  currentRun: { id: number; startedAt: Date; syncType: string } | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  syncIntervalMinutes: number | null;
  nextDueAt: Date | null;
  loyaltyEnabled: boolean;
}

export async function getIntegrationSchedulerStatus(
  venueIntegrationId: number,
  schedulerProcessRunning: boolean,
  defaultIntervalMinutes: number,
): Promise<IntegrationSchedulerStatus | null> {
  const integration = await getVenueIntegrationRaw(venueIntegrationId);
  if (!integration) return null;
  const lock = await getCurrentLockStatus("venue_integration", integration.id);
  const intervalMinutes = integration.syncIntervalMinutes ?? defaultIntervalMinutes;
  const nextDueAt = integration.lastSuccessAt ? new Date(integration.lastSuccessAt.getTime() + intervalMinutes * 60_000) : null;
  return {
    schedulerProcessRunning,
    due: canSync(integration) ? isDueForScheduledSync(integration, new Date(), defaultIntervalMinutes) : null,
    locked: lock.locked,
    currentRun: lock.run ? { id: lock.run.id, startedAt: lock.run.startedAt, syncType: lock.run.syncType } : null,
    lastSuccessAt: integration.lastSuccessAt,
    lastErrorAt: integration.lastErrorAt,
    lastErrorMessage: integration.lastErrorMessage,
    syncIntervalMinutes: integration.syncIntervalMinutes,
    nextDueAt,
    loyaltyEnabled: integration.loyaltyEnabled,
  };
}
