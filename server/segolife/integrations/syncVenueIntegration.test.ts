/**
 * syncVenueIntegration.test.ts — orquestación de syncVenueIntegration/
 * dryRunVenueIntegration (Fourvenues Operational Sync). Mismo patrón que el
 * resto de pipelines: se mockean los límites del módulo (integrationsDb,
 * cripto, el adapter, y los sub-pipelines ya testeados por separado en
 * eventCatalogSync.test.ts/ticketPurchasePipeline.test.ts/
 * attendancePipeline.test.ts) — aquí se prueba SOLO la orquestación: orden
 * de etapas, kill switch, aislamiento de fallos, y que el dry run nunca
 * escribe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockGetVenueIntegrationRaw, mockGetProviderById, mockDecryptCredentials,
  mockStartSyncRun, mockFinishSyncRun, mockRecordVenueIntegrationResult, mockSetSyncCursor, mockFindInternalIdForExternal,
  mockCreateAdapter, mockSyncEventCatalog, mockSyncTicketTypes, mockIngestTicketPurchase, mockIngestAttendance, mockResolveIdentity,
} = vi.hoisted(() => ({
  mockGetVenueIntegrationRaw: vi.fn(),
  mockGetProviderById: vi.fn(),
  mockDecryptCredentials: vi.fn(),
  mockStartSyncRun: vi.fn(),
  mockFinishSyncRun: vi.fn(),
  mockRecordVenueIntegrationResult: vi.fn(),
  mockSetSyncCursor: vi.fn(),
  mockFindInternalIdForExternal: vi.fn(),
  mockCreateAdapter: vi.fn(),
  mockSyncEventCatalog: vi.fn(),
  mockSyncTicketTypes: vi.fn(),
  mockIngestTicketPurchase: vi.fn(),
  mockIngestAttendance: vi.fn(),
  mockResolveIdentity: vi.fn(),
}));

vi.mock("./integrationsDb", () => ({
  getVenueIntegrationRaw: mockGetVenueIntegrationRaw,
  getProviderById: mockGetProviderById,
  startSyncRun: mockStartSyncRun,
  finishSyncRun: mockFinishSyncRun,
  recordVenueIntegrationResult: mockRecordVenueIntegrationResult,
  setSyncCursor: mockSetSyncCursor,
  findInternalIdForExternal: mockFindInternalIdForExternal,
}));
vi.mock("./integrationCredentialCrypto", () => ({ decryptCredentials: mockDecryptCredentials }));
vi.mock("./fourvenuesIntegrationsAdapter", () => ({
  createFourvenuesIntegrationsAdapter: mockCreateAdapter,
  FOURVENUES_INTEGRATIONS_BASE_URL: { sandbox: "https://api-alpha.fourvenues.com/integrations", production: "https://api.fourvenues.com/integrations" },
}));
vi.mock("./httpTransport", () => ({ createHttpTransport: () => ({ request: vi.fn() }) }));
vi.mock("./identityResolver", () => ({ resolveIdentity: mockResolveIdentity }));
vi.mock("./eventCatalogSync", () => ({ syncEventCatalog: mockSyncEventCatalog, syncTicketTypes: mockSyncTicketTypes }));
vi.mock("../ticketing/ticketPurchasePipeline", () => ({ ingestTicketPurchase: mockIngestTicketPurchase }));
vi.mock("../ticketing/attendancePipeline", () => ({ ingestAttendance: mockIngestAttendance }));

import { syncVenueIntegration, dryRunVenueIntegration } from "./integrationSyncService";

const ORIGINAL_ENV = process.env.EXTERNAL_INTEGRATIONS_ENABLED;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.EXTERNAL_INTEGRATIONS_ENABLED;
  else process.env.EXTERNAL_INTEGRATIONS_ENABLED = ORIGINAL_ENV;
});

function baseIntegration(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, venueId: 10, providerId: 5, environment: "sandbox" as const,
    enabled: true, credentialsEncrypted: "blob", syncEnabled: true,
    ...overrides,
  };
}

/** Fake mínimo — solo cubre `select({communityId}).from(communityVenues).where(...)`, la única query directa que hace el orquestador (el resto pasa por sub-pipelines ya mockeados). */
function fakeConn() {
  return { select: () => ({ from: () => ({ where: async () => [] }) }) } as never;
}

function fakeAdapter(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    listEvents: vi.fn().mockResolvedValue([{ externalId: "fvi_evt_001", name: "Fixture Night" }]),
    listTicketTypes: vi.fn().mockResolvedValue([{ externalId: "fvi_rate_001", name: "General" }]),
    listOrders: vi.fn().mockResolvedValue([{ externalId: "fvi_pay_001", buyer: {} }]),
    listTickets: vi.fn().mockResolvedValue([{ externalId: "fvi_tkt_001", externalOrderId: "fvi_pay_001", participant: {} }]),
    listAttendance: vi.fn().mockResolvedValue([{ externalAttendanceId: "fvi_tkt_001", participant: {} }]),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EXTERNAL_INTEGRATIONS_ENABLED = "true";
  mockGetProviderById.mockResolvedValue({ key: "fourvenues_integrations" });
  mockDecryptCredentials.mockReturnValue({ apiKey: "ik_fixture" });
  mockStartSyncRun.mockResolvedValue({ id: 900 });
  mockSyncEventCatalog.mockResolvedValue({
    items: [{ externalId: "fvi_evt_001", name: "Fixture Night", outcome: "created", eventId: 77 }],
    createdCount: 1, updatedCount: 0, ambiguousCount: 0,
  });
  mockSyncTicketTypes.mockResolvedValue({ createdCount: 1, updatedCount: 0, ticketTypeIdByExternalId: new Map([["fvi_rate_001", 55]]) });
  mockIngestTicketPurchase.mockResolvedValue({ status: "created", order: { id: 501 }, ticketsCreated: 1, unresolvedTickets: 0 });
  mockIngestAttendance.mockResolvedValue({ status: "processed", attendance: { id: 1 } });
});

describe("syncVenueIntegration — kill switch", () => {
  it("integración no encontrada → failed, sin llamar al adapter", async () => {
    mockGetVenueIntegrationRaw.mockResolvedValue(null);
    const result = await syncVenueIntegration(999, {}, fakeConn());
    expect(result.status).toBe("failed");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("global kill switch OFF → skipped_disabled, sin llamar al adapter", async () => {
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "false";
    mockGetVenueIntegrationRaw.mockResolvedValue(baseIntegration());
    const result = await syncVenueIntegration(1, {}, fakeConn());
    expect(result.status).toBe("skipped_disabled");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("syncEnabled=false → skipped_disabled (aunque el resto esté correcto)", async () => {
    mockGetVenueIntegrationRaw.mockResolvedValue(baseIntegration({ syncEnabled: false }));
    const result = await syncVenueIntegration(1, {}, fakeConn());
    expect(result.status).toBe("skipped_disabled");
  });

  it("provider distinto de fourvenues_integrations → failed, no soportado", async () => {
    mockGetVenueIntegrationRaw.mockResolvedValue(baseIntegration());
    mockGetProviderById.mockResolvedValue({ key: "weezevent" });
    const result = await syncVenueIntegration(1, {}, fakeConn());
    expect(result.status).toBe("failed");
    expect(result.message).toContain("no soportado");
  });
});

describe("syncVenueIntegration — orden EVENTS → RATES → ORDERS/TICKETS → ATTENDANCE (spec §49)", () => {
  it("con las 4 condiciones del kill switch cumplidas, sincroniza evento→rates→orders→attendance en orden y reporta counts", async () => {
    mockGetVenueIntegrationRaw.mockResolvedValue(baseIntegration());
    const adapter = fakeAdapter();
    mockCreateAdapter.mockReturnValue(adapter);

    const result = await syncVenueIntegration(1, {}, fakeConn());

    expect(adapter.listEvents).toHaveBeenCalledOnce();
    expect(mockSyncEventCatalog).toHaveBeenCalledOnce();
    expect(adapter.listTicketTypes).toHaveBeenCalledWith(expect.anything(), "fvi_evt_001");
    expect(mockSyncTicketTypes).toHaveBeenCalledOnce();
    expect(adapter.listOrders).toHaveBeenCalledWith(expect.anything(), "fvi_evt_001");
    expect(adapter.listTickets).toHaveBeenCalledWith(expect.anything(), "fvi_evt_001");
    expect(mockIngestTicketPurchase).toHaveBeenCalledOnce();
    expect(mockIngestTicketPurchase.mock.calls[0][0]).toMatchObject({ eventId: 77, venueId: 10 });
    expect(adapter.listAttendance).toHaveBeenCalledWith(expect.anything(), "fvi_evt_001");
    expect(mockIngestAttendance).toHaveBeenCalledOnce();

    expect(result.status).toBe("success");
    expect(result.eventsCreated).toBe(1);
    expect(result.ordersCreated).toBe(1);
    expect(result.attendanceProcessed).toBe(1);
    expect(mockFinishSyncRun).toHaveBeenCalledWith(900, expect.objectContaining({ failedCount: 0 }), "success");
  });

  it("evento AMBIGUO (sin eventId resuelto) → se omite del sync, nunca se ingieren sus pedidos/asistencia", async () => {
    mockGetVenueIntegrationRaw.mockResolvedValue(baseIntegration());
    mockSyncEventCatalog.mockResolvedValue({
      items: [{ externalId: "fvi_evt_001", name: "Fixture Night", outcome: "ambiguous", eventId: null }],
      createdCount: 0, updatedCount: 0, ambiguousCount: 1,
    });
    const adapter = fakeAdapter();
    mockCreateAdapter.mockReturnValue(adapter);

    const result = await syncVenueIntegration(1, {}, fakeConn());

    expect(adapter.listTicketTypes).not.toHaveBeenCalled();
    expect(mockIngestTicketPurchase).not.toHaveBeenCalled();
    expect(mockIngestAttendance).not.toHaveBeenCalled();
    expect(result.eventsAmbiguous).toBe(1);
  });

  it("aislamiento de fallos (spec §56): un pedido concreto que falla NO aborta el resto del sync ni la asistencia del mismo evento", async () => {
    mockGetVenueIntegrationRaw.mockResolvedValue(baseIntegration());
    const adapter = fakeAdapter();
    mockCreateAdapter.mockReturnValue(adapter);
    mockIngestTicketPurchase.mockRejectedValue(new Error("boom"));

    const result = await syncVenueIntegration(1, {}, fakeConn());

    expect(result.status).toBe("partial");
    expect(result.failedCount).toBeGreaterThan(0);
    expect(mockIngestAttendance).toHaveBeenCalledOnce(); // sigue procesando el resto del mismo evento
    expect(mockFinishSyncRun).toHaveBeenCalledWith(900, expect.anything(), "partial");
  });

  it("un error ANTES de listEvents (auth/red) aborta el run completo con status failed", async () => {
    mockGetVenueIntegrationRaw.mockResolvedValue(baseIntegration());
    const adapter = fakeAdapter({ listEvents: vi.fn().mockRejectedValue(new Error("401 Unauthorized")) });
    mockCreateAdapter.mockReturnValue(adapter);

    const result = await syncVenueIntegration(1, {}, fakeConn());

    expect(result.status).toBe("failed");
    expect(mockSyncEventCatalog).not.toHaveBeenCalled();
    expect(mockFinishSyncRun).toHaveBeenCalledWith(900, expect.anything(), "failed", expect.stringContaining("401"));
  });
});

describe("dryRunVenueIntegration — nunca escribe (spec §10)", () => {
  it("no llama a syncEventCatalog/syncTicketTypes/ingestTicketPurchase/ingestAttendance — solo lee y cuenta", async () => {
    mockGetVenueIntegrationRaw.mockResolvedValue(baseIntegration());
    mockFindInternalIdForExternal.mockResolvedValue(null);
    mockResolveIdentity.mockResolvedValue({ userId: null, method: null });
    const adapter = fakeAdapter();
    mockCreateAdapter.mockReturnValue(adapter);

    const result = await dryRunVenueIntegration(1, {}, fakeConn());

    expect(result.status).toBe("ok");
    expect(result.eventsFound).toBe(1);
    expect(result.newEvents).toBe(1);
    expect(result.ordersFound).toBe(1);
    expect(result.ticketsFound).toBe(1);
    expect(result.attendanceFound).toBe(1);
    expect(result.identitiesUnresolved).toBe(1);
    expect(mockSyncEventCatalog).not.toHaveBeenCalled();
    expect(mockSyncTicketTypes).not.toHaveBeenCalled();
    expect(mockIngestTicketPurchase).not.toHaveBeenCalled();
    expect(mockIngestAttendance).not.toHaveBeenCalled();
    expect(mockStartSyncRun).not.toHaveBeenCalled(); // el dry run ni siquiera abre un sync run — no es un sync real
  });

  it("global kill switch OFF → blocked, sin llamar al adapter (mismo criterio que el sync real)", async () => {
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "false";
    mockGetVenueIntegrationRaw.mockResolvedValue(baseIntegration());
    const result = await dryRunVenueIntegration(1, {}, fakeConn());
    expect(result.status).toBe("blocked");
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("SÍ funciona aunque syncEnabled=false — el dry run es cómo se decide activar el sync real, no puede depender de que ya lo esté", async () => {
    mockGetVenueIntegrationRaw.mockResolvedValue(baseIntegration({ syncEnabled: false }));
    mockFindInternalIdForExternal.mockResolvedValue(null);
    mockResolveIdentity.mockResolvedValue({ userId: null, method: null });
    mockCreateAdapter.mockReturnValue(fakeAdapter());

    const result = await dryRunVenueIntegration(1, {}, fakeConn());
    expect(result.status).toBe("ok");
  });
});
