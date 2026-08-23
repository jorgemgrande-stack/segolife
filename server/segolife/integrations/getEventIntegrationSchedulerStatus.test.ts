/**
 * getEventIntegrationSchedulerStatus.test.ts — Weezevent Live Operations
 * (2026-08-23, spec §13-15). Se prueba la derivación de salud
 * (HEALTHY/DEGRADED/ERROR/DISABLED) y la clasificación de errores — puro,
 * sin I/O real (mismo criterio que integrationScheduler.test.ts/
 * isDueForScheduledSync).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetEventIntegrationRaw, mockGetWeezeventConnectionRaw, mockGetCurrentLockStatus, mockIsDueForScheduledSync } = vi.hoisted(() => ({
  mockGetEventIntegrationRaw: vi.fn(),
  mockGetWeezeventConnectionRaw: vi.fn(),
  mockGetCurrentLockStatus: vi.fn(),
  mockIsDueForScheduledSync: vi.fn(),
}));

vi.mock("./integrationsDb", () => ({
  getEventIntegrationRaw: mockGetEventIntegrationRaw,
  getWeezeventConnectionRaw: mockGetWeezeventConnectionRaw,
  getCurrentLockStatus: mockGetCurrentLockStatus,
  isDueForScheduledSync: mockIsDueForScheduledSync,
  // Requeridos por el módulo (sección venue) — nunca ejercitados aquí.
  getVenueIntegrationRaw: vi.fn(), startSyncRun: vi.fn(), finishSyncRun: vi.fn(),
  recordVenueIntegrationResult: vi.fn(), recordEventIntegrationResult: vi.fn(),
  setSyncCursor: vi.fn(), getSyncState: vi.fn(), findInternalIdForExternal: vi.fn(),
  tryAcquireSyncLock: vi.fn(), getProviderById: vi.fn(),
}));
vi.mock("./integrationCredentialCrypto", () => ({ decryptCredentials: vi.fn() }));
vi.mock("./weezeventAdapter", () => ({ createWeezeventAdapter: vi.fn(), getWeezeventAccessToken: vi.fn(), WEEZEVENT_BASE_URL: "https://api.weezevent.com" }));
vi.mock("./fourvenuesIntegrationsAdapter", () => ({ createFourvenuesIntegrationsAdapter: vi.fn(), FOURVENUES_INTEGRATIONS_BASE_URL: { sandbox: "", production: "" } }));
vi.mock("./httpTransport", () => ({ createHttpTransport: () => ({ request: vi.fn() }) }));
vi.mock("./identityResolver", () => ({ resolveIdentity: vi.fn() }));
vi.mock("./eventCatalogSync", () => ({ syncEventCatalog: vi.fn(), syncTicketTypes: vi.fn() }));
vi.mock("../ticketing/ticketPurchasePipeline", () => ({ ingestTicketPurchase: vi.fn(), ingestPaymentlessTicket: vi.fn() }));
vi.mock("../ticketing/attendancePipeline", () => ({ ingestAttendance: vi.fn() }));
vi.mock("./fourvenuesPublicationNotifier", () => ({ notifyPublicationTransition: vi.fn() }));

import { getEventIntegrationSchedulerStatus, classifyIntegrationErrorMessage } from "./integrationSyncService";

function rawIntegration(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, eventId: 233, connectionId: 5, enabled: true, syncEnabled: true, loyaltyEnabled: false,
    syncIntervalMinutes: null, lastSyncAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EXTERNAL_INTEGRATIONS_ENABLED = "true";
  mockGetWeezeventConnectionRaw.mockResolvedValue({ id: 5, credentialsEncrypted: "blob" });
  mockGetCurrentLockStatus.mockResolvedValue({ locked: false, run: null });
});

describe("classifyIntegrationErrorMessage — 9 categorías reales (spec §14)", () => {
  it.each([
    ["Credenciales incorrectas o Access Token inválido/caducado", "AUTH"],
    ["Sin permisos suficientes para esta API key", "AUTH"],
    ["No se pudieron descifrar las credenciales de la conexión", "AUTH"],
    ["Límite de peticiones de Weezevent alcanzado (fair use) — inténtalo más tarde", "RATE_LIMIT"],
    ["Weezevent no está disponible ahora mismo (error del servidor)", "REMOTE_API"],
    ["Falta el ID de evento externo (externalEventId) en la configuración", "MAPPING"],
    ["fetch failed", "NETWORK"],
    ["Timeout tras 30s", "NETWORK"],
    [null, "UNKNOWN"],
    ["algo genérico sin patrón reconocible", "SYNC"],
  ])("%s → %s", (message, expected) => {
    expect(classifyIntegrationErrorMessage(message)).toBe(expected);
  });
});

describe("getEventIntegrationSchedulerStatus — salud derivada (spec §15)", () => {
  it("integración no encontrada → null", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(null);
    const result = await getEventIntegrationSchedulerStatus(1, true, 60);
    expect(result).toBeNull();
  });

  it("kill switch/credenciales/enabled/syncEnabled no cumplidos → health='disabled'", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(rawIntegration({ enabled: false }));
    const result = await getEventIntegrationSchedulerStatus(1, true, 60);
    expect(result?.health).toBe("disabled");
    expect(result?.due).toBeNull();
  });

  it("último intento fue un error posterior al último éxito → health='error'", async () => {
    const lastSuccessAt = new Date(Date.now() - 3600_000);
    const lastErrorAt = new Date(Date.now() - 60_000); // error MÁS reciente que el último éxito
    mockGetEventIntegrationRaw.mockResolvedValue(rawIntegration({ lastSuccessAt, lastErrorAt, lastErrorMessage: "401 Unauthorized" }));
    mockIsDueForScheduledSync.mockReturnValue(true);

    const result = await getEventIntegrationSchedulerStatus(1, true, 60);

    expect(result?.health).toBe("error");
    expect(result?.lastErrorCategory).toBe("AUTH");
  });

  it("un error VIEJO (antes del último éxito) nunca degrada la salud actual — health='healthy'", async () => {
    const lastErrorAt = new Date(Date.now() - 3600_000);
    const lastSuccessAt = new Date(Date.now() - 60_000); // éxito MÁS reciente que el error
    mockGetEventIntegrationRaw.mockResolvedValue(rawIntegration({ lastSuccessAt, lastErrorAt, lastErrorMessage: "fallo transitorio ya recuperado" }));
    mockIsDueForScheduledSync.mockReturnValue(false);

    const result = await getEventIntegrationSchedulerStatus(1, true, 60);

    expect(result?.health).toBe("healthy");
  });

  it("nunca sincronizada, dentro de la ventana automática (effectiveIntervalMinutes != null) → health='degraded' (spec §15 ejemplo real: 'conectado pero horas sin sincronizar durante evento activo')", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(rawIntegration({ lastSuccessAt: null }));
    mockIsDueForScheduledSync.mockReturnValue(true);

    const result = await getEventIntegrationSchedulerStatus(1, true, 2); // ventana activa, intervalo 2min

    expect(result?.health).toBe("degraded");
  });

  it("último éxito hace más de 3x el intervalo efectivo → health='degraded'", async () => {
    const lastSuccessAt = new Date(Date.now() - 61 * 60_000); // 61min, intervalo=15 → umbral=45min
    mockGetEventIntegrationRaw.mockResolvedValue(rawIntegration({ lastSuccessAt }));
    mockIsDueForScheduledSync.mockReturnValue(true);

    const result = await getEventIntegrationSchedulerStatus(1, true, 15);

    expect(result?.health).toBe("degraded");
  });

  it("último éxito reciente, dentro del umbral → health='healthy'", async () => {
    const lastSuccessAt = new Date(Date.now() - 5 * 60_000);
    mockGetEventIntegrationRaw.mockResolvedValue(rawIntegration({ lastSuccessAt }));
    mockIsDueForScheduledSync.mockReturnValue(false);

    const result = await getEventIntegrationSchedulerStatus(1, true, 15);

    expect(result?.health).toBe("healthy");
  });

  it("effectiveIntervalMinutes=null (evento reconciliado/cerrado) → nunca degraded solo por antigüedad, due=null", async () => {
    const lastSuccessAt = new Date(Date.now() - 100 * 3600_000); // muy viejo
    mockGetEventIntegrationRaw.mockResolvedValue(rawIntegration({ lastSuccessAt }));

    const result = await getEventIntegrationSchedulerStatus(1, true, null);

    expect(result?.health).toBe("healthy");
    expect(result?.due).toBeNull();
    expect(result?.effectiveIntervalMinutes).toBeNull();
  });

  it("override manual (syncIntervalMinutes en la fila) gana sobre el adaptativo pasado por el caller", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(rawIntegration({ syncIntervalMinutes: 7 }));
    mockIsDueForScheduledSync.mockReturnValue(true);

    const result = await getEventIntegrationSchedulerStatus(1, true, 60); // adaptativo diría 60, pero la fila fija 7

    expect(result?.effectiveIntervalMinutes).toBe(7);
    expect(mockIsDueForScheduledSync).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), expect.any(Date), 7);
  });
});
