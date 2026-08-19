/**
 * fourvenuesPublicationNotifier.test.ts — FIX-05. Mismo patrón que
 * benefitGrantedListener.test.ts: mockea `drizzle-orm/mysql2` + `mysql2/
 * promise` (enruta por IDENTIDAD del objeto tabla real importado de
 * drizzle/schema) y `./notificationService` para aislar solo la lógica
 * propia de este módulo (clasificación de transición, fan-out a admins,
 * idempotencyKey, best-effort ante fallo).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateNotification, tableRows } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn().mockResolvedValue({ status: "created", notification: { id: 1 } }),
  tableRows: { users: [] as Array<{ id: number }> },
}));

vi.mock("../engagement/notificationService", () => ({ createNotification: mockCreateNotification }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => {
    const b: any = {};
    b.select = () => b;
    b.from = () => b;
    b.where = async () => tableRows.users;
    return b;
  },
}));

import { classifyPublicationNotification, notifyPublicationTransition } from "./fourvenuesPublicationNotifier";
import type { EventPublicationTransition } from "./eventCatalogSync";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-08-19T12:00:00Z");
const FUTURE = new Date(now.getTime() + 10 * DAY_MS);
const PAST = new Date(now.getTime() - 10 * DAY_MS);

function transition(overrides: Partial<EventPublicationTransition> = {}): EventPublicationTransition {
  return { eventId: 42, from: "unpublished", to: "published", startsAt: FUTURE, endsAt: null, ...overrides };
}

describe("classifyPublicationNotification — pura (spec §22-28)", () => {
  it("unpublished→published, futuro → 'published'", () => {
    expect(classifyPublicationNotification(transition({ from: "unpublished", to: "published" }), now)).toBe("published");
  });
  it("unknown→published, futuro → 'published'", () => {
    expect(classifyPublicationNotification(transition({ from: "unknown", to: "published" }), now)).toBe("published");
  });
  it("null→published (evento nunca visto antes), futuro → 'published' (spec §26)", () => {
    expect(classifyPublicationNotification(transition({ from: null, to: "published" }), now)).toBe("published");
  });
  it("published→unpublished, futuro → 'unpublished'", () => {
    expect(classifyPublicationNotification(transition({ from: "published", to: "unpublished" }), now)).toBe("unpublished");
  });
  it("published→unknown, futuro → 'unpublished' (deja de estar publicado, sea cual sea el nuevo estado)", () => {
    expect(classifyPublicationNotification(transition({ from: "published", to: "unknown" }), now)).toBe("unpublished");
  });
  it("published→published → null (spec §24, sin ruido en cada sync)", () => {
    expect(classifyPublicationNotification(transition({ from: "published", to: "published" }), now)).toBeNull();
  });
  it("unpublished→unpublished → null", () => {
    expect(classifyPublicationNotification(transition({ from: "unpublished", to: "unpublished" }), now)).toBeNull();
  });
  it("unpublished→unknown → null (nunca cruza el límite 'published')", () => {
    expect(classifyPublicationNotification(transition({ from: "unpublished", to: "unknown" }), now)).toBeNull();
  });
  it("unknown→unknown → null", () => {
    expect(classifyPublicationNotification(transition({ from: "unknown", to: "unknown" }), now)).toBeNull();
  });
  it("evento YA PASADO, incluso unpublished→published → null (spec §30, flood protection histórico)", () => {
    expect(classifyPublicationNotification(transition({ from: "unpublished", to: "published", startsAt: PAST }), now)).toBeNull();
  });
  it("evento YA PASADO, published→unpublished → null (tampoco importa para histórico)", () => {
    expect(classifyPublicationNotification(transition({ from: "published", to: "unpublished", startsAt: PAST }), now)).toBeNull();
  });
});

describe("notifyPublicationTransition — fan-out a admins + idempotencia (spec §21-29)", () => {
  beforeEach(() => {
    mockCreateNotification.mockReset();
    mockCreateNotification.mockResolvedValue({ status: "created", notification: { id: 1 } });
    tableRows.users = [{ id: 1 }, { id: 2 }];
  });

  it("transición notify-worthy → 1 createNotification POR admin (2 admins → 2 llamadas)", async () => {
    await notifyPublicationTransition({ transition: transition(), eventName: "WHITE PARTY", venueName: "Casanova" });
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    const userIds = mockCreateNotification.mock.calls.map(c => c[0].userId).sort();
    expect(userIds).toEqual([1, 2]);
  });

  it("cada llamada usa type/category/audienceType/sourceType correctos y deep link /admin/events/:id", async () => {
    await notifyPublicationTransition({ transition: transition(), eventName: "WHITE PARTY", venueName: "Casanova" });
    const input = mockCreateNotification.mock.calls[0][0];
    expect(input.type).toBe("fourvenues_event_published");
    expect(input.category).toBe("events");
    expect(input.audienceType).toBe("transactional");
    expect(input.sourceType).toBe("integration:fourvenues_integrations");
    expect(input.sourceId).toBe(42);
    expect(input.rendered.deepLink).toBe("/admin/events/42");
    expect(input.rendered.bodyEs).toContain("Casanova");
    expect(input.rendered.bodyEs).toContain("WHITE PARTY");
  });

  it("idempotencyKey es distinto por admin (evita que el fan-out se autocolisione contra la UNIQUE real)", async () => {
    await notifyPublicationTransition({ transition: transition(), eventName: "WHITE PARTY", venueName: "Casanova" });
    const keys = mockCreateNotification.mock.calls.map(c => c[0].idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toContain("fourvenues_event_published:42:unpublished->published");
  });

  it("transición NO notify-worthy (published→published) → nunca llama a createNotification", async () => {
    await notifyPublicationTransition({ transition: transition({ from: "published", to: "published" }), eventName: "X", venueName: "Casanova" });
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("evento ya pasado → nunca notifica aunque sea unpublished→published (flood protection)", async () => {
    await notifyPublicationTransition({ transition: transition({ startsAt: PAST }), eventName: "X", venueName: "Casanova" });
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("sin admins activos → no falla, simplemente no notifica a nadie", async () => {
    tableRows.users = [];
    await expect(notifyPublicationTransition({ transition: transition(), eventName: "X", venueName: "Casanova" })).resolves.toBeUndefined();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("createNotification lanza → notifyPublicationTransition NUNCA propaga (best-effort, no rompe el catalog sync real)", async () => {
    mockCreateNotification.mockRejectedValueOnce(new Error("boom"));
    await expect(notifyPublicationTransition({ transition: transition(), eventName: "X", venueName: "Casanova" })).resolves.toBeUndefined();
  });

  it("venueName null (venue sin nombre resuelto) usa un placeholder, nunca 'null' literal ni lanza", async () => {
    await notifyPublicationTransition({ transition: transition(), eventName: "WHITE PARTY", venueName: null });
    const input = mockCreateNotification.mock.calls[0][0];
    expect(input.rendered.bodyEs).not.toContain("null");
  });

  it("published→unpublished usa la plantilla correcta y nunca afirma 'cancelado'", async () => {
    await notifyPublicationTransition({ transition: transition({ from: "published", to: "unpublished" }), eventName: "MIÉRCOLES LOCOS", venueName: "Tía Felisa" });
    const input = mockCreateNotification.mock.calls[0][0];
    expect(input.type).toBe("fourvenues_event_unpublished");
    expect(input.rendered.bodyEn.toLowerCase()).not.toContain("cancel");
  });
});
