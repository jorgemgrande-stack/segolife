/**
 * commandCenterFourvenues.ts — SEGOLIFE ADMIN COMMAND CENTER. `dashboard.getFourvenuesHealth`
 * (spec §13). REUTILIZA el motor de integraciones ya existente
 * (`listVenueIntegrations`/`getIntegrationSchedulerStatus`/`listSyncRuns`,
 * Fase 5) — nunca reimplementa su lógica ni abre conexiones/polling propios.
 *
 * N=3 venues reales hoy — igual que Fourvenues Health en el resto del
 * dashboard, iterar sobre 3 integraciones con `getIntegrationSchedulerStatus`
 * es aceptable (mismo criterio ya usado para Historical Audience por venue:
 * bounded, no una query por Student). Nunca dispara sync, nunca hace poll
 * agresivo — solo LEE estado ya materializado en BD.
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import { listVenueIntegrations, listSyncRuns, type SafeIntegration } from "../integrations/integrationsDb";
import { getIntegrationSchedulerStatus, type IntegrationSchedulerStatus } from "../integrations/integrationSyncService";
import { isFourvenuesSchedulerRunning, DEFAULT_INCREMENTAL_INTERVAL_MINUTES } from "../integrations/integrationScheduler";

export interface VenueIntegrationHealth {
  integrationId: number;
  venueId: number | null;
  venueName: string | null;
  providerKey: string;
  environment: "sandbox" | "production";
  enabled: boolean;
  status: SafeIntegration["status"];
  syncEnabled: boolean;
  loyaltyEnabled: boolean;
  credentialsConfigured: boolean;
  scheduler: IntegrationSchedulerStatus | null;
  recentRuns: Array<{ id: number; startedAt: Date; finishedAt: Date | null; syncType: string; status: string; fetchedCount: number; failedCount: number; errorMessage: string | null }>;
}

export type FourvenuesOverallStatus = "all_healthy" | "degraded" | "error" | "none_configured";

export interface FourvenuesHealthSnapshot {
  integrations: VenueIntegrationHealth[];
  overallStatus: FourvenuesOverallStatus;
}

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

export async function getFourvenuesHealth(communityId: number | null, db: AnyDbHandle): Promise<FourvenuesHealthSnapshot> {
  const allIntegrations = await listVenueIntegrations(undefined, db as never);

  let integrations = allIntegrations;
  if (communityId != null) {
    const venueRows = rowsOf<{ venue_id: number }>(await db.execute(sql`SELECT venue_id FROM community_venues WHERE community_id = ${communityId}`));
    const allowedVenueIds = new Set(venueRows.map(r => Number(r.venue_id)));
    integrations = allIntegrations.filter(i => i.venueId != null && allowedVenueIds.has(i.venueId));
  }

  const venueIds = integrations.map(i => i.venueId).filter((v): v is number => v != null);
  const venueNames = new Map<number, string>();
  if (venueIds.length > 0) {
    const venueRows = rowsOf<{ id: number; name: string }>(await db.execute(sql`SELECT id, name FROM venues WHERE id IN (${sql.join(venueIds, sql`, `)})`));
    for (const v of venueRows) venueNames.set(Number(v.id), v.name);
  }

  const schedulerRunning = isFourvenuesSchedulerRunning();
  const rows: VenueIntegrationHealth[] = await Promise.all(integrations.map(async (integration) => {
    const [scheduler, runs] = await Promise.all([
      getIntegrationSchedulerStatus(integration.id, schedulerRunning, DEFAULT_INCREMENTAL_INTERVAL_MINUTES),
      listSyncRuns("venue_integration", integration.id, db as never),
    ]);
    return {
      integrationId: integration.id,
      venueId: integration.venueId ?? null,
      venueName: integration.venueId != null ? (venueNames.get(integration.venueId) ?? null) : null,
      providerKey: integration.providerKey,
      environment: integration.environment,
      enabled: integration.enabled,
      status: integration.status,
      syncEnabled: integration.syncEnabled,
      loyaltyEnabled: integration.loyaltyEnabled,
      credentialsConfigured: integration.credentialsConfigured,
      scheduler,
      recentRuns: runs.slice(0, 5).map(r => ({
        id: r.id, startedAt: r.startedAt, finishedAt: r.finishedAt, syncType: r.syncType, status: r.status,
        fetchedCount: r.fetchedCount, failedCount: r.failedCount, errorMessage: r.errorMessage,
      })),
    };
  }));

  // "error" se basa SIEMPRE en el estado real-time de la integración
  // (`status === "error"`), nunca en si alguna vez hubo un error histórico
  // (`lastErrorAt` casi siempre tiene algún valor, incluso en integraciones
  // sanas hoy — usarlo como disparador de "error" generaría falsos positivos
  // permanentes).
  const overallStatus: FourvenuesOverallStatus = rows.length === 0
    ? "none_configured"
    : rows.some(r => r.status === "error")
      ? "error"
      : rows.some(r => !r.enabled || !r.syncEnabled || r.status !== "connected")
        ? "degraded"
        : "all_healthy";

  return { integrations: rows, overallStatus };
}
