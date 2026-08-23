/**
 * syncEventIntegration.test.ts — orquestación de syncEventIntegration/
 * dryRunEventIntegration (Weezevent, F71). Mismo patrón que
 * syncVenueIntegration.test.ts: se mockean los límites del módulo
 * (integrationsDb, cripto, el adapter, y los sub-pipelines ya testeados por
 * separado) — aquí se prueba SOLO la orquestación: kill switch, lock,
 * resolución del access_token de dos pasos, aislamiento de fallos, y que el
 * dry run nunca escribe.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const {
  mockGetEventIntegrationRaw, mockGetWeezeventConnectionRaw, mockGetProviderById, mockDecryptCredentials,
  mockFinishSyncRun, mockRecordEventIntegrationResult, mockSetSyncCursor, mockGetSyncState,
  mockTryAcquireSyncLock,
  mockCreateAdapter, mockGetWeezeventAccessToken,
  mockSyncTicketTypes, mockIngestPaymentlessTicket, mockIngestAttendance, mockResolveIdentity,
} = vi.hoisted(() => ({
  mockGetEventIntegrationRaw: vi.fn(),
  mockGetWeezeventConnectionRaw: vi.fn(),
  mockGetProviderById: vi.fn(),
  mockDecryptCredentials: vi.fn(),
  mockFinishSyncRun: vi.fn(),
  mockRecordEventIntegrationResult: vi.fn(),
  mockSetSyncCursor: vi.fn(),
  mockGetSyncState: vi.fn(),
  mockTryAcquireSyncLock: vi.fn(),
  mockCreateAdapter: vi.fn(),
  mockGetWeezeventAccessToken: vi.fn(),
  mockSyncTicketTypes: vi.fn(),
  mockIngestPaymentlessTicket: vi.fn(),
  mockIngestAttendance: vi.fn(),
  mockResolveIdentity: vi.fn(),
}));

vi.mock("./integrationsDb", () => ({
  getEventIntegrationRaw: mockGetEventIntegrationRaw,
  getWeezeventConnectionRaw: mockGetWeezeventConnectionRaw,
  getProviderById: mockGetProviderById,
  finishSyncRun: mockFinishSyncRun,
  recordEventIntegrationResult: mockRecordEventIntegrationResult,
  setSyncCursor: mockSetSyncCursor,
  getSyncState: mockGetSyncState,
  tryAcquireSyncLock: mockTryAcquireSyncLock,
  // No usados por el sync de eventos, pero importados por integrationSyncService.ts (sección venue) — deben existir para no romper el módulo.
  getVenueIntegrationRaw: vi.fn(), startSyncRun: vi.fn(), recordVenueIntegrationResult: vi.fn(),
  findInternalIdForExternal: vi.fn(), isDueForScheduledSync: vi.fn(), getCurrentLockStatus: vi.fn(),
}));
vi.mock("./integrationCredentialCrypto", () => ({ decryptCredentials: mockDecryptCredentials }));
vi.mock("./weezeventAdapter", () => ({
  createWeezeventAdapter: mockCreateAdapter,
  getWeezeventAccessToken: mockGetWeezeventAccessToken,
  WEEZEVENT_BASE_URL: "https://api.weezevent.com",
}));
vi.mock("./fourvenuesIntegrationsAdapter", () => ({
  createFourvenuesIntegrationsAdapter: vi.fn(),
  FOURVENUES_INTEGRATIONS_BASE_URL: { sandbox: "https://api-alpha.fourvenues.com/integrations", production: "https://api.fourvenues.com/integrations" },
}));
vi.mock("./httpTransport", () => ({ createHttpTransport: () => ({ request: vi.fn() }) }));
vi.mock("./identityResolver", () => ({ resolveIdentity: mockResolveIdentity }));
vi.mock("./eventCatalogSync", () => ({ syncEventCatalog: vi.fn(), syncTicketTypes: mockSyncTicketTypes }));
vi.mock("../ticketing/ticketPurchasePipeline", () => ({ ingestTicketPurchase: vi.fn(), ingestPaymentlessTicket: mockIngestPaymentlessTicket }));
vi.mock("../ticketing/attendancePipeline", () => ({ ingestAttendance: mockIngestAttendance }));
vi.mock("./fourvenuesPublicationNotifier", () => ({ notifyPublicationTransition: vi.fn().mockResolvedValue(undefined) }));

import { syncEventIntegration, dryRunEventIntegration } from "./integrationSyncService";

const ORIGINAL_ENV = process.env.EXTERNAL_INTEGRATIONS_ENABLED;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.EXTERNAL_INTEGRATIONS_ENABLED;
  else process.env.EXTERNAL_INTEGRATIONS_ENABLED = ORIGINAL_ENV;
});

function baseIntegration(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, eventId: 77, providerId: 9, connectionId: 5, environment: "production" as const,
    enabled: true, syncEnabled: true,
    externalEventId: "wz_evt_001", loyaltyEnabled: false,
    ...overrides,
  };
}

/** Refactor de conexión (2026-08-23) — las credenciales viven aquí, nunca en la propia fila de event_integrations. */
function baseConnection(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 5, credentialsEncrypted: "blob", ...overrides };
}

/** Mismo fake mínimo que syncVenueIntegration.test.ts — cubre la única query directa que hace este orquestador (eventTickets por externalTicketId). */
function fakeConn() {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: async () => [],
    then: (resolve: (v: unknown[]) => void) => resolve([]),
  };
  return { select: () => chain } as never;
}

function fakeAdapter(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    listTicketTypes: vi.fn().mockResolvedValue([{ externalId: "wz_rate_001", externalEventId: "wz_evt_001", name: "General", priceCents: 1000, currency: "EUR" }]),
    listTickets: vi.fn().mockResolvedValue([{ externalId: "wz_ptc_001", externalEventId: "wz_evt_001", externalTicketTypeId: "wz_rate_001", externalOrderId: null, participant: {}, status: "issued" }]),
    listAttendance: vi.fn().mockResolvedValue([{ externalAttendanceId: "wz_ptc_001:2026-08-01", externalEventId: "wz_evt_001", externalTicketId: "wz_ptc_001", participant: {}, occurredAt: new Date() }]),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EXTERNAL_INTEGRATIONS_ENABLED = "true";
  mockGetProviderById.mockResolvedValue({ key: "weezevent" });
  mockGetWeezeventConnectionRaw.mockResolvedValue(baseConnection());
  mockGetSyncState.mockResolvedValue(null); // sin cursor previo por defecto — primer sync, carga completa
  mockDecryptCredentials.mockReturnValue({ apiKey: "wz_fixture", accessToken: "already-exchanged" });
  mockTryAcquireSyncLock.mockResolvedValue({ acquired: true, run: { id: 900 } });
  mockSyncTicketTypes.mockResolvedValue({ createdCount: 1, updatedCount: 0, ticketTypeIdByExternalId: new Map([["wz_rate_001", 55]]) });
  mockIngestPaymentlessTicket.mockResolvedValue({ status: "created", ticket: { id: 501 }, identityResolved: false });
  mockIngestAttendance.mockResolvedValue({ status: "processed", attendance: { id: 1 } });
  mockResolveIdentity.mockResolvedValue({ userId: null, method: null });
});

describe("syncEventIntegration — kill switch", () => {
  it("integración no encontrada → failed, sin llamar al adapter", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(null);
    const result = await syncEventIntegration(999, {}, fakeConn());
    expect(result.status).toBe("failed");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("global kill switch OFF → skipped_disabled, sin llamar al adapter", async () => {
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "false";
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    const result = await syncEventIntegration(1, {}, fakeConn());
    expect(result.status).toBe("skipped_disabled");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("syncEnabled=false → skipped_disabled", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration({ syncEnabled: false }));
    const result = await syncEventIntegration(1, {}, fakeConn());
    expect(result.status).toBe("skipped_disabled");
  });

  it("sin externalEventId configurado → failed, nunca llama al adapter", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration({ externalEventId: null }));
    const result = await syncEventIntegration(1, {}, fakeConn());
    expect(result.status).toBe("failed");
    expect(result.message).toContain("externalEventId");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("provider distinto de weezevent → failed, no soportado", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    mockGetProviderById.mockResolvedValue({ key: "fourvenues_integrations" });
    const result = await syncEventIntegration(1, {}, fakeConn());
    expect(result.status).toBe("failed");
    expect(result.message).toContain("no soportado");
  });

  it("sin conexión Weezevent asociada (connectionId no resuelve) → skipped_disabled, nunca llama al adapter", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    mockGetWeezeventConnectionRaw.mockResolvedValue(null);
    const result = await syncEventIntegration(1, {}, fakeConn());
    expect(result.status).toBe("skipped_disabled");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("conexión existe pero sin credenciales guardadas (nunca conectada) → skipped_disabled", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    mockGetWeezeventConnectionRaw.mockResolvedValue(baseConnection({ credentialsEncrypted: null }));
    const result = await syncEventIntegration(1, {}, fakeConn());
    expect(result.status).toBe("skipped_disabled");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("lock ya ocupado → skipped_locked, nunca llama al adapter", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    mockTryAcquireSyncLock.mockResolvedValue({ acquired: false, run: null, reason: "sync already running" });
    mockCreateAdapter.mockReturnValue(fakeAdapter());

    const result = await syncEventIntegration(1, {}, fakeConn());

    expect(result.status).toBe("skipped_locked");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });
});

describe("syncEventIntegration — auth de dos pasos (F71: getWeezeventAccessToken ahora SÍ se invoca)", () => {
  it("credenciales ya con accessToken → nunca llama a getWeezeventAccessToken", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    mockCreateAdapter.mockReturnValue(fakeAdapter());

    await syncEventIntegration(1, {}, fakeConn());

    expect(mockGetWeezeventAccessToken).not.toHaveBeenCalled();
  });

  it("credenciales solo con username+password+apiKey (sin accessToken) → intercambia un access_token real antes de llamar al adapter", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    mockDecryptCredentials.mockReturnValue({ apiKey: "wz_fixture", username: "admin", password: "secret" });
    mockGetWeezeventAccessToken.mockResolvedValue("exchanged-token-123");
    const adapter = fakeAdapter();
    mockCreateAdapter.mockReturnValue(adapter);

    await syncEventIntegration(1, {}, fakeConn());

    expect(mockGetWeezeventAccessToken).toHaveBeenCalledOnce();
    expect(adapter.listTicketTypes).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "exchanged-token-123" }), "wz_evt_001",
    );
  });
});

describe("syncEventIntegration — RATES → TICKETS(paymentless) → ATTENDANCE", () => {
  it("con las condiciones cumplidas, sincroniza tarifas, ingiere cada ticket como paymentless y procesa asistencia", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    const adapter = fakeAdapter();
    mockCreateAdapter.mockReturnValue(adapter);

    const result = await syncEventIntegration(1, {}, fakeConn());

    expect(adapter.listTicketTypes).toHaveBeenCalledWith(expect.anything(), "wz_evt_001");
    expect(mockSyncTicketTypes).toHaveBeenCalledOnce();
    expect(adapter.listTickets).toHaveBeenCalledWith(expect.anything(), "wz_evt_001", undefined);
    expect(mockIngestPaymentlessTicket).toHaveBeenCalledOnce();
    expect(mockIngestPaymentlessTicket.mock.calls[0][0]).toMatchObject({ provider: "weezevent", integrationType: "event_integration", eventId: 77, venueId: null });
    expect(adapter.listAttendance).toHaveBeenCalledWith(expect.anything(), "wz_evt_001", undefined);
    expect(mockIngestAttendance).toHaveBeenCalledOnce();
    expect(mockIngestAttendance.mock.calls[0][0]).toMatchObject({ provider: "weezevent", integrationType: "event_integration", eventId: 77 });

    expect(result.status).toBe("success");
    expect(result.ratesSynced).toBe(1);
    expect(result.paymentlessCreated).toBe(1);
    expect(result.attendanceProcessed).toBe(1);
    expect(mockFinishSyncRun).toHaveBeenCalledWith(900, expect.objectContaining({ failedCount: 0 }), "success");
    expect(mockRecordEventIntegrationResult).toHaveBeenCalledWith(1, true, null);
  });

  it("con un cursor previo (sync anterior real) → pasa ese `since` real a listTickets/listAttendance — cierre F71 punto 14: antes se ignoraba siempre, cada sync recargaba todo el evento entero", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    const priorSince = new Date("2026-08-20T10:00:00.000Z");
    mockGetSyncState.mockResolvedValue({ cursor: null, updatedSince: priorSince });
    const adapter = fakeAdapter();
    mockCreateAdapter.mockReturnValue(adapter);

    await syncEventIntegration(1, {}, fakeConn());

    expect(adapter.listTickets).toHaveBeenCalledWith(expect.anything(), "wz_evt_001", priorSince);
    expect(adapter.listAttendance).toHaveBeenCalledWith(expect.anything(), "wz_evt_001", priorSince);
  });

  it("sin cursor previo (primer sync de este vínculo) → since=undefined, carga completa — comportamiento histórico intacto", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    mockGetSyncState.mockResolvedValue(null);
    const adapter = fakeAdapter();
    mockCreateAdapter.mockReturnValue(adapter);

    await syncEventIntegration(1, {}, fakeConn());

    expect(adapter.listTickets).toHaveBeenCalledWith(expect.anything(), "wz_evt_001", undefined);
  });

  it("un check-in nuevo de un ticket sincronizado en un run ANTERIOR resuelve su ticket_id igualmente — nunca se busca solo en el batch `tickets` de este run concreto", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    mockCreateAdapter.mockReturnValue(fakeAdapter({
      listTickets: vi.fn().mockResolvedValue([]), // este run incremental no trae tickets nuevos...
      listAttendance: vi.fn().mockResolvedValue([{ externalAttendanceId: "old_ticket:2026-08-22", externalEventId: "wz_evt_001", externalTicketId: "wz_ptc_viejo", participant: {}, occurredAt: new Date() }]), // ...pero SÍ una asistencia nueva de un ticket viejo
    }));
    const selectCalls: unknown[] = [];
    const conn: any = {
      select: (...args: unknown[]) => { selectCalls.push(args); return { from: () => ({ where: () => Promise.resolve([{ id: 999, externalTicketId: "wz_ptc_viejo" }]) }) }; },
    };

    await syncEventIntegration(1, {}, conn);

    expect(mockIngestAttendance.mock.calls[0][0]).toMatchObject({ ticketId: 999 });
  });

  it("loyaltyEnabled=false (default) sin historicalImport/suppressLoyalty explícito → suppressLoyalty:true (NO default-on, mismo criterio que Fourvenues)", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration({ loyaltyEnabled: false }));
    mockCreateAdapter.mockReturnValue(fakeAdapter());

    await syncEventIntegration(1, {}, fakeConn());

    expect(mockIngestAttendance.mock.calls[0][0]).toMatchObject({ suppressLoyalty: true });
  });

  it("loyaltyEnabled=true en la fila (flip explícito) → suppressLoyalty:false", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration({ loyaltyEnabled: true }));
    mockCreateAdapter.mockReturnValue(fakeAdapter());

    await syncEventIntegration(1, {}, fakeConn());

    expect(mockIngestAttendance.mock.calls[0][0]).toMatchObject({ suppressLoyalty: false });
  });

  it("historicalImport=true → suppressLoyalty:true aunque loyaltyEnabled=true en la fila", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration({ loyaltyEnabled: true }));
    mockCreateAdapter.mockReturnValue(fakeAdapter());

    await syncEventIntegration(1, { historicalImport: true }, fakeConn());

    expect(mockIngestAttendance.mock.calls[0][0]).toMatchObject({ suppressLoyalty: true, isHistoricalImport: true });
  });

  it("aislamiento de fallos: un ticket concreto que falla no aborta el resto ni la asistencia", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    mockCreateAdapter.mockReturnValue(fakeAdapter());
    mockIngestPaymentlessTicket.mockRejectedValue(new Error("boom"));

    const result = await syncEventIntegration(1, {}, fakeConn());

    expect(result.status).toBe("partial");
    expect(result.failedCount).toBeGreaterThan(0);
    expect(mockIngestAttendance).toHaveBeenCalledOnce();
    expect(mockFinishSyncRun).toHaveBeenCalledWith(900, expect.anything(), "partial");
  });

  it("un error ANTES de poder listar tipos de entrada (auth/red) aborta el run completo con status failed", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    const adapter = fakeAdapter({ listTicketTypes: vi.fn().mockRejectedValue(new Error("401 Unauthorized")) });
    mockCreateAdapter.mockReturnValue(adapter);

    const result = await syncEventIntegration(1, {}, fakeConn());

    expect(result.status).toBe("failed");
    expect(mockIngestPaymentlessTicket).not.toHaveBeenCalled();
    expect(mockFinishSyncRun).toHaveBeenCalledWith(900, expect.anything(), "failed", expect.stringContaining("401"));
    expect(mockRecordEventIntegrationResult).toHaveBeenCalledWith(1, false, expect.stringContaining("401"));
  });
});

describe("dryRunEventIntegration — nunca escribe", () => {
  it("no llama a syncTicketTypes/ingestPaymentlessTicket/ingestAttendance — solo lee y cuenta", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    const adapter = fakeAdapter();
    mockCreateAdapter.mockReturnValue(adapter);

    const result = await dryRunEventIntegration(1, fakeConn());

    expect(result.status).toBe("ok");
    expect(result.ratesFound).toBe(1);
    expect(result.ticketsFound).toBe(1);
    expect(result.attendanceFound).toBe(1);
    expect(result.identitiesUnresolved).toBe(1);
    expect(mockSyncTicketTypes).not.toHaveBeenCalled();
    expect(mockIngestPaymentlessTicket).not.toHaveBeenCalled();
    expect(mockIngestAttendance).not.toHaveBeenCalled();
    expect(mockTryAcquireSyncLock).not.toHaveBeenCalled(); // el dry run ni siquiera intenta el lock — no es un sync real
  });

  it("global kill switch OFF → blocked, sin llamar al adapter", async () => {
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "false";
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    const result = await dryRunEventIntegration(1, fakeConn());
    expect(result.status).toBe("blocked");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("sin externalEventId configurado → blocked", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration({ externalEventId: null }));
    const result = await dryRunEventIntegration(1, fakeConn());
    expect(result.status).toBe("blocked");
    expect(result.message).toContain("externalEventId");
  });

  it("sin conexión Weezevent asociada → blocked, nunca llama al adapter", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration());
    mockGetWeezeventConnectionRaw.mockResolvedValue(null);
    const result = await dryRunEventIntegration(1, fakeConn());
    expect(result.status).toBe("blocked");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("SÍ funciona aunque syncEnabled=false — el dry run decide si activar el sync real, no puede depender de que ya lo esté", async () => {
    mockGetEventIntegrationRaw.mockResolvedValue(baseIntegration({ syncEnabled: false }));
    mockCreateAdapter.mockReturnValue(fakeAdapter());

    const result = await dryRunEventIntegration(1, fakeConn());
    expect(result.status).toBe("ok");
  });
});
