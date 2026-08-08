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
import type { VenueIntegration, EventIntegration } from "../../../drizzle/schema";
import { startSyncRun, finishSyncRun, recordVenueIntegrationResult } from "./integrationsDb";
import { CapabilityNotSupportedError, type ExternalTicketingProvider } from "./externalTicketingProvider";
import { decryptCredentials } from "./integrationCredentialCrypto";

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
