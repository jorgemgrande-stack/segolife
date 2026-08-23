import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import {
  listProviders, listVenueIntegrations, listEventIntegrations,
  createVenueIntegration,
  setVenueIntegrationEnabled, setEventIntegrationEnabled, setEventIntegrationLoyaltyEnabled,
  updateVenueIntegrationCredentials,
  getVenueIntegrationRaw, getEventIntegrationRaw, getProviderById, getProviderByKey,
  listSyncRuns,
  getTheWeezeventConnection, getWeezeventConnectionRaw, createWeezeventConnection,
  updateWeezeventConnectionCredentials, disconnectWeezeventConnection,
  recordWeezeventConnectionTestResult, updateWeezeventDiscoveredEvents,
  linkWeezeventEvent as linkWeezeventEventDb, WeezeventLinkError,
} from "../segolife/integrations/integrationsDb";
import { listUnresolvedOperations, linkUnresolvedOperation, ignoreUnresolvedOperation, UnresolvedOperationError } from "../segolife/integrations/unresolvedOperationsService";
import { createFourvenuesAdapter, FOURVENUES_BASE_URL } from "../segolife/integrations/fourvenuesAdapter";
import { createFourvenuesIntegrationsAdapter, FOURVENUES_INTEGRATIONS_BASE_URL } from "../segolife/integrations/fourvenuesIntegrationsAdapter";
import { createWeezeventAdapter, getWeezeventAccessToken, WEEZEVENT_BASE_URL } from "../segolife/integrations/weezeventAdapter";
import { createHttpTransport, HttpTransportError } from "../segolife/integrations/httpTransport";
import { decryptCredentials } from "../segolife/integrations/integrationCredentialCrypto";
import { isExternalIntegrationsGloballyEnabled, syncVenueIntegration, dryRunVenueIntegration, syncEventIntegration, dryRunEventIntegration, getIntegrationSchedulerStatus, getEventIntegrationSchedulerStatus } from "../segolife/integrations/integrationSyncService";
import { isFourvenuesSchedulerRunning, DEFAULT_INCREMENTAL_INTERVAL_MINUTES } from "../segolife/integrations/integrationScheduler";
import { isWeezeventSchedulerRunning, resolveWeezeventSyncIntervalMinutes } from "../segolife/integrations/weezeventScheduler";
import { getEventIntegrationMatchStats, getEventDatesForScheduler } from "../segolife/integrations/integrationsDb";
import { processCommerceLoyalty } from "../segolife/commerce/commercePipeline";
import { ingestAttendance } from "../segolife/ticketing/attendancePipeline";
import { commerceTransactions, eventTickets } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

const integrationsViewProcedure = permissionProcedure("integrations.view", ["admin"]);
const integrationsManageProcedure = permissionProcedure("integrations.manage", ["admin"]);

function mapUnresolvedError(err: unknown): never {
  if (err instanceof UnresolvedOperationError) {
    throw new TRPCError({ code: err.code === "NOT_FOUND" ? "NOT_FOUND" : "CONFLICT", message: err.message, cause: err });
  }
  throw err;
}

/**
 * Clasificación de errores de Weezevent (cierre F71, spec §6/§20/§29) — nunca
 * expone el body crudo del proveedor (podría llevar datos no pensados para
 * mostrar), solo un mensaje comprensible por status HTTP real.
 */
function classifyWeezeventError(err: unknown): string {
  if (err instanceof HttpTransportError) {
    if (err.status === 401) return "Credenciales incorrectas o Access Token inválido/caducado";
    if (err.status === 403) return "Sin permisos suficientes para esta API key";
    if (err.status === 429) return "Límite de peticiones de Weezevent alcanzado (fair use) — inténtalo más tarde";
    if (err.status >= 500) return "Weezevent no está disponible ahora mismo (error del servidor)";
    return `Weezevent devolvió un error (HTTP ${err.status})`;
  }
  if (err instanceof Error) return `No se pudo conectar con Weezevent: ${err.message}`;
  return "No se pudo conectar con Weezevent";
}

/**
 * Único punto real de "hablar con Weezevent" para la conexión (cierre F71):
 * usado tanto por [Test connection] (creación y comprobación manual) como
 * por [Actualizar eventos] — son la MISMA operación (auth real + GET
 * /events), nunca una lógica duplicada. Cachea la lista de eventos
 * descubiertos en la conexión (fair use — nunca se re-consulta en cada
 * render del selector de vinculación).
 */
async function testAndCacheWeezeventConnection(connectionId: number): Promise<{ ok: boolean; message: string; eventsAccessibleCount?: number }> {
  const row = await getWeezeventConnectionRaw(connectionId);
  if (!row) return { ok: false, message: "Conexión no encontrada" };
  const credentials = decryptCredentials(row.credentialsEncrypted);
  if (!credentials) return { ok: false, message: "No se pudieron descifrar las credenciales" };
  const adapter = createWeezeventAdapter(createHttpTransport(WEEZEVENT_BASE_URL));
  try {
    const events = await adapter.listEvents(credentials);
    await recordWeezeventConnectionTestResult(connectionId, true, null, events.length);
    await updateWeezeventDiscoveredEvents(connectionId, events.map(e => ({
      externalId: e.externalId,
      name: e.name,
      startsAt: e.startsAt ? e.startsAt.toISOString() : null,
      endsAt: e.endsAt ? e.endsAt.toISOString() : null,
      multipleDates: !!(e.raw as { multipleDates?: boolean } | undefined)?.multipleDates,
    })));
    return { ok: true, message: `Weezevent conectado — ${events.length} evento${events.length === 1 ? "" : "s"} accesible${events.length === 1 ? "" : "s"}`, eventsAccessibleCount: events.length };
  } catch (err) {
    const message = classifyWeezeventError(err);
    await recordWeezeventConnectionTestResult(connectionId, false, message, null);
    return { ok: false, message };
  }
}

export const integrationsRouter = router({
  // ── Estado global (kill switch) — informativo, nunca se cambia desde la UI ──
  getGlobalStatus: integrationsViewProcedure.query(() => ({
    externalIntegrationsEnabled: isExternalIntegrationsGloballyEnabled(),
  })),

  listProviders: integrationsViewProcedure.query(() => listProviders()),

  listVenueIntegrations: integrationsViewProcedure
    .input(z.object({ venueId: z.number().int().positive().optional() }))
    .query(({ input }) => listVenueIntegrations(input.venueId)),

  listEventIntegrations: integrationsViewProcedure
    .input(z.object({ eventId: z.number().int().positive().optional() }))
    .query(({ input }) => listEventIntegrations(input.eventId)),

  createVenueIntegration: integrationsManageProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      providerId: z.number().int().positive(),
      externalAccountId: z.string().max(128).nullish(),
      externalVenueId: z.string().max(128).nullish(),
      environment: z.enum(["sandbox", "production"]),
      apiKey: z.string().max(512).nullish(),
    }))
    .mutation(({ input }) => createVenueIntegration({
      venueId: input.venueId,
      providerId: input.providerId,
      externalAccountId: input.externalAccountId,
      externalVenueId: input.externalVenueId,
      environment: input.environment,
      credentials: input.apiKey ? { apiKey: input.apiKey } : undefined,
      credentialsDisplayValue: input.apiKey ?? undefined,
    })),

  setVenueIntegrationEnabled: integrationsManageProcedure
    .input(z.object({ id: z.number().int().positive(), enabled: z.boolean() }))
    .mutation(({ input }) => setVenueIntegrationEnabled(input.id, input.enabled)),

  setEventIntegrationEnabled: integrationsManageProcedure
    .input(z.object({ id: z.number().int().positive(), enabled: z.boolean() }))
    .mutation(({ input }) => setEventIntegrationEnabled(input.id, input.enabled)),

  // F71 — mismo gate desacoplado que setVenueIntegrationLoyaltyEnabled (migración 0171).
  setEventIntegrationLoyaltyEnabled: integrationsManageProcedure
    .input(z.object({ id: z.number().int().positive(), loyaltyEnabled: z.boolean() }))
    .mutation(({ input }) => setEventIntegrationLoyaltyEnabled(input.id, input.loyaltyEnabled)),

  updateVenueIntegrationCredentials: integrationsManageProcedure
    .input(z.object({ id: z.number().int().positive(), apiKey: z.string().min(1).max(512) }))
    .mutation(({ input }) => updateVenueIntegrationCredentials(input.id, { apiKey: input.apiKey }, input.apiKey)),

  /**
   * Test connection (spec punto 54): sin credenciales → "Awaiting
   * credentials". Con credenciales, usa transport HTTP real contra el
   * entorno configurado (sandbox por defecto) — NUNCA se activa un sync
   * completo, solo verifica que las credenciales autentican.
   */
  testVenueConnection: integrationsManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const integration = await getVenueIntegrationRaw(input.id);
      if (!integration) throw new TRPCError({ code: "NOT_FOUND" });
      if (!integration.credentialsEncrypted) return { ok: false, message: "Awaiting credentials" };
      const credentials = decryptCredentials(integration.credentialsEncrypted);
      if (!credentials) return { ok: false, message: "No se pudieron descifrar las credenciales" };
      const provider = await getProviderById(integration.providerId);
      // "fourvenues" (Channel Manager) y "fourvenues_integrations" (Integrations
      // API) son APIs distintas con base URL y endpoints diferentes — ver
      // docs/integrations/fourvenues.md. El modelo real de Segolife hoy es
      // Integrations API (credenciales ik_live_... independientes por venue).
      if (provider?.key === "fourvenues_integrations") {
        const baseUrl = FOURVENUES_INTEGRATIONS_BASE_URL[integration.environment];
        const adapter = createFourvenuesIntegrationsAdapter(createHttpTransport(baseUrl));
        return adapter.testConnection(credentials);
      }
      const baseUrl = FOURVENUES_BASE_URL[integration.environment];
      const adapter = createFourvenuesAdapter(createHttpTransport(baseUrl));
      return adapter.testConnection(credentials);
    }),

  // ── Weezevent CONNECTION (cierre F71, 2026-08-23) — UNA cuenta, MUCHOS
  // eventos vinculados. Nunca acepta credenciales por evento; todo lo que
  // sigue en este bloque opera sobre la conexión única, no sobre un event
  // Integration concreto. ────────────────────────────────────────────────
  getWeezeventConnection: integrationsViewProcedure.query(() => getTheWeezeventConnection()),

  /**
   * Conecta (o reconecta) la cuenta Weezevent. Acepta api_key + accessToken
   * directo, O api_key + username/password para intercambiarlo aquí mismo —
   * en ese caso el username/password se usa SOLO en memoria para esta
   * llamada y NUNCA se guarda (spec cierre F71, punto 16: "una vez obtenido
   * el Access Token... si no [hace falta username/password], NO los
   * guardes"). Tras guardar, prueba la conexión real inmediatamente
   * (GET /events) para no dejar nunca un estado "guardado pero sin probar".
   */
  connectWeezevent: integrationsManageProcedure
    .input(z.object({
      apiKey: z.string().min(1).max(512),
      accessToken: z.string().min(1).max(512).nullish(),
      username: z.string().min(1).max(256).nullish(),
      password: z.string().min(1).max(256).nullish(),
    }))
    .mutation(async ({ input }) => {
      let accessToken = input.accessToken ?? null;
      if (!accessToken) {
        if (!input.username || !input.password) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Indica un Access Token, o tu usuario y contraseña de Weezevent para generarlo" });
        }
        try {
          accessToken = await getWeezeventAccessToken(createHttpTransport(WEEZEVENT_BASE_URL), { apiKey: input.apiKey, username: input.username, password: input.password });
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: classifyWeezeventError(err) });
        }
      }
      // Solo api_key + accessToken llegan a guardarse — username/password ya cumplieron su propósito arriba y se descartan aquí.
      const credentials = { apiKey: input.apiKey, accessToken };
      const existing = await getTheWeezeventConnection();
      let connectionId: number;
      if (existing) {
        await updateWeezeventConnectionCredentials(existing.id, credentials, input.apiKey);
        connectionId = existing.id;
      } else {
        connectionId = (await createWeezeventConnection({ credentials, credentialsDisplayValue: input.apiKey })).id;
      }
      return testAndCacheWeezeventConnection(connectionId);
    }),

  /** Mismo resultado que "Actualizar eventos" (§8 del cierre) — Test connection ya refresca la lista, ambos botones llaman aquí para no duplicar lógica. */
  testWeezeventConnection: integrationsManageProcedure
    .mutation(async () => {
      const existing = await getTheWeezeventConnection();
      if (!existing) return { ok: false, message: "Sin conexión configurada" };
      return testAndCacheWeezeventConnection(existing.id);
    }),

  refreshWeezeventEvents: integrationsManageProcedure
    .mutation(async () => {
      const existing = await getTheWeezeventConnection();
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Sin conexión Weezevent" });
      return testAndCacheWeezeventConnection(existing.id);
    }),

  /** Limpia credenciales/cache — nunca borra la fila ni los vínculos de evento existentes (conservar trazabilidad). */
  disconnectWeezevent: integrationsManageProcedure
    .mutation(async () => {
      const existing = await getTheWeezeventConnection();
      if (existing) await disconnectWeezeventConnection(existing.id);
      return { ok: true };
    }),

  /** Vincula un evento YA DESCUBIERTO (via GET /events, cacheado en la conexión) a un evento Segolife — nunca acepta credenciales ni un ID escrito a mano sin pasar por el descubrimiento. */
  linkWeezeventEvent: integrationsManageProcedure
    .input(z.object({
      eventId: z.number().int().positive(),
      externalEventId: z.string().min(1).max(128),
      externalEventName: z.string().max(256).nullish(),
    }))
    .mutation(async ({ input }) => {
      const provider = await getProviderByKey("weezevent");
      if (!provider) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Provider weezevent no está sembrado" });
      const connection = await getTheWeezeventConnection();
      if (!connection) throw new TRPCError({ code: "BAD_REQUEST", message: "Conecta primero tu cuenta Weezevent" });
      try {
        return await linkWeezeventEventDb({
          connectionId: connection.id, eventId: input.eventId, providerId: provider.id,
          externalEventId: input.externalEventId, externalEventName: input.externalEventName,
        });
      } catch (err) {
        if (err instanceof WeezeventLinkError) throw new TRPCError({ code: "CONFLICT", message: err.message });
        throw err;
      }
    }),

  listSyncRuns: integrationsViewProcedure
    .input(z.object({ integrationType: z.enum(["venue_integration", "event_integration"]), integrationId: z.number().int().positive() }))
    .query(({ input }) => listSyncRuns(input.integrationType, input.integrationId)),

  // ── Fourvenues Operational Sync (spec §9-10, §67-70) ─────────────────────
  // Mismo permiso que el resto de este router — "no crear permiso si no
  // hace falta" (spec §69). NUNCA acepta credenciales del frontend ni un
  // provider arbitrario — ambos se resuelven server-side a partir de
  // `venueIntegrationId` (ver syncVenueIntegration, que además exige el
  // kill switch global + `enabled` + `syncEnabled` de la fila concreta).
  previewVenueSync: integrationsManageProcedure
    .input(z.object({
      id: z.number().int().positive(),
      historyFromDays: z.number().int().positive().max(3650).optional(),
      futureUntilDays: z.number().int().positive().max(3650).optional(),
    }))
    .mutation(({ input }) => dryRunVenueIntegration(input.id, { historyFromDays: input.historyFromDays, futureUntilDays: input.futureUntilDays })),

  syncVenueNow: integrationsManageProcedure
    .input(z.object({
      id: z.number().int().positive(),
      historyFromDays: z.number().int().positive().max(3650).optional(),
      futureUntilDays: z.number().int().positive().max(3650).optional(),
      loyaltyEffectiveFrom: z.string().datetime().optional(),
      /** Casanova Historical Validation §22 — import histórico deliberado: nunca concede tokens/Benefits, sea cual sea purchasedAt/occurredAt. */
      historicalImport: z.boolean().optional(),
    }))
    .mutation(({ input }) => syncVenueIntegration(input.id, {
      historyFromDays: input.historyFromDays,
      futureUntilDays: input.futureUntilDays,
      loyaltyEffectiveFrom: input.loyaltyEffectiveFrom ? new Date(input.loyaltyEffectiveFrom) : null,
      historicalImport: input.historicalImport,
      trigger: "manual", // Production Scheduler — comparte lock/loyalty gate con el scheduler automático (mismo syncVenueIntegration, "ONE SYNC PATH"); si el scheduler tiene un run en curso, este mutation devuelve status="skipped_locked" en vez de ejecutar en paralelo.
    })),

  // ── Production Scheduler (2026-08-13) — estado mínimo para el admin, sin dashboard ──
  getSchedulerStatus: integrationsViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getIntegrationSchedulerStatus(input.id, isFourvenuesSchedulerRunning(), DEFAULT_INCREMENTAL_INTERVAL_MINUTES)),

  // ── Weezevent Sync (F71) — mismo criterio que Fourvenues arriba: nunca
  // acepta credenciales del frontend ni un provider arbitrario, todo se
  // resuelve server-side a partir de `eventIntegrationId`. Sin scheduler
  // automático todavía (Weezevent sin webhooks confirmados/sin credenciales
  // reales para validar cadencia) — solo manual, ver integrationSyncService.ts.
  previewEventSync: integrationsManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => dryRunEventIntegration(input.id)),

  syncEventNow: integrationsManageProcedure
    .input(z.object({
      id: z.number().int().positive(),
      loyaltyEffectiveFrom: z.string().datetime().optional(),
      historicalImport: z.boolean().optional(),
    }))
    .mutation(({ input }) => syncEventIntegration(input.id, {
      loyaltyEffectiveFrom: input.loyaltyEffectiveFrom ? new Date(input.loyaltyEffectiveFrom) : null,
      historicalImport: input.historicalImport,
      trigger: "manual",
      // "ONE SYNC PATH" (spec §16) — comparte lock/loyalty gate con el
      // scheduler automático (mismo syncEventIntegration); si el scheduler
      // tiene un run en curso, este mutation devuelve status="skipped_locked"
      // en vez de ejecutar en paralelo.
      mode: "incremental",
    })),

  // ── Weezevent Live Operations (2026-08-23) — observabilidad/salud/matching,
  // spec §10-11/§13-15. SOLO conteos y estado derivado — nunca una lista de
  // participantes ni ningún dato de contacto individual. ────────────────────
  getEventSchedulerStatus: integrationsViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const integration = await getEventIntegrationRaw(input.id);
      if (!integration || integration.eventId == null) return null;
      const eventRow = await getEventDatesForScheduler(integration.eventId);
      const adaptiveInterval = eventRow ? resolveWeezeventSyncIntervalMinutes(new Date(), eventRow.startsAt, eventRow.endsAt) : null;
      return getEventIntegrationSchedulerStatus(input.id, isWeezeventSchedulerRunning(), adaptiveInterval);
    }),

  /** spec §10 — "Tickets Weezevent / Con email / Students matched / Unmatched / Attendance matched", solo conteos agregados. */
  getEventMatchStats: integrationsViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getEventIntegrationMatchStats(input.id)),

  // ── Unresolved operations (spec punto 56) ────────────────────────────────
  listUnresolved: integrationsViewProcedure
    .input(z.object({ status: z.enum(["unresolved", "linked", "ignored", "conflict"]).default("unresolved") }))
    .query(({ input }) => listUnresolvedOperations(input.status)),

  linkUnresolved: integrationsManageProcedure
    .input(z.object({ id: z.number().int().positive(), userId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const linked = await linkUnresolvedOperation(input.id, input.userId, ctx.user.id);
        // SEGURIDAD (Loyalty Shadow Mode, spec §40 — auditoría de linkUnresolved):
        // a diferencia del scheduler real (integrationSyncService.ts:resolveSuppressLoyalty,
        // que SIEMPRE deriva suppressLoyalty de venueIntegration.loyaltyEnabled), esta
        // mutation legacy llamaba a processCommerceLoyalty/ingestAttendance sin pasar
        // ningún suppressLoyalty — con loyaltyEnabled=false en los 3 venues reales,
        // vincular manualmente una operación de commerce/attendance podía conceder un
        // SegoToken REAL, saltándose por completo la garantía "LIVE loyalty OFF". Se
        // resuelve aquí el mismo criterio que el scheduler, solo para esta mutation.
        const suppressLoyalty = linked.integrationType === "venue_integration" && linked.integrationId
          ? !(await getVenueIntegrationRaw(linked.integrationId))?.loyaltyEnabled
          : true; // sin venue_integration identificable -> por defecto, nunca conceder
        // Reprocesamiento idempotente para COMERCIO: la fila commerce_transactions
        // ya existía (user_id era null) — solo hace falta asociarla y procesar loyalty.
        if (linked.operationType === "commerce" && linked.referenceId) {
          const [tx] = await _db.select().from(commerceTransactions).where(eq(commerceTransactions.id, linked.referenceId)).limit(1);
          if (tx) {
            await _db.update(commerceTransactions).set({ userId: input.userId }).where(eq(commerceTransactions.id, tx.id));
            if (!suppressLoyalty) {
              const [updatedTx] = await _db.select().from(commerceTransactions).where(eq(commerceTransactions.id, tx.id)).limit(1);
              await processCommerceLoyalty(updatedTx);
            }
          }
        }
        // FASE 8 — bloqueador de Fase 5 resuelto: la vinculación manual de
        // ATTENDANCE ahora SÍ reprocesa event_attendance retroactivamente.
        // `unresolved_operations` ya guardaba todo lo necesario para
        // reconstruir el evento normalizado (eventId/venueId/occurredAt/
        // externalReferenceId) — solo faltaba pasarle `resolvedUserId` al
        // pipeline para que se salte resolveIdentity() y use el userId que
        // el admin ya decidió. Idempotente: si esta operación se vincula dos
        // veces (o el mismo externalReferenceId ya se procesó por otra vía),
        // ingestAttendance() detecta la idempotency_key existente y no
        // duplica ni event_attendance ni el ledger de SegoTokens.
        if (linked.operationType === "attendance" && linked.eventId) {
          await ingestAttendance({
            provider: linked.provider,
            integrationType: linked.integrationType ?? null,
            integrationId: linked.integrationId ?? null,
            eventId: linked.eventId,
            venueId: linked.venueId ?? null,
            resolvedUserId: input.userId,
            suppressLoyalty,
            // Loyalty Shadow Mode (spec §9) — vinculación retroactiva de una
            // operación histórica, nunca tráfico "en vivo desde activación".
            isHistoricalImport: true,
            attendance: {
              externalAttendanceId: linked.externalReferenceId ?? `unresolved:${linked.id}`,
              externalEventId: String(linked.eventId),
              participant: { email: linked.identityHintEmail, phone: linked.identityHintPhone, name: linked.identityHintName },
              occurredAt: linked.occurredAt ?? new Date(),
            },
          });
        }
        // Fourvenues Operational Sync (spec §46-47): operationType="order" — el
        // event_tickets YA EXISTE (ticketPurchasePipeline siempre persiste el
        // ticket aunque no resuelva participante, con userId null) — vincular
        // manualmente solo necesita asociar el Student, no reprocesar
        // orders/items ni volver a llamar a Fourvenues. El reward de COMPRA
        // (origin="ticket") es a nivel de PEDIDO/comprador, no de participante
        // — vincular un ticket concreto no lo dispara retroactivamente (mismo
        // criterio que buyer vs participant, ver ticketPurchasePipeline.ts).
        if (linked.operationType === "order" && linked.referenceType === "event_ticket" && linked.referenceId) {
          await _db.update(eventTickets).set({ userId: input.userId }).where(eq(eventTickets.id, linked.referenceId));
        }
        return linked;
      } catch (err) {
        mapUnresolvedError(err);
      }
    }),

  ignoreUnresolved: integrationsManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await ignoreUnresolvedOperation(input.id, ctx.user.id);
      } catch (err) {
        mapUnresolvedError(err);
      }
    }),
});
