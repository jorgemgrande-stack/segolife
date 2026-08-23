/**
 * integrationsWeezeventConnection.test.ts — refactor de conexión Weezevent
 * (cierre F71, 2026-08-23): UNA cuenta reutilizable, MUCHOS eventos
 * vinculados. Cubre exclusivamente el router (connectWeezevent/
 * linkWeezeventEvent) — la lógica de duplicados de vinculación ya está
 * cubierta en integrations/linkWeezeventEvent.test.ts; aquí se prueba SOLO
 * el wiring del router y, sobre todo, la propiedad de seguridad explícita
 * del cierre (punto 16): si solo hay usuario+contraseña, se intercambian
 * por un access_token real y NUNCA se persisten.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetTheWeezeventConnection, mockGetWeezeventConnectionRaw, mockCreateWeezeventConnection,
  mockUpdateWeezeventConnectionCredentials, mockRecordWeezeventConnectionTestResult, mockUpdateWeezeventDiscoveredEvents,
  mockLinkWeezeventEventDb, mockGetProviderByKey,
  mockGetWeezeventAccessToken, mockCreateWeezeventAdapter, mockDecryptCredentials,
} = vi.hoisted(() => ({
  mockGetTheWeezeventConnection: vi.fn(),
  mockGetWeezeventConnectionRaw: vi.fn(),
  mockCreateWeezeventConnection: vi.fn(),
  mockUpdateWeezeventConnectionCredentials: vi.fn(),
  mockRecordWeezeventConnectionTestResult: vi.fn(),
  mockUpdateWeezeventDiscoveredEvents: vi.fn(),
  mockLinkWeezeventEventDb: vi.fn(),
  mockGetProviderByKey: vi.fn(),
  mockGetWeezeventAccessToken: vi.fn(),
  mockCreateWeezeventAdapter: vi.fn(),
  mockDecryptCredentials: vi.fn(),
}));

vi.mock("../segolife/integrations/integrationsDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/integrations/integrationsDb")>();
  return {
    ...actual,
    getTheWeezeventConnection: mockGetTheWeezeventConnection,
    getWeezeventConnectionRaw: mockGetWeezeventConnectionRaw,
    createWeezeventConnection: mockCreateWeezeventConnection,
    updateWeezeventConnectionCredentials: mockUpdateWeezeventConnectionCredentials,
    recordWeezeventConnectionTestResult: mockRecordWeezeventConnectionTestResult,
    updateWeezeventDiscoveredEvents: mockUpdateWeezeventDiscoveredEvents,
    linkWeezeventEvent: mockLinkWeezeventEventDb,
    getProviderByKey: mockGetProviderByKey,
  };
});
vi.mock("../segolife/integrations/weezeventAdapter", () => ({
  createWeezeventAdapter: mockCreateWeezeventAdapter,
  getWeezeventAccessToken: mockGetWeezeventAccessToken,
  WEEZEVENT_BASE_URL: "https://api.weezevent.com",
}));
vi.mock("../segolife/integrations/integrationCredentialCrypto", () => ({ decryptCredentials: mockDecryptCredentials }));
// El router usa su propio `_db` inline (mysql.createPool + drizzle) — mismo mock que integrations.test.ts, aquí nunca se ejercita ninguna rama que lo use.
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
  }),
}));

import { integrationsRouter } from "./integrations";

function callerAsAdmin() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return integrationsRouter.createCaller({ user: { id: 1, role: "admin" } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateWeezeventAdapter.mockReturnValue({ listEvents: vi.fn().mockResolvedValue([]) });
  mockGetWeezeventConnectionRaw.mockResolvedValue({ id: 5, credentialsEncrypted: "enc" });
  mockRecordWeezeventConnectionTestResult.mockResolvedValue(undefined);
  mockUpdateWeezeventDiscoveredEvents.mockResolvedValue(undefined);
});

describe("integrationsRouter.connectWeezevent — cierre F71 (2026-08-23)", () => {
  it("con accessToken directo → nunca llama a getWeezeventAccessToken, guarda exactamente apiKey+accessToken", async () => {
    mockGetTheWeezeventConnection.mockResolvedValue(null);
    mockCreateWeezeventConnection.mockResolvedValue({ id: 5 });
    mockDecryptCredentials.mockReturnValue({ apiKey: "ak", accessToken: "given-token" });

    const caller = callerAsAdmin();
    await caller.connectWeezevent({ apiKey: "ak", accessToken: "given-token" });

    expect(mockGetWeezeventAccessToken).not.toHaveBeenCalled();
    expect(mockCreateWeezeventConnection).toHaveBeenCalledWith({
      credentials: { apiKey: "ak", accessToken: "given-token" },
      credentialsDisplayValue: "ak",
    });
  });

  it("SOLO con usuario+contraseña → intercambia un access_token real y JAMÁS persiste username/password (solo api_key+accessToken)", async () => {
    mockGetTheWeezeventConnection.mockResolvedValue(null);
    mockGetWeezeventAccessToken.mockResolvedValue("exchanged-token");
    mockCreateWeezeventConnection.mockResolvedValue({ id: 5 });
    mockDecryptCredentials.mockReturnValue({ apiKey: "ak", accessToken: "exchanged-token" });

    const caller = callerAsAdmin();
    await caller.connectWeezevent({ apiKey: "ak", username: "admin", password: "secret" });

    expect(mockGetWeezeventAccessToken).toHaveBeenCalledOnce();
    expect(mockGetWeezeventAccessToken).toHaveBeenCalledWith(expect.anything(), { apiKey: "ak", username: "admin", password: "secret" });
    const savedCredentials = mockCreateWeezeventConnection.mock.calls[0][0].credentials;
    expect(savedCredentials).toEqual({ apiKey: "ak", accessToken: "exchanged-token" });
    expect(savedCredentials).not.toHaveProperty("username");
    expect(savedCredentials).not.toHaveProperty("password");
  });

  it("reconectar (ya existe una conexión) → actualiza la MISMA fila, nunca crea una segunda", async () => {
    mockGetTheWeezeventConnection.mockResolvedValue({ id: 5, credentialsConfigured: true });
    mockDecryptCredentials.mockReturnValue({ apiKey: "ak2", accessToken: "tok2" });

    const caller = callerAsAdmin();
    await caller.connectWeezevent({ apiKey: "ak2", accessToken: "tok2" });

    expect(mockUpdateWeezeventConnectionCredentials).toHaveBeenCalledWith(5, { apiKey: "ak2", accessToken: "tok2" }, "ak2");
    expect(mockCreateWeezeventConnection).not.toHaveBeenCalled();
  });

  it("sin accessToken NI username/password → error, nunca intenta hablar con Weezevent", async () => {
    const caller = callerAsAdmin();
    await expect(caller.connectWeezevent({ apiKey: "ak" })).rejects.toThrow();
    expect(mockGetWeezeventAccessToken).not.toHaveBeenCalled();
    expect(mockCreateWeezeventConnection).not.toHaveBeenCalled();
    expect(mockCreateWeezeventAdapter).not.toHaveBeenCalled();
  });

  it("tras conectar, cachea los eventos descubiertos y el recuento — para no re-consultar /events en cada render del selector", async () => {
    mockGetTheWeezeventConnection.mockResolvedValue(null);
    mockCreateWeezeventConnection.mockResolvedValue({ id: 5 });
    mockDecryptCredentials.mockReturnValue({ apiKey: "ak", accessToken: "tok" });
    mockCreateWeezeventAdapter.mockReturnValue({
      listEvents: vi.fn().mockResolvedValue([{ externalId: "1", name: "Evento A", startsAt: new Date("2026-09-26"), endsAt: null, raw: { multipleDates: false } }]),
    });

    const caller = callerAsAdmin();
    const result = await caller.connectWeezevent({ apiKey: "ak", accessToken: "tok" });

    expect(result.ok).toBe(true);
    expect(result.eventsAccessibleCount).toBe(1);
    expect(mockUpdateWeezeventDiscoveredEvents).toHaveBeenCalledWith(5, [
      expect.objectContaining({ externalId: "1", name: "Evento A", multipleDates: false }),
    ]);
    expect(mockRecordWeezeventConnectionTestResult).toHaveBeenCalledWith(5, true, null, 1);
  });
});

describe("integrationsRouter.linkWeezeventEvent — wiring del router", () => {
  it("sin conexión configurada → error, nunca llega a la capa de datos de vinculación", async () => {
    mockGetTheWeezeventConnection.mockResolvedValue(null);
    const caller = callerAsAdmin();
    await expect(caller.linkWeezeventEvent({ eventId: 10, externalEventId: "wz_1" })).rejects.toThrow();
    expect(mockLinkWeezeventEventDb).not.toHaveBeenCalled();
  });

  it("con conexión configurada → delega en la capa de datos con el connectionId real", async () => {
    mockGetProviderByKey.mockResolvedValue({ id: 9, key: "weezevent" });
    mockGetTheWeezeventConnection.mockResolvedValue({ id: 5, credentialsConfigured: true });
    mockLinkWeezeventEventDb.mockResolvedValue({ id: 42, connectionId: 5 });

    const caller = callerAsAdmin();
    const result = await caller.linkWeezeventEvent({ eventId: 10, externalEventId: "wz_1", externalEventName: "Fiesta" });

    expect(mockLinkWeezeventEventDb).toHaveBeenCalledWith({ connectionId: 5, eventId: 10, providerId: 9, externalEventId: "wz_1", externalEventName: "Fiesta" });
    expect(result).toEqual({ id: 42, connectionId: 5 });
  });
});
