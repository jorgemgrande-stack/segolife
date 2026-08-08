import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import {
  listProviders, listVenueIntegrations, listEventIntegrations,
  createVenueIntegration, createEventIntegration,
  setVenueIntegrationEnabled, setEventIntegrationEnabled,
  updateVenueIntegrationCredentials,
  getVenueIntegrationRaw, getEventIntegrationRaw,
  listSyncRuns,
} from "../segolife/integrations/integrationsDb";
import { listUnresolvedOperations, linkUnresolvedOperation, ignoreUnresolvedOperation, UnresolvedOperationError } from "../segolife/integrations/unresolvedOperationsService";
import { createFourvenuesAdapter } from "../segolife/integrations/fourvenuesAdapter";
import { createWeezeventAdapter } from "../segolife/integrations/weezeventAdapter";
import { createHttpTransport } from "../segolife/integrations/httpTransport";
import { FOURVENUES_BASE_URL } from "../segolife/integrations/fourvenuesAdapter";
import { WEEZEVENT_BASE_URL } from "../segolife/integrations/weezeventAdapter";
import { decryptCredentials } from "../segolife/integrations/integrationCredentialCrypto";
import { isExternalIntegrationsGloballyEnabled } from "../segolife/integrations/integrationSyncService";
import { processCommerceLoyalty } from "../segolife/commerce/commercePipeline";
import { ingestAttendance } from "../segolife/ticketing/attendancePipeline";
import { commerceTransactions } from "../../drizzle/schema";
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

  // ── Unresolved operations (spec punto 56) ────────────────────────────────
  listUnresolved: integrationsViewProcedure
    .input(z.object({ status: z.enum(["unresolved", "linked", "ignored", "conflict"]).default("unresolved") }))
    .query(({ input }) => listUnresolvedOperations(input.status)),

  linkUnresolved: integrationsManageProcedure
    .input(z.object({ id: z.number().int().positive(), userId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const linked = await linkUnresolvedOperation(input.id, input.userId, ctx.user.id);
        // Reprocesamiento idempotente para COMERCIO: la fila commerce_transactions
        // ya existía (user_id era null) — solo hace falta asociarla y procesar loyalty.
        if (linked.operationType === "commerce" && linked.referenceId) {
          const [tx] = await _db.select().from(commerceTransactions).where(eq(commerceTransactions.id, linked.referenceId)).limit(1);
          if (tx) {
            await _db.update(commerceTransactions).set({ userId: input.userId }).where(eq(commerceTransactions.id, tx.id));
            const [updatedTx] = await _db.select().from(commerceTransactions).where(eq(commerceTransactions.id, tx.id)).limit(1);
            await processCommerceLoyalty(updatedTx);
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
            attendance: {
              externalAttendanceId: linked.externalReferenceId ?? `unresolved:${linked.id}`,
              externalEventId: String(linked.eventId),
              participant: { email: linked.identityHintEmail, phone: linked.identityHintPhone, name: linked.identityHintName },
              occurredAt: linked.occurredAt ?? new Date(),
            },
          });
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
