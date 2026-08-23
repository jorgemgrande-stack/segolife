/**
 * weezeventScheduler.test.ts — Weezevent Live Operations (2026-08-23). Se
 * prueba `tick()` (selección de qué mappings sincronizar y con qué modo) y
 * `resolveWeezeventSyncIntervalMinutes()` (cadencia adaptativa, pura) — NO la
 * semántica de node-cron ni de syncEventIntegration (ya cubiertos por
 * syncEventIntegration.test.ts) — mismo criterio de aislamiento que
 * integrationScheduler.test.ts (Fourvenues).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockListProviders, mockListEventIntegrations, mockGetEventIntegrationRaw,
  mockGetWeezeventConnectionRaw, mockGetEventDatesForScheduler,
  mockIsDueForScheduledSync, mockGetLastSuccessfulModeRunAt,
  mockCanSync, mockSyncEventIntegration, mockIsExternalIntegrationsGloballyEnabled,
} = vi.hoisted(() => ({
  mockListProviders: vi.fn(),
  mockListEventIntegrations: vi.fn(),
  mockGetEventIntegrationRaw: vi.fn(),
  mockGetWeezeventConnectionRaw: vi.fn(),
  mockGetEventDatesForScheduler: vi.fn(),
  mockIsDueForScheduledSync: vi.fn(),
  mockGetLastSuccessfulModeRunAt: vi.fn(),
  mockCanSync: vi.fn(),
  mockSyncEventIntegration: vi.fn(),
  mockIsExternalIntegrationsGloballyEnabled: vi.fn(),
}));

vi.mock("./integrationsDb", () => ({
  listProviders: mockListProviders,
  listEventIntegrations: mockListEventIntegrations,
  getEventIntegrationRaw: mockGetEventIntegrationRaw,
  getWeezeventConnectionRaw: mockGetWeezeventConnectionRaw,
  getEventDatesForScheduler: mockGetEventDatesForScheduler,
  isDueForScheduledSync: mockIsDueForScheduledSync,
  getLastSuccessfulModeRunAt: mockGetLastSuccessfulModeRunAt,
}));

vi.mock("./integrationSyncService", () => ({
  isExternalIntegrationsGloballyEnabled: mockIsExternalIntegrationsGloballyEnabled,
  canSync: mockCanSync,
  syncEventIntegration: mockSyncEventIntegration,
}));

import { tick, resolveWeezeventSyncIntervalMinutes, WEEZEVENT_FAR_INTERVAL_MINUTES, WEEZEVENT_NEAR_INTERVAL_MINUTES, WEEZEVENT_EVENT_WINDOW_INTERVAL_MINUTES, WEEZEVENT_POST_EVENT_INTERVAL_MINUTES, WEEZEVENT_RECONCILIATION_INTERVAL_MINUTES } from "./weezeventScheduler";

function weezeventProvider() { return { id: 6, key: "weezevent", name: "Weezevent" }; }
function fourvenuesProvider() { return { id: 5, key: "fourvenues_integrations", name: "Fourvenues" }; }

function safeEventIntegration(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, eventId: 233, providerId: 6, connectionId: 1, enabled: true, syncEnabled: true, ...overrides };
}
function rawEventIntegration(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, eventId: 233, providerId: 6, connectionId: 1, enabled: true, syncEnabled: true, loyaltyEnabled: false, syncIntervalMinutes: null, lastSuccessAt: null, ...overrides };
}

const FAR_EVENT = { startsAt: new Date(Date.now() + 30 * 86_400_000), endsAt: new Date(Date.now() + 30 * 86_400_000 + 3600_000) };

beforeEach(() => {
  vi.clearAllMocks();
  mockIsExternalIntegrationsGloballyEnabled.mockReturnValue(true);
  mockGetWeezeventConnectionRaw.mockResolvedValue({ id: 1, credentialsEncrypted: "blob" });
  mockGetEventDatesForScheduler.mockResolvedValue(FAR_EVENT);
  mockGetLastSuccessfulModeRunAt.mockResolvedValue(new Date()); // reconciliation recién corrida por defecto → no debida
  mockSyncEventIntegration.mockResolvedValue({ status: "success" });
});

describe("resolveWeezeventSyncIntervalMinutes — cadencia adaptativa (spec §4), pura", () => {
  const start = new Date("2026-09-19T22:00:00.000Z");
  const end = new Date("2026-09-20T04:00:00.000Z");

  it("evento lejano (>7 días antes) → intervalo FAR", () => {
    const now = new Date("2026-09-01T00:00:00.000Z"); // 18 días antes
    expect(resolveWeezeventSyncIntervalMinutes(now, start, end)).toBe(WEEZEVENT_FAR_INTERVAL_MINUTES);
  });

  it("evento próximo (dentro de 7 días, fuera de la ventana activa) → intervalo NEAR", () => {
    const now = new Date("2026-09-14T00:00:00.000Z"); // ~6 días antes
    expect(resolveWeezeventSyncIntervalMinutes(now, start, end)).toBe(WEEZEVENT_NEAR_INTERVAL_MINUTES);
  });

  it("ventana activa (2h antes del inicio) → intervalo EVENT_WINDOW", () => {
    const now = new Date("2026-09-19T20:30:00.000Z"); // 1.5h antes del inicio
    expect(resolveWeezeventSyncIntervalMinutes(now, start, end)).toBe(WEEZEVENT_EVENT_WINDOW_INTERVAL_MINUTES);
  });

  it("evento en curso (entre start y end) → intervalo EVENT_WINDOW", () => {
    const now = new Date("2026-09-20T01:00:00.000Z");
    expect(resolveWeezeventSyncIntervalMinutes(now, start, end)).toBe(WEEZEVENT_EVENT_WINDOW_INTERVAL_MINUTES);
  });

  it("justo tras el fin del evento → intervalo POST_EVENT (reconciliación fina)", () => {
    const now = new Date("2026-09-20T06:00:00.000Z"); // 2h tras el fin
    expect(resolveWeezeventSyncIntervalMinutes(now, start, end)).toBe(WEEZEVENT_POST_EVENT_INTERVAL_MINUTES);
  });

  it("más de 48h tras el fin → null (reconciliado/cerrado, el scheduler deja de tocarlo automáticamente)", () => {
    const now = new Date(end.getTime() + 49 * 3600_000);
    expect(resolveWeezeventSyncIntervalMinutes(now, start, end)).toBeNull();
  });

  it("sin endsAt (solo startsAt) → usa startsAt como fin efectivo para la ventana/parada", () => {
    const now = new Date(start.getTime() + 1 * 3600_000); // 1h tras el inicio, sin endsAt
    expect(resolveWeezeventSyncIntervalMinutes(now, start, null)).toBe(WEEZEVENT_EVENT_WINDOW_INTERVAL_MINUTES);
    const wayAfter = new Date(start.getTime() + 49 * 3600_000);
    expect(resolveWeezeventSyncIntervalMinutes(wayAfter, start, null)).toBeNull();
  });
});

describe("tick — kill switch global", () => {
  it("EXTERNAL_INTEGRATIONS_ENABLED=false → 0 llamadas, ni siquiera listProviders", async () => {
    mockIsExternalIntegrationsGloballyEnabled.mockReturnValue(false);
    await tick();
    expect(mockListProviders).not.toHaveBeenCalled();
    expect(mockSyncEventIntegration).not.toHaveBeenCalled();
  });
});

describe("tick — provider weezevent no encontrado (BD nueva)", () => {
  it("sin fila de provider 'weezevent' → 0 llamadas a listEventIntegrations ni al sync", async () => {
    mockListProviders.mockResolvedValue([fourvenuesProvider()]);
    await tick();
    expect(mockListEventIntegrations).not.toHaveBeenCalled();
    expect(mockSyncEventIntegration).not.toHaveBeenCalled();
  });
});

describe("tick — Weezevent only (nunca arranca Fourvenues por accidente)", () => {
  it("ignora silenciosamente cualquier mapping cuyo provider NO sea weezevent", async () => {
    mockListProviders.mockResolvedValue([fourvenuesProvider(), weezeventProvider()]);
    mockListEventIntegrations.mockResolvedValue([safeEventIntegration({ id: 2, providerId: 5 })]); // fila Fourvenues
    await tick();
    expect(mockGetEventIntegrationRaw).not.toHaveBeenCalled();
    expect(mockSyncEventIntegration).not.toHaveBeenCalled();
  });
});

describe("tick — mapping deshabilitado", () => {
  it("canSync()=false → nunca se llama a syncEventIntegration para esa fila", async () => {
    mockListProviders.mockResolvedValue([weezeventProvider()]);
    mockListEventIntegrations.mockResolvedValue([safeEventIntegration()]);
    mockGetEventIntegrationRaw.mockResolvedValue(rawEventIntegration({ enabled: false }));
    mockCanSync.mockReturnValue(false);

    await tick();

    expect(mockSyncEventIntegration).not.toHaveBeenCalled();
  });
});

describe("tick — BD nueva sin mappings", () => {
  it("listEventIntegrations devuelve [] → tick termina sin error, 0 llamadas al sync", async () => {
    mockListProviders.mockResolvedValue([weezeventProvider()]);
    mockListEventIntegrations.mockResolvedValue([]);
    await expect(tick()).resolves.toBeUndefined();
    expect(mockSyncEventIntegration).not.toHaveBeenCalled();
  });
});

describe("tick — evento reconciliado/cerrado (spec §4 'detener')", () => {
  it("evento >48h tras su fin → 0 llamadas al sync (ni incremental ni reconciliation), el mapping nunca se toca automáticamente", async () => {
    mockListProviders.mockResolvedValue([weezeventProvider()]);
    mockListEventIntegrations.mockResolvedValue([safeEventIntegration()]);
    mockGetEventIntegrationRaw.mockResolvedValue(rawEventIntegration());
    mockCanSync.mockReturnValue(true);
    const closedEvent = { startsAt: new Date(Date.now() - 100 * 86_400_000), endsAt: new Date(Date.now() - 99 * 86_400_000) };
    mockGetEventDatesForScheduler.mockResolvedValue(closedEvent);

    await tick();

    expect(mockSyncEventIntegration).not.toHaveBeenCalled();
  });
});

describe("tick — due calculation (incremental)", () => {
  it("incremental debida (evento lejano → intervalo FAR) → syncEventIntegration llamado con trigger='scheduler', mode='incremental'", async () => {
    mockListProviders.mockResolvedValue([weezeventProvider()]);
    mockListEventIntegrations.mockResolvedValue([safeEventIntegration()]);
    mockGetEventIntegrationRaw.mockResolvedValue(rawEventIntegration());
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(true);

    await tick();

    expect(mockSyncEventIntegration).toHaveBeenCalledWith(1, { trigger: "scheduler", mode: "incremental" });
    expect(mockIsDueForScheduledSync).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), expect.any(Date), WEEZEVENT_FAR_INTERVAL_MINUTES);
  });

  it("override manual (sync_interval_minutes fijado) SIEMPRE gana sobre la cadencia adaptativa", async () => {
    mockListProviders.mockResolvedValue([weezeventProvider()]);
    mockListEventIntegrations.mockResolvedValue([safeEventIntegration()]);
    mockGetEventIntegrationRaw.mockResolvedValue(rawEventIntegration({ syncIntervalMinutes: 3 }));
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(true);

    await tick();

    expect(mockIsDueForScheduledSync).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), expect.any(Date), 3);
  });

  it("incremental NO debida y reconciliation tampoco → 0 llamadas al sync", async () => {
    mockListProviders.mockResolvedValue([weezeventProvider()]);
    mockListEventIntegrations.mockResolvedValue([safeEventIntegration()]);
    mockGetEventIntegrationRaw.mockResolvedValue(rawEventIntegration());
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(false);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(new Date());

    await tick();

    expect(mockSyncEventIntegration).not.toHaveBeenCalled();
  });
});

describe("tick — due calculation (reconciliation, colchón de seguridad)", () => {
  it("reconciliation debida (nunca corrida) aunque incremental no lo esté → syncEventIntegration llamado con mode='reconciliation'", async () => {
    mockListProviders.mockResolvedValue([weezeventProvider()]);
    mockListEventIntegrations.mockResolvedValue([safeEventIntegration()]);
    mockGetEventIntegrationRaw.mockResolvedValue(rawEventIntegration());
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(false);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(null);

    await tick();

    expect(mockSyncEventIntegration).toHaveBeenCalledTimes(1);
    expect(mockSyncEventIntegration).toHaveBeenCalledWith(1, { trigger: "scheduler", mode: "reconciliation" });
  });

  it("reconciliation corrida hace menos de 6h → no debida", async () => {
    mockListProviders.mockResolvedValue([weezeventProvider()]);
    mockListEventIntegrations.mockResolvedValue([safeEventIntegration()]);
    mockGetEventIntegrationRaw.mockResolvedValue(rawEventIntegration());
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(false);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(new Date(Date.now() - (WEEZEVENT_RECONCILIATION_INTERVAL_MINUTES - 5) * 60_000));

    await tick();

    expect(mockSyncEventIntegration).not.toHaveBeenCalled();
  });

  it("incremental Y reconciliation debidas a la vez → ambas se ejecutan, secuencialmente (nunca en paralelo, mismo tick)", async () => {
    mockListProviders.mockResolvedValue([weezeventProvider()]);
    mockListEventIntegrations.mockResolvedValue([safeEventIntegration()]);
    mockGetEventIntegrationRaw.mockResolvedValue(rawEventIntegration());
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(true);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(null);

    await tick();

    expect(mockSyncEventIntegration).toHaveBeenCalledTimes(2);
    expect(mockSyncEventIntegration.mock.calls[0][1]).toMatchObject({ mode: "incremental" });
    expect(mockSyncEventIntegration.mock.calls[1][1]).toMatchObject({ mode: "reconciliation" });
  });
});

describe("tick — un run que falla (excepción de syncEventIntegration) nunca detiene el resto del tick", () => {
  it("mapping 1 lanza, mapping 2 se sincroniza igualmente", async () => {
    mockListProviders.mockResolvedValue([weezeventProvider()]);
    mockListEventIntegrations.mockResolvedValue([safeEventIntegration({ id: 1 }), safeEventIntegration({ id: 2, eventId: 234 })]);
    mockGetEventIntegrationRaw.mockImplementation(async (id: number) => rawEventIntegration({ id, eventId: id === 1 ? 233 : 234 }));
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockReturnValue(true);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(new Date());
    mockSyncEventIntegration.mockImplementation(async (id: number) => {
      if (id === 1) throw new Error("fallo de red simulado");
      return { status: "success" };
    });

    await expect(tick()).resolves.toBeUndefined();

    const calledIds = mockSyncEventIntegration.mock.calls.map(c => c[0]);
    expect(calledIds).toEqual([1, 2]);
  });
});

describe("tick — multi-mapping independiente", () => {
  it("cada mapping pasa su PROPIO id — nunca se cruzan entre mappings", async () => {
    mockListProviders.mockResolvedValue([weezeventProvider()]);
    mockListEventIntegrations.mockResolvedValue([safeEventIntegration({ id: 1 }), safeEventIntegration({ id: 2, eventId: 234 })]);
    mockGetEventIntegrationRaw.mockImplementation(async (id: number) => rawEventIntegration({ id, eventId: id === 1 ? 233 : 234 }));
    mockCanSync.mockReturnValue(true);
    mockIsDueForScheduledSync.mockImplementation((integration: { id?: number }) => integration.id === 2);
    mockGetLastSuccessfulModeRunAt.mockResolvedValue(new Date());

    await tick();

    expect(mockSyncEventIntegration).toHaveBeenCalledTimes(1);
    expect(mockSyncEventIntegration).toHaveBeenCalledWith(2, expect.objectContaining({ mode: "incremental" }));
  });
});
