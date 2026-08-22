import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import {
  listProviders, listVenueIntegrations, listEventIntegrations,
  createVenueIntegration, createEventIntegration,
  setVenueIntegrationEnabled, setEventIntegrationEnabled, setEventIntegrationLoyaltyEnabled,
  updateVenueIntegrationCredentials,
  getVenueIntegrationRaw, getEventIntegrationRaw, getProviderById,
  listSyncRuns,
} from "../segolife/integrations/integrationsDb";
import { listUnresolvedOperations, linkUnresolvedOperation, ignoreUnresolvedOperation, UnresolvedOperationError } from "../segolife/integrations/unresolvedOperationsService";
import { createFourvenuesAdapter, FOURVENUES_BASE_URL } from "../segolife/integrations/fourvenuesAdapter";
import { createFourvenuesIntegrationsAdapter, FOURVENUES_INTEGRATIONS_BASE_URL } from "../segolife/integrations/fourvenuesIntegrationsAdapter";
import { createWeezeventAdapter, WEEZEVENT_BASE_URL } from "../segolife/integrations/weezeventAdapter";
import { createHttpTransport } from "../segolife/integrations/httpTransport";
import { decryptCredentials } from "../segolife/integrations/integrationCredentialCrypto";
import { isExternalIntegrationsGloballyEnabled, syncVenueIntegration, dryRunVenueIntegration, syncEventIntegration, dryRunEventIntegration, getIntegrationSchedulerStatus } from "../segolife/integrations/integrationSyncService";
import { isFourvenuesSchedulerRunning, DEFAULT_INCREMENTAL_INTERVAL_MINUTES } from "../segolife/integrations/integrationScheduler";
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

  createEventIntegration: integrationsManageProcedure
    .input(z.object({
      eventId: z.number().int().positive(),
      providerId: z.number().int().positive(),
      externalEventId: z.string().max(128).nullish(),
      environment: z.enum(["sandbox", "production"]),
      apiKey: z.string().max(512).nullish(),
      username: z.string().max(256).nullish(),
      password: z.string().max(256).nullish(),
    }))
    .mutation(({ input }) => createEventIntegration({
      eventId: input.eventId,
      providerId: input.providerId,
      externalEventId: input.externalEventId,
      environment: input.environment,
      credentials: (input.apiKey || input.username) ? { apiKey: input.apiKey ?? undefined, username: input.username ?? undefined, password: input.password ?? undefined } : undefined,
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

  testEventConnection: integrationsManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const integration = await getEventIntegrationRaw(input.id);
      if (!integration) throw new TRPCError({ code: "NOT_FOUND" });
      if (!integration.credentialsEncrypted) return { ok: false, message: "Awaiting credentials" };
      const credentials = decryptCredentials(integration.credentialsEncrypted);
      if (!credentials) return { ok: false, message: "No se pudieron descifrar las credenciales" };
      const adapter = createWeezeventAdapter(createHttpTransport(WEEZEVENT_BASE_URL));
      return adapter.testConnection(credentials);
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
    })),

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
