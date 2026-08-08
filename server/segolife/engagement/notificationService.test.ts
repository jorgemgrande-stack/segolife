/**
 * notificationService.test.ts — idempotencia real (UNIQUE de idempotency_key,
 * precheck + carrera ER_DUP_ENTRY), in_app síncrono siempre, canales
 * adicionales respetando preferencias/configuración del provider (spec
 * puntos 6, 44-45). Mismo patrón de mock por-tabla que commercePipeline.test.ts
 * (contador de llamadas para distinguir precheck vs refetch en la MISMA
 * tabla) — el provider real (getProvider) se mockea aparte, vía vi.mock,
 * porque notificationService.ts lo importa directamente (no es inyectable).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetProvider } = vi.hoisted(() => ({ mockGetProvider: vi.fn() }));
vi.mock("./providers/providerRegistry", () => ({ getProvider: mockGetProvider }));

import { createNotification } from "./notificationService";
import { notifications, notificationDeliveries } from "../../../drizzle/schema";

function makeMockDb(config: { existingNotification?: any; preferenceRows?: any[] } = {}) {
  const notificationRows: any[] = config.existingNotification ? [config.existingNotification] : [];
  const deliveryRows: any[] = [];
  const preferenceRows = config.preferenceRows ?? [];
  let notifSelectCount = 0;
  let notifNextId = config.existingNotification ? config.existingNotification.id + 1 : 1;
  let deliveryNextId = 1;
  let lastInsertedDelivery: any = null;

  let mode: "select" | "insert" | "update" = "select";
  let table: "notifications" | "notificationDeliveries" | "notificationPreferences" = "notifications";
  let pendingSet: Record<string, unknown> = {};

  const b: any = {};
  b.select = () => { mode = "select"; return b; };
  b.from = (t: unknown) => {
    table = t === notifications ? "notifications" : t === notificationDeliveries ? "notificationDeliveries" : "notificationPreferences";
    return b;
  };
  b.insert = (t: unknown) => { mode = "insert"; table = t === notifications ? "notifications" : "notificationDeliveries"; return b; };
  b.update = (t: unknown) => { mode = "update"; table = "notificationDeliveries"; return b; };
  b.ignore = () => b;
  b.set = (fields: Record<string, unknown>) => { pendingSet = fields; return b; };
  b.where = () => {
    if (mode === "update") {
      if (lastInsertedDelivery) Object.assign(lastInsertedDelivery, pendingSet);
      return Promise.resolve([{}]);
    }
    return b;
  };
  b.limit = (_n: number) => {
    if (table === "notifications") {
      notifSelectCount++;
      // Llamada 1: precheck por idempotencyKey (fila existente, si la hay).
      // Llamada 2: refetch tras el insert (la última fila insertada).
      return Promise.resolve(notifSelectCount === 1 ? notificationRows.slice(0, config.existingNotification ? 1 : 0) : notificationRows.slice(-1));
    }
    if (table === "notificationPreferences") return Promise.resolve(preferenceRows);
    return Promise.resolve([]);
  };
  b.values = (v: Record<string, unknown>) => {
    if (table === "notifications") {
      const row = { id: notifNextId++, readAt: null, clickedAt: null, ...v };
      notificationRows.push(row);
      return Promise.resolve([{ insertId: row.id }]);
    }
    // notificationDeliveries — UNIQUE(notification_id, channel) real.
    const dup = deliveryRows.find(r => r.notificationId === v.notificationId && r.channel === v.channel);
    if (dup) return Promise.resolve([{ insertId: 0 }]); // ignore() -> sin insertId nuevo
    const row = { id: deliveryNextId++, attemptCount: 0, ...v };
    deliveryRows.push(row);
    lastInsertedDelivery = row;
    return Promise.resolve([{ insertId: row.id }]);
  };
  return { db: b as any, notificationRows, deliveryRows };
}

beforeEach(() => {
  mockGetProvider.mockReset();
  mockGetProvider.mockImplementation((channel: string) => ({
    channel,
    capabilities: { configured: channel === "in_app", supportsTransactional: true, supportsMarketing: true, supportsDeliveryStatus: false, supportsRichContent: false, supportsDeepLinks: true },
    send: vi.fn().mockResolvedValue({ status: "sent" }),
  }));
});

const rendered = { titleEn: "T", titleEs: "T-ES", bodyEn: "B", bodyEs: "B-ES", deepLink: null };

describe("notificationService — idempotencia", () => {
  it("una idempotencyKey ya existente devuelve la fila existente, sin insertar una segunda", async () => {
    const existing = { id: 5, userId: 1, idempotencyKey: "benefit_granted:99" };
    const { db, notificationRows } = makeMockDb({ existingNotification: existing });
    const result = await createNotification({
      userId: 1, communityId: null, type: "benefit_granted", category: "benefits", audienceType: "transactional",
      rendered, idempotencyKey: "benefit_granted:99",
    }, db);
    expect(result.status).toBe("already_exists");
    expect(result.notification.id).toBe(5);
    expect(notificationRows).toHaveLength(1);
  });

  it("una notificación nueva se crea y su delivery in_app se procesa de forma síncrona", async () => {
    const { db, notificationRows, deliveryRows } = makeMockDb();
    const result = await createNotification({
      userId: 1, communityId: null, type: "benefit_granted", category: "benefits", audienceType: "transactional",
      rendered, idempotencyKey: "benefit_granted:1",
    }, db);
    expect(result.status).toBe("created");
    expect(notificationRows).toHaveLength(1);
    expect(deliveryRows).toHaveLength(1);
    expect(deliveryRows[0].channel).toBe("in_app");
    expect(deliveryRows[0].status).toBe("sent");
  });
});

describe("notificationService — canales adicionales", () => {
  it("un canal marketing sin preferencia previa queda 'skipped' (marketing OFF por defecto)", async () => {
    const { db, deliveryRows } = makeMockDb();
    await createNotification({
      userId: 1, communityId: null, type: "manual_announcement", category: "promotions", audienceType: "marketing",
      rendered, idempotencyKey: "campaign:1:1:email", additionalChannels: ["email"],
    }, db);
    const emailDelivery = deliveryRows.find(d => d.channel === "email");
    expect(emailDelivery?.status).toBe("skipped");
    expect(emailDelivery?.lastError).toMatch(/preference/i);
  });

  it("un canal marketing con preferencia enabled=true y provider configurado queda 'pending' (el scheduler lo procesa después)", async () => {
    mockGetProvider.mockImplementation((channel: string) => ({
      channel,
      capabilities: { configured: true, supportsTransactional: true, supportsMarketing: true, supportsDeliveryStatus: false, supportsRichContent: false, supportsDeepLinks: true },
      send: vi.fn().mockResolvedValue({ status: "sent" }),
    }));
    const { db, deliveryRows } = makeMockDb({ preferenceRows: [{ userId: 1, category: "promotions", channel: "email", enabled: true }] });
    await createNotification({
      userId: 1, communityId: null, type: "manual_announcement", category: "promotions", audienceType: "marketing",
      rendered, idempotencyKey: "campaign:1:1:email", additionalChannels: ["email"],
    }, db);
    const emailDelivery = deliveryRows.find(d => d.channel === "email");
    expect(emailDelivery?.status).toBe("pending");
  });

  it("un canal transactional se entrega igual aunque no exista preferencia (nunca bloquea lo esencial)", async () => {
    mockGetProvider.mockImplementation((channel: string) => ({
      channel,
      capabilities: { configured: true, supportsTransactional: true, supportsMarketing: true, supportsDeliveryStatus: false, supportsRichContent: false, supportsDeepLinks: true },
      send: vi.fn().mockResolvedValue({ status: "sent" }),
    }));
    const { db, deliveryRows } = makeMockDb();
    await createNotification({
      userId: 1, communityId: null, type: "benefit_granted", category: "benefits", audienceType: "transactional",
      rendered, idempotencyKey: "benefit_granted:1", additionalChannels: ["email"],
    }, db);
    const emailDelivery = deliveryRows.find(d => d.channel === "email");
    expect(emailDelivery?.status).toBe("pending");
  });

  it("un canal cuyo provider no está configurado queda 'skipped', nunca 'pending'", async () => {
    const { db, deliveryRows } = makeMockDb({ preferenceRows: [{ userId: 1, category: "promotions", channel: "whatsapp", enabled: true }] });
    await createNotification({
      userId: 1, communityId: null, type: "manual_announcement", category: "promotions", audienceType: "marketing",
      rendered, idempotencyKey: "campaign:1:1:whatsapp", additionalChannels: ["whatsapp"],
    }, db);
    const delivery = deliveryRows.find(d => d.channel === "whatsapp");
    expect(delivery?.status).toBe("skipped");
    expect(delivery?.lastError).toMatch(/not configured/i);
  });
});
