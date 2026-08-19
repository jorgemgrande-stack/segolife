/**
 * notifications.test.ts — FIX-05. Primer test de este router (las 6 fuentes
 * pre-existentes de la campana admin nunca tuvieron cobertura — fuera de
 * alcance retroactivo aquí). Cubre SOLO la 7ª fuente nueva
 * (fourvenues_publication): el puente hacia Engagement Core (System B) y
 * las ramas de dismiss/dismissAll específicas de este kind.
 *
 * Mismo patrón que benefitGrantedListener.test.ts: mockea `drizzle-orm/
 * mysql2` + `mysql2/promise` (enruta por IDENTIDAD del objeto tabla real
 * importado de drizzle/schema — `notifications`, aquí re-exportado como
 * `engagementNotifications` dentro del router para no chocar con el router
 * `notifications` del mismo nombre de archivo). RBAC (`checkRbacOrLegacy`)
 * y `markRead` de notificationsDb.ts se mockean aparte para aislar SOLO la
 * lógica propia de este router.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCheckRbacOrLegacy, mockMarkRead, tableRows, updateCalls } = vi.hoisted(() => ({
  mockCheckRbacOrLegacy: vi.fn().mockResolvedValue(true),
  mockMarkRead: vi.fn().mockResolvedValue(undefined),
  tableRows: { notifications: [] as any[] },
  updateCalls: [] as Array<{ set: Record<string, unknown> }>,
}));

vi.mock("../_core/rbac", () => ({ checkRbacOrLegacy: mockCheckRbacOrLegacy, getUserPermissions: vi.fn() }));
vi.mock("../segolife/engagement/notificationsDb", () => ({ markRead: mockMarkRead, markAllRead: vi.fn() }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => {
    const b: any = {};
    let lastTable: unknown = null;
    b.select = () => b;
    b.from = (table: unknown) => { lastTable = table; return b; };
    b.where = () => b;
    b.orderBy = () => b;
    b.limit = async () => {
      const schema = await import("../../drizzle/schema");
      if (lastTable === schema.notifications) return tableRows.notifications;
      return [];
    };
    b.update = (table: unknown) => { lastTable = table; return b; };
    b.set = (values: Record<string, unknown>) => { updateCalls.push({ set: values }); return b; };
    b.execute = async () => [{}];
    return b;
  },
}));

import { notificationsRouter, sourceFourvenuesPublicationChanges } from "./notifications";

function caller(userId = 1) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return notificationsRouter.createCaller({ user: { id: userId, role: "admin" } } as any);
}

function notificationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10, userId: 1, type: "fourvenues_event_published",
    titleEs: "Nuevo evento publicado en Fourvenues", bodyEs: 'Casanova ha publicado "WHITE PARTY" para el 15/09/2026 00:30.',
    deepLink: "/admin/events/42", readAt: null, createdAt: new Date("2026-08-19T16:30:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRbacOrLegacy.mockResolvedValue(true);
  mockMarkRead.mockResolvedValue(undefined);
  tableRows.notifications = [];
  updateCalls.length = 0;
});

describe("sourceFourvenuesPublicationChanges — puente hacia Engagement Core (FIX-05)", () => {
  it("proyecta las filas al shape del feed (title/subtitle/ctaPath/severity)", async () => {
    tableRows.notifications = [notificationRow()];
    const section = await sourceFourvenuesPublicationChanges(1);

    expect(section.kind).toBe("fourvenues_publication");
    expect(section.total).toBe(1);
    expect(section.items[0]).toMatchObject({
      entityId: 10,
      title: "Nuevo evento publicado en Fourvenues",
      ctaPath: "/admin/events/42",
      severity: "info",
    });
  });

  it("fourvenues_event_unpublished → severity 'warning' (distinto de 'published', que es informativo)", async () => {
    tableRows.notifications = [notificationRow({ type: "fourvenues_event_unpublished", id: 11 })];
    const section = await sourceFourvenuesPublicationChanges(1);
    expect(section.items[0].severity).toBe("warning");
  });

  it("sin filas → sección vacía, severity 'info', nunca lanza", async () => {
    const section = await sourceFourvenuesPublicationChanges(1);
    expect(section.total).toBe(0);
    expect(section.items).toEqual([]);
    expect(section.severity).toBe("info");
  });

  it("deepLink ausente (caso extremo, nunca debería pasar en la práctica) → cae al log de Engagement, nunca deja ctaPath vacío", async () => {
    tableRows.notifications = [notificationRow({ deepLink: null })];
    const section = await sourceFourvenuesPublicationChanges(1);
    expect(section.items[0].ctaPath).toBe("/admin/engagement/notifications");
  });
});

describe("notificationsRouter.dismiss — kind='fourvenues_publication' (FIX-05)", () => {
  it("delega en markRead(entityId, userId) de Engagement Core — nunca escribe en admin_notification_dismissals", async () => {
    await caller(1).dismiss({ kind: "fourvenues_publication", entityId: 10 });
    expect(mockMarkRead).toHaveBeenCalledWith(10, 1);
  });

  it("si markRead lanza (notificación de OTRO usuario — IDOR real, ya protegido por notificationsDb.ts) el error se propaga, nunca se traga en silencio", async () => {
    mockMarkRead.mockRejectedValueOnce(new Error("NotificationOwnershipError"));
    await expect(caller(1).dismiss({ kind: "fourvenues_publication", entityId: 999 })).rejects.toThrow();
  });
});

describe("notificationsRouter.dismissAll — kind='fourvenues_publication' (FIX-05)", () => {
  it("marca como leídas SOLO las notificaciones fourvenues_publication de este usuario — nunca markAllRead genérico (que tocaría cualquier tipo)", async () => {
    tableRows.notifications = [notificationRow(), notificationRow({ id: 11, type: "fourvenues_event_unpublished" })];
    const result = await caller(1).dismissAll({ kind: "fourvenues_publication" });
    expect(result).toEqual({ ok: true, dismissed: 2 });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toHaveProperty("readAt");
  });
});
