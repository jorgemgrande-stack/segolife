/**
 * pushProvider.test.ts — F67 (Push + WhatsApp). Mismo criterio que
 * emailProvider — `configured` refleja el entorno REAL en el momento de
 * instanciar (nunca una falsa luz verde sin VAPID keys). `web-push` y
 * pushSubscriptionService se mockean: esto prueba la orquestación propia
 * del provider (multi-dispositivo, auto-limpieza 404/410, resultado
 * agregado), no la librería de push en sí.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OutboundMessage } from "../notificationProvider";

const { mockSendNotification, mockSetVapidDetails, mockListActive, mockRevokeByEndpoint } = vi.hoisted(() => ({
  mockSendNotification: vi.fn(),
  mockSetVapidDetails: vi.fn(),
  mockListActive: vi.fn(),
  mockRevokeByEndpoint: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: { setVapidDetails: mockSetVapidDetails, sendNotification: mockSendNotification },
}));
vi.mock("../pushSubscriptionService", () => ({
  listActiveSubscriptionsForUser: mockListActive,
  revokeSubscriptionByEndpoint: mockRevokeByEndpoint,
}));

const ORIGINAL_ENV = { ...process.env };

function baseMessage(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    userId: 42, title: "Título", body: "Cuerpo", deepLink: null, imageUrl: null,
    recipient: {}, ...overrides,
  };
}

async function loadProvider() {
  const { createPushProvider } = await import("./pushProvider");
  return createPushProvider();
}

beforeEach(() => {
  vi.resetModules();
  mockSendNotification.mockReset();
  mockSetVapidDetails.mockReset();
  mockListActive.mockReset().mockResolvedValue([]);
  mockRevokeByEndpoint.mockReset().mockResolvedValue(undefined);
  process.env = { ...ORIGINAL_ENV };
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

describe("createPushProvider — configuración", () => {
  it("sin ninguna de las 3 env vars, configured=false y send() nunca intenta un envío real", async () => {
    const provider = await loadProvider();
    expect(provider.capabilities.configured).toBe(false);

    const result = await provider.send(baseMessage());
    expect(result.status).toBe("skipped");
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("con solo 2 de las 3 env vars (falta VAPID_SUBJECT), sigue NOT configured", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    const provider = await loadProvider();
    expect(provider.capabilities.configured).toBe(false);
  });

  it("con las 3 env vars presentes, configured=true y llama a setVapidDetails al instanciar", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:ops@segolife.es";
    const provider = await loadProvider();
    expect(provider.capabilities.configured).toBe(true);
    expect(mockSetVapidDetails).toHaveBeenCalledWith("mailto:ops@segolife.es", "pub", "priv");
  });
});

describe("createPushProvider — send() (configurado)", () => {
  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:ops@segolife.es";
  });

  it("usuario sin ninguna suscripción activa → skipped, nunca llama a sendNotification", async () => {
    mockListActive.mockResolvedValue([]);
    const provider = await loadProvider();
    const result = await provider.send(baseMessage());
    expect(result.status).toBe("skipped");
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("envía a TODAS las suscripciones activas del usuario (multi-dispositivo), no solo la primera", async () => {
    mockListActive.mockResolvedValue([
      { endpoint: "https://push/a", keysP256dh: "p1", keysAuth: "a1" },
      { endpoint: "https://push/b", keysP256dh: "p2", keysAuth: "a2" },
    ]);
    mockSendNotification.mockResolvedValue({});
    const provider = await loadProvider();
    const result = await provider.send(baseMessage());

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("sent");
  });

  it("una suscripción caducada (410 Gone) se auto-revoca y no impide el envío a las demás", async () => {
    mockListActive.mockResolvedValue([
      { endpoint: "https://push/dead", keysP256dh: "p1", keysAuth: "a1" },
      { endpoint: "https://push/alive", keysP256dh: "p2", keysAuth: "a2" },
    ]);
    mockSendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === "https://push/dead") { const err = new Error("Gone") as Error & { statusCode: number }; err.statusCode = 410; throw err; }
      return {};
    });
    const provider = await loadProvider();
    const result = await provider.send(baseMessage());

    expect(result.status).toBe("sent"); // la viva sí se entregó
    expect(mockRevokeByEndpoint).toHaveBeenCalledWith("https://push/dead");
  });

  it("todas las suscripciones fallan por un motivo real (no 404/410) → failed, ninguna se revoca", async () => {
    mockListActive.mockResolvedValue([{ endpoint: "https://push/a", keysP256dh: "p1", keysAuth: "a1" }]);
    mockSendNotification.mockRejectedValue(new Error("Servicio de push caído"));
    const provider = await loadProvider();
    const result = await provider.send(baseMessage());

    expect(result.status).toBe("failed");
    expect(mockRevokeByEndpoint).not.toHaveBeenCalled();
  });
});
