/**
 * integrationScheduler.test.ts — Fourvenues Production Scheduler
 * (2026-08-13). Se prueba `tick()` (la selección de qué integraciones
 * sincronizar y con qué modo), NO la semántica de node-cron ni de
 * syncVenueIntegration (ya cubiertos por syncVenueIntegration.test.ts) —
 * mismo criterio de aislamiento que el resto del proyecto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockListProviders, mockListVenueIntegrations, mockGetVenueIntegrationRaw,
  mockIsDueForScheduledSync, mockGetLastSuccessfulModeRunAt,
  mockCanSync, mockSyncVenueIntegration, mockIsExternalIntegrationsGloballyEnabled,
} = vi.hoisted(() => ({
  mockListProviders: vi.fn(),
  mockListVenueIntegrations: vi.fn(),
  mockGetVenueIntegrationRaw: vi.fn(),
  mockIsDueForScheduledSync: vi.fn(),
  mockGetLastSuccessfulModeRunAt: vi.fn(),
  mockCanSync: vi.fn(),
  mockSyncVenueIntegration: vi.fn(),
  mockIsExternalIntegrationsGloballyEnabled: vi.fn(),
}));

vi.mock("./integrationsDb", () => ({
  listProviders: mockListProviders,
  listVenueIntegrations: mockListVenueIntegrations,
  getVenueIntegrationRaw: mockGetVenueIntegrationRaw,
  isDueForScheduledSync: mockIsDueForScheduledSync,
  getLastSuccessfulModeRunAt: mockGetLastSuccessfulModeRunAt,
}));

vi.mock("./integrationSyncService", () => ({
  isExternalIntegrationsGloballyEnabled: mockIsExternalIntegrationsGloballyEnabled,
  canSync: mockCanSync,
  syncVenueIntegration: mockSyncVenueIntegration,
}));

import { tick } from "./integrationScheduler";

function fourvenuesProvider() { return { id: 5, key: "fourvenues_integrations", name: "Fourvenues" }; }
function weezeventProvider() { return { id: 6, key: "weezevent", name: "Weezevent" }; }

function safeIntegration(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, venueId: 10, providerId: 5, environment: "production" as const, enabled: true, syncEnabled: true, ...overrides };
}
function rawIntegration(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, venueId: 10, providerId: 5, enabled: true, syncEnabled: true, credentialsEncrypted: "blob", loyaltyEnabled: false, syncIntervalMinutes: 10, lastSuccessAt: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsExternalIntegrationsGloballyEnabled.mockReturnValue(true);
  mockGetLastSuccessfulModeRunAt.mockResolvedValue(null); // reconciliation "nunca corrida" por defecto → due
  mockSyncVenueIntegration.mockResolvedValue({ status: "success" });
});

describe("tick — kill switch global (spec §55)", () => {
  it("EXTERNAL_INTEGRATIONS_ENABLED=false → 0 llamadas, ni siquiera listProviders", async () => {
    mockIsExternalIntegrationsGloballyEnabled.mockReturnValue(false);
    await tick();
    expect(mockListProviders).not.toHaveBeenCalled();
    expect(mockSyncVenueIntegration).not.toHaveBeenCalled();
  });
});

describe("tick — provider Fourvenues no encontrado (BD nueva, spec §57)", () => {
  it("sin fila de provider 'fourvenues_integrations' en la BD → 0 llamadas a listVenueIntegrations ni al sync", async () => {
    mockListProviders.mockResolvedValue([weezeventProvider()]);
    await tick();
    expect(mockListVenueIntegrations).not.toHaveBeenCalled();
    expect(mockSyncVenueIntegration).not.toHaveBeenCalled();
  });
});

describe("tick — Fourvenues only (spec §93)", () => {
  it("ignora silenciosamente cualquier integración cuyo provider NO sea fourvenues_integrations (nunca arranca Weezevent por accidente)", async () => {
    mockListProviders.mockResolvedValue([fourvenuesProvider(), weezeventProvider()]);
    mockListVenueIntegrations.mockResolvedValue([safeIntegration({ id: 2, providerId: 6 })]); // fila Weezevent
    await tick();
    expect(mockGetVenueIntegrationRaw).not.toHaveBeenCalled();
    expect(mockSyncVenueIntegration).not.toHaveBeenCalled();
  });
});

describe("tick — integración deshabilitada (Tía Felisa/Limoncello, spec §11/§54)", () => {
  it("canSync()=false (enabled=0 o syncEnabled=0) → nunca se llama a syncVenueIntegration para esa fila", async () => {
    mockListProviders.mockResolvedValue([fourvenuesProvider()]);
    mockListVenueIntegrations.mockResolvedValue([safeIntegration()]);
    mockGetVenueIntegrationRaw.mockResolvedValue(rawIntegration({ enabled: false }));
    mockCanSync.mockReturnValue(false);

    await tick();

    expect(mockSyncVenueIntegration).not.toHaveBeenCalled();
  });
});

describe("tick — BD nueva sin integraciones (spec §57)", () => {
  it("listVenueIntegrations devuelve [] → tick termina sin error, 0 llamadas al sync", async () => {
    mockListProviders.mockResolvedValue([fourvenuesProvider()]);
    mockListVenueIntegrations.mockResolvedValue([]);
    await expect(tick()).resolves.toBeUndefined();
    expect(mockSyncVenueIntegration).not.toHaveBeenCalled();
  });
});

describe("tick — due calculation (spec §53/§65)", () => {
  it("incremental debida → syncVenueIntegration llamado con trigger='scheduler', mode='incremental'", async () => {
    mockListProviders.mockResolvedValue([fourvenuesProvider()]);
    mockListVenueIntegrations.mockResolvedValue([safeIntegration()]);
    mockGetVenueIntegrationRaw.mockResolvedValue(rawIntegration());
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(true);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(new Date()); // reconciliation NO debida (recién corrida)

    await tick();

    expect(mockSyncVenueIntegration).toHaveBeenCalledTimes(1);
    expect(mockSyncVenueIntegration).toHaveBeenCalledWith(1, expect.objectContaining({
      trigger: "scheduler", mode: "incremental",
      historyFromDays: 2, futureUntilDays: 14, // ventana estrecha (spec §67) — nunca los 400 días históricos
    }));
  });

  it("incremental NO debida y reconciliation tampoco (corrida hace 1 minuto) → 0 llamadas al sync", async () => {
    mockListProviders.mockResolvedValue([fourvenuesProvider()]);
    mockListVenueIntegrations.mockResolvedValue([safeIntegration()]);
    mockGetVenueIntegrationRaw.mockResolvedValue(rawIntegration());
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(false);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(new Date(Date.now() - 60_000));

    await tick();

    expect(mockSyncVenueIntegration).not.toHaveBeenCalled();
  });

  it("reconciliation debida (nunca corrida) aunque incremental no lo esté → syncVenueIntegration llamado con mode='reconciliation'", async () => {
    mockListProviders.mockResolvedValue([fourvenuesProvider()]);
    mockListVenueIntegrations.mockResolvedValue([safeIntegration()]);
    mockGetVenueIntegrationRaw.mockResolvedValue(rawIntegration());
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(false);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(null);

    await tick();

    expect(mockSyncVenueIntegration).toHaveBeenCalledTimes(1);
    expect(mockSyncVenueIntegration).toHaveBeenCalledWith(1, expect.objectContaining({ trigger: "scheduler", mode: "reconciliation" }));
  });

  it("incremental Y reconciliation debidas a la vez → ambas se ejecutan, nunca en paralelo (secuencial, mismo tick)", async () => {
    mockListProviders.mockResolvedValue([fourvenuesProvider()]);
    mockListVenueIntegrations.mockResolvedValue([safeIntegration()]);
    mockGetVenueIntegrationRaw.mockResolvedValue(rawIntegration());
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(true);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(null);

    await tick();

    expect(mockSyncVenueIntegration).toHaveBeenCalledTimes(2);
    expect(mockSyncVenueIntegration.mock.calls[0][1]).toMatchObject({ mode: "incremental" });
    expect(mockSyncVenueIntegration.mock.calls[1][1]).toMatchObject({ mode: "reconciliation" });
  });
});

describe("tick — multi-venue (Tía Felisa rollout, spec §51/§52/§62)", () => {
  function tiaFelisaSafe(overrides: Partial<Record<string, unknown>> = {}) {
    return safeIntegration({ id: 3, venueId: 7, ...overrides });
  }
  function tiaFelisaRaw(overrides: Partial<Record<string, unknown>> = {}) {
    return rawIntegration({ id: 3, venueId: 7, ...overrides });
  }

  it("Casanova Y Tía Felisa debidas a la vez → AMBAS se sincronizan de forma independiente, cada una con su propio id/venueId", async () => {
    mockListProviders.mockResolvedValue([fourvenuesProvider()]);
    mockListVenueIntegrations.mockResolvedValue([safeIntegration(), tiaFelisaSafe()]);
    mockGetVenueIntegrationRaw.mockImplementation(async (id: number) => (id === 3 ? tiaFelisaRaw() : rawIntegration()));
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(true);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(new Date()); // reconciliation ya corrida para ambas — solo incremental en este tick

    await tick();

    const calledIds = mockSyncVenueIntegration.mock.calls.map(c => c[0]);
    expect(calledIds).toContain(1); // Casanova
    expect(calledIds).toContain(3); // Tía Felisa
    expect(mockSyncVenueIntegration).toHaveBeenCalledTimes(2);
  });

  it("Tía Felisa deshabilitada (enabled=false) mientras Casanova SÍ está habilitada → solo Casanova se sincroniza, la deshabilitada no bloquea ni afecta a las demás (spec §54/§11)", async () => {
    mockListProviders.mockResolvedValue([fourvenuesProvider()]);
    mockListVenueIntegrations.mockResolvedValue([safeIntegration(), tiaFelisaSafe({ enabled: false })]);
    mockGetVenueIntegrationRaw.mockImplementation(async (id: number) => (id === 3 ? tiaFelisaRaw({ enabled: false }) : rawIntegration()));
    mockCanSync.mockImplementation((integration: { id?: number }) => integration.id !== 3); // canSync real evaluaría enabled=false → false; aquí se simula el resultado
    mockIsDueForScheduledSync.mockReturnValue(true);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(new Date()); // reconciliation ya corrida — solo 1 llamada (incremental) por integración habilitada

    await tick();

    const calledIds = mockSyncVenueIntegration.mock.calls.map(c => c[0]);
    expect(calledIds).toEqual([1]); // solo Casanova
  });

  it("Limoncello (enabled=false, sync_enabled=false) nunca se sincroniza aunque conviva en la misma lista que Casanova y Tía Felisa activas", async () => {
    function limoncelloSafe() { return safeIntegration({ id: 2, venueId: 4 }); }
    function limoncelloRaw() { return rawIntegration({ id: 2, venueId: 4, enabled: false, syncEnabled: false }); }

    mockListProviders.mockResolvedValue([fourvenuesProvider()]);
    mockListVenueIntegrations.mockResolvedValue([safeIntegration(), tiaFelisaSafe(), limoncelloSafe()]);
    mockGetVenueIntegrationRaw.mockImplementation(async (id: number) => {
      if (id === 2) return limoncelloRaw();
      if (id === 3) return tiaFelisaRaw();
      return rawIntegration();
    });
    mockCanSync.mockImplementation((integration: { id?: number }) => integration.id !== 2);
    mockIsDueForScheduledSync.mockReturnValue(true);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(new Date());

    await tick();

    const calledIds = mockSyncVenueIntegration.mock.calls.map(c => c[0]);
    expect(calledIds).not.toContain(2); // Limoncello nunca
    expect(calledIds).toContain(1);
    expect(calledIds).toContain(3);
  });

  it("cada integración pasa su PROPIO id/venueId a syncVenueIntegration — nunca se cruzan ventanas/ids entre integraciones", async () => {
    mockListProviders.mockResolvedValue([fourvenuesProvider()]);
    mockListVenueIntegrations.mockResolvedValue([safeIntegration(), tiaFelisaSafe()]);
    mockGetVenueIntegrationRaw.mockImplementation(async (id: number) => (id === 3 ? tiaFelisaRaw({ syncIntervalMinutes: 2 }) : rawIntegration({ syncIntervalMinutes: 10 })));
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockImplementation((integration: { id?: number }) => integration.id === 3); // solo Tía Felisa debida esta vez
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(new Date());

    await tick();

    expect(mockSyncVenueIntegration).toHaveBeenCalledTimes(1);
    expect(mockSyncVenueIntegration).toHaveBeenCalledWith(3, expect.objectContaining({ mode: "incremental" }));
  });

  it("Limoncello rollout (spec §34) — Casanova + Tía Felisa + Limoncello, las TRES habilitadas y debidas a la vez → las tres se sincronizan de forma independiente", async () => {
    function limoncelloSafe(overrides: Partial<Record<string, unknown>> = {}) {
      return safeIntegration({ id: 2, venueId: 4, ...overrides });
    }
    function limoncelloRaw(overrides: Partial<Record<string, unknown>> = {}) {
      return rawIntegration({ id: 2, venueId: 4, ...overrides });
    }

    mockListProviders.mockResolvedValue([fourvenuesProvider()]);
    mockListVenueIntegrations.mockResolvedValue([safeIntegration(), limoncelloSafe(), tiaFelisaSafe()]);
    mockGetVenueIntegrationRaw.mockImplementation(async (id: number) => {
      if (id === 2) return limoncelloRaw();
      if (id === 3) return tiaFelisaRaw();
      return rawIntegration();
    });
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(true);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(new Date()); // reconciliation ya corrida para las 3 — solo incremental en este tick

    await tick();

    const calledIds = mockSyncVenueIntegration.mock.calls.map(c => c[0]);
    expect(calledIds).toContain(1); // Casanova
    expect(calledIds).toContain(2); // Limoncello
    expect(calledIds).toContain(3); // Tía Felisa
    expect(mockSyncVenueIntegration).toHaveBeenCalledTimes(3);
  });
});
