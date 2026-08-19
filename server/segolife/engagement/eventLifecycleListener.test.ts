/**
 * eventLifecycleListener.test.ts — Fourvenues date-change audit (backlog,
 * spec §16/§17). Sin cobertura previa (primer test de este fichero). Mismo
 * patrón de mock por identidad de tabla que fourvenuesPublicationNotifier.test.ts
 * (este módulo usa un pool/singleton propio, sin `db` inyectable) —
 * `renderTemplate`/`resolveAdditionalChannels` se dejan REALES (funciones
 * puras ya probadas por su cuenta), solo se mockea `createNotification`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { events, ticketOrders, userCommunities } from "../../../drizzle/schema";

const { mockCreateNotification, tableRows } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn().mockResolvedValue({ status: "created", notification: { id: 1 } }),
  tableRows: {
    events: [] as Array<Record<string, unknown>>,
    ticketOrders: [] as Array<Record<string, unknown>>,
    userCommunities: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("./notificationService", () => ({ createNotification: mockCreateNotification }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  return {
    ...actual,
    drizzle: () => {
      let currentTable: unknown = null;
      const b: any = {};
      b.select = () => b;
      b.from = (t: unknown) => { currentTable = t; return b; };
      b.where = () => b;
      b.limit = () => b;
      b.then = (resolve: (v: unknown) => void) => {
        if (currentTable === events) return resolve(tableRows.events);
        if (currentTable === ticketOrders) return resolve(tableRows.ticketOrders);
        if (currentTable === userCommunities) return resolve(tableRows.userCommunities);
        return resolve([]);
      };
      return b;
    },
  };
});

import { handleEventUpdatedForEngagement, handleEventCancelledForEngagement } from "./eventLifecycleListener";

function eventRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, name: "WHITE PARTY", slug: "white-party", ...overrides };
}
function orderRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { userId: 42, email: "ana@ie.edu", orderId: 900, ...overrides };
}

beforeEach(() => {
  mockCreateNotification.mockClear();
  mockCreateNotification.mockResolvedValue({ status: "created", notification: { id: 1 } });
  tableRows.events = [eventRow()];
  tableRows.ticketOrders = [orderRow()];
  tableRows.userCommunities = [{ communityId: 1 }];
});

describe("handleEventUpdatedForEngagement — solo compradores reales, nunca broadcast (spec §17)", () => {
  it("1 comprador con order pagado → 1 notificación, con el evento/cambio real interpolado", async () => {
    await handleEventUpdatedForEngagement({ eventId: 1, changedFields: ["startsAt"] });
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const input = mockCreateNotification.mock.calls[0][0];
    expect(input.userId).toBe(42);
    expect(input.sourceType).toBe("event");
    expect(input.sourceId).toBe(1);
    expect(input.communityId).toBe(1);
    expect(input.rendered.titleEs).toContain("WHITE PARTY");
    expect(input.rendered.bodyEs).toContain("cambiado");
    expect(input.recipient).toEqual({ email: "ana@ie.edu" });
  });

  it("varios compradores del MISMO evento → una notificación por cada uno, nunca un broadcast general", async () => {
    tableRows.ticketOrders = [orderRow({ userId: 42, orderId: 900 }), orderRow({ userId: 43, orderId: 901, email: "bea@ie.edu" })];
    await handleEventUpdatedForEngagement({ eventId: 1, changedFields: ["startsAt"] });
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification.mock.calls.map(c => c[0].userId).sort()).toEqual([42, 43]);
  });

  it("idempotencyKey incluye orderId + changedFields — un reintento de la MISMA edición no debería poder duplicar (protegido por la UNIQUE real de notifications)", async () => {
    await handleEventUpdatedForEngagement({ eventId: 1, changedFields: ["startsAt"] });
    const key = mockCreateNotification.mock.calls[0][0].idempotencyKey;
    expect(key).toBe("event_updated:1:900:startsAt");
  });

  it("una edición material DISTINTA (endsAt) del mismo pedido genera una key DISTINTA — cada cambio real se notifica por su cuenta", async () => {
    await handleEventUpdatedForEngagement({ eventId: 1, changedFields: ["startsAt"] });
    await handleEventUpdatedForEngagement({ eventId: 1, changedFields: ["endsAt"] });
    const keys = mockCreateNotification.mock.calls.map(c => c[0].idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("un order sin userId (comprador anónimo, p.ej. puerta) se omite del fan-out, sin lanzar", async () => {
    tableRows.ticketOrders = [orderRow({ userId: null })];
    await expect(handleEventUpdatedForEngagement({ eventId: 1, changedFields: ["startsAt"] })).resolves.toBeUndefined();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("sin ningún comprador pagado → no-op limpio, nunca llama a createNotification", async () => {
    tableRows.ticketOrders = [];
    await handleEventUpdatedForEngagement({ eventId: 1, changedFields: ["startsAt"] });
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("evento no encontrado (borrado/inconsistencia) → no-op limpio, nunca lanza", async () => {
    tableRows.events = [];
    await expect(handleEventUpdatedForEngagement({ eventId: 999, changedFields: ["startsAt"] })).resolves.toBeUndefined();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});

describe("handleEventCancelledForEngagement — mismo criterio de fan-out por comprador real", () => {
  it("notifica solo a compradores reales, con idempotencyKey por order", async () => {
    await handleEventCancelledForEngagement({ eventId: 1 });
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const input = mockCreateNotification.mock.calls[0][0];
    expect(input.idempotencyKey).toBe("event_cancelled:1:900");
    expect(input.rendered.titleEs).toContain("WHITE PARTY");
  });
});
