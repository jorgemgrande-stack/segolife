/**
 * commandCenterFourvenues.test.ts — Fourvenues Health: reutiliza el motor de
 * integraciones existente (spec §13) — nunca dispara sync, nunca hace poll
 * agresivo, solo lee estado ya materializado.
 */
import { describe, it, expect, vi } from "vitest";

const mockListVenueIntegrations = vi.fn();
const mockListSyncRuns = vi.fn();
const mockGetIntegrationSchedulerStatus = vi.fn();
const mockIsFourvenuesSchedulerRunning = vi.fn();

vi.mock("../integrations/integrationsDb", () => ({
  listVenueIntegrations: (...args: unknown[]) => mockListVenueIntegrations(...args),
  listSyncRuns: (...args: unknown[]) => mockListSyncRuns(...args),
}));
vi.mock("../integrations/integrationSyncService", () => ({
  getIntegrationSchedulerStatus: (...args: unknown[]) => mockGetIntegrationSchedulerStatus(...args),
}));
vi.mock("../integrations/integrationScheduler", () => ({
  isFourvenuesSchedulerRunning: () => mockIsFourvenuesSchedulerRunning(),
  DEFAULT_INCREMENTAL_INTERVAL_MINUTES: 10,
}));

import { getFourvenuesHealth } from "./commandCenterFourvenues";

function fakeExecuteDb(queue: unknown[][]) {
  const execute = vi.fn();
  for (const rows of queue) execute.mockResolvedValueOnce([rows, []]);
  return { execute };
}

function integration(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, venueId: 10, providerId: 1, providerKey: "fourvenues", environment: "production",
    enabled: true, status: "connected", capabilities: null, credentialsConfigured: true, credentialsLast4: "1234",
    syncEnabled: true, loyaltyEnabled: false, syncIntervalMinutes: 10,
    lastSyncAt: new Date(), lastSuccessAt: new Date(), lastErrorAt: null, lastErrorMessage: null,
    ...overrides,
  };
}

describe("getFourvenuesHealth", () => {
  it("reutiliza listVenueIntegrations/getIntegrationSchedulerStatus/listSyncRuns — nunca dispara sync", async () => {
    mockListVenueIntegrations.mockResolvedValueOnce([integration()]);
    mockIsFourvenuesSchedulerRunning.mockReturnValueOnce(true);
    mockGetIntegrationSchedulerStatus.mockResolvedValueOnce({ schedulerProcessRunning: true, due: false, locked: false, currentRun: null, lastSuccessAt: new Date(), lastErrorAt: null, lastErrorMessage: null, syncIntervalMinutes: 10, nextDueAt: null, loyaltyEnabled: false });
    mockListSyncRuns.mockResolvedValueOnce([{ id: 1, integrationType: "venue_integration", integrationId: 1, syncType: "incremental", status: "success", fetchedCount: 30, createdCount: 2, updatedCount: 28, unresolvedCount: 0, failedCount: 0, errorMessage: null, startedAt: new Date(), finishedAt: new Date() }]);

    const db = fakeExecuteDb([[{ id: 10, name: "Casanova" }]]);
    const snapshot = await getFourvenuesHealth(null, db as never);

    expect(snapshot.integrations).toHaveLength(1);
    expect(snapshot.integrations[0].venueName).toBe("Casanova");
    expect(snapshot.overallStatus).toBe("all_healthy");
    // Nunca se invoca ninguna función de sincronización real — solo lectura.
    expect(mockGetIntegrationSchedulerStatus).toHaveBeenCalledTimes(1);
  });

  it("sin ninguna integración configurada → overallStatus 'none_configured', nunca falla", async () => {
    mockListVenueIntegrations.mockResolvedValueOnce([]);
    const db = fakeExecuteDb([]);
    const snapshot = await getFourvenuesHealth(null, db as never);
    expect(snapshot.integrations).toEqual([]);
    expect(snapshot.overallStatus).toBe("none_configured");
  });

  it("una integración con status='error' real-time -> overallStatus 'error'", async () => {
    mockListVenueIntegrations.mockResolvedValueOnce([integration({ status: "error" })]);
    mockIsFourvenuesSchedulerRunning.mockReturnValueOnce(false);
    mockGetIntegrationSchedulerStatus.mockResolvedValueOnce(null);
    mockListSyncRuns.mockResolvedValueOnce([]);
    const db = fakeExecuteDb([[{ id: 10, name: "Casanova" }]]);
    const snapshot = await getFourvenuesHealth(null, db as never);
    expect(snapshot.overallStatus).toBe("error");
  });

  it("un lastErrorAt histórico en una integración SANA hoy NO cuenta como error global (evita falso positivo permanente)", async () => {
    mockListVenueIntegrations.mockResolvedValueOnce([integration({ status: "connected" })]);
    mockIsFourvenuesSchedulerRunning.mockReturnValueOnce(true);
    mockGetIntegrationSchedulerStatus.mockResolvedValueOnce({ schedulerProcessRunning: true, due: false, locked: false, currentRun: null, lastSuccessAt: new Date(), lastErrorAt: new Date("2026-01-01"), lastErrorMessage: "fallo antiguo ya resuelto", syncIntervalMinutes: 10, nextDueAt: null, loyaltyEnabled: false });
    mockListSyncRuns.mockResolvedValueOnce([]);
    const db = fakeExecuteDb([[{ id: 10, name: "Casanova" }]]);
    const snapshot = await getFourvenuesHealth(null, db as never);
    expect(snapshot.overallStatus).toBe("all_healthy");
  });

  it("integración deshabilitada (enabled=false) -> overallStatus 'degraded', no 'error'", async () => {
    mockListVenueIntegrations.mockResolvedValueOnce([integration({ enabled: false })]);
    mockIsFourvenuesSchedulerRunning.mockReturnValueOnce(false);
    mockGetIntegrationSchedulerStatus.mockResolvedValueOnce(null);
    mockListSyncRuns.mockResolvedValueOnce([]);
    const db = fakeExecuteDb([[{ id: 10, name: "Casanova" }]]);
    const snapshot = await getFourvenuesHealth(null, db as never);
    expect(snapshot.overallStatus).toBe("degraded");
  });

  it("filtra por comunidad vía community_venues real — nunca infiere del venue directamente", async () => {
    mockListVenueIntegrations.mockResolvedValueOnce([integration({ id: 1, venueId: 10 }), integration({ id: 2, venueId: 20 })]);
    mockIsFourvenuesSchedulerRunning.mockReturnValueOnce(true);
    mockGetIntegrationSchedulerStatus.mockResolvedValueOnce({ schedulerProcessRunning: true, due: false, locked: false, currentRun: null, lastSuccessAt: new Date(), lastErrorAt: null, lastErrorMessage: null, syncIntervalMinutes: 10, nextDueAt: null, loyaltyEnabled: false });
    mockListSyncRuns.mockResolvedValueOnce([]);
    // db.execute call 1: community_venues (solo venue 10 pertenece a la comunidad 3); call 2: venues (nombres)
    const db = fakeExecuteDb([[{ venue_id: 10 }], [{ id: 10, name: "Casanova" }]]);
    const snapshot = await getFourvenuesHealth(3, db as never);
    expect(snapshot.integrations).toHaveLength(1);
    expect(snapshot.integrations[0].venueId).toBe(10);
  });
});
