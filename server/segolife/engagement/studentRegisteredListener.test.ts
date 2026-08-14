/**
 * studentRegisteredListener.test.ts — WELCOME_STUDENT (Communication
 * Center, spec §27). Mismo patrón que benefitGrantedListener.test.ts:
 * `drizzle-orm/mysql2` mockeado enrutando por IDENTIDAD del objeto tabla
 * (robusto ante reordenar queries, ver esa cabecera) + createNotification/
 * renderTemplate mockeados para aislar solo la orquestación propia de este
 * listener.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateNotification, mockRenderTemplate, tableRows } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn().mockResolvedValue({ status: "created", notification: { id: 1 } }),
  mockRenderTemplate: vi.fn(),
  tableRows: { communities: [] as any[], users: [] as any[] },
}));

vi.mock("./notificationService", () => ({ createNotification: mockCreateNotification }));
vi.mock("./templates", () => ({ renderTemplate: mockRenderTemplate }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => {
    const b: any = {};
    let lastTable: unknown = null;
    b.select = () => b;
    b.from = (table: unknown) => { lastTable = table; return b; };
    b.where = () => b;
    b.limit = async () => {
      const schema = await import("../../../drizzle/schema");
      if (lastTable === schema.communities) return tableRows.communities;
      if (lastTable === schema.users) return tableRows.users;
      return [];
    };
    return b;
  },
}));

import { handleStudentRegisteredForEngagement } from "./studentRegisteredListener";

beforeEach(() => {
  vi.clearAllMocks();
  mockRenderTemplate.mockReturnValue({ titleEn: "Welcome", titleEs: "Bienvenido", bodyEn: "B", bodyEs: "B-ES", deepLink: "/ie" });
  mockCreateNotification.mockResolvedValue({ status: "created", notification: { id: 1 } });
  tableRows.communities = [];
  tableRows.users = [];
});

describe("handleStudentRegisteredForEngagement", () => {
  it("renderiza account_welcome con el nombre y deep link a la comunidad, y envía por email de forma inmediata", async () => {
    tableRows.communities = [{ slug: "ie" }];
    tableRows.users = [{ email: "student@example.invalid" }];

    await handleStudentRegisteredForEngagement({ userId: 42, communityId: 1, firstName: "Ana" });

    expect(mockRenderTemplate).toHaveBeenCalledWith("account_welcome", { studentFirstName: "Ana" }, "/ie", { studentFirstName: "Ana" });
    expect(mockCreateNotification).toHaveBeenCalledOnce();
    const input = mockCreateNotification.mock.calls[0][0];
    expect(input).toMatchObject({
      userId: 42, communityId: 1, templateKey: "account_welcome", category: "account",
      audienceType: "transactional", idempotencyKey: "student_registered:42",
      additionalChannels: ["email"], sendImmediately: true,
      recipient: { email: "student@example.invalid" },
    });
  });

  it("comunidad no encontrada → deep link null, nunca lanza", async () => {
    tableRows.communities = [];
    tableRows.users = [{ email: "student@example.invalid" }];

    await handleStudentRegisteredForEngagement({ userId: 42, communityId: 1, firstName: "Ana" });
    expect(mockRenderTemplate).toHaveBeenCalledWith("account_welcome", { studentFirstName: "Ana" }, null, { studentFirstName: "Ana" });
  });

  it("Student sin email resuelto → recipient.email null, createNotification igualmente llamado (in_app se procesa igual)", async () => {
    tableRows.communities = [{ slug: "ie" }];
    tableRows.users = [];

    await handleStudentRegisteredForEngagement({ userId: 42, communityId: 1, firstName: "Ana" });
    const input = mockCreateNotification.mock.calls[0][0];
    expect(input.recipient).toEqual({ email: null });
  });

  it("idempotencyKey es estable por userId", async () => {
    await handleStudentRegisteredForEngagement({ userId: 7, communityId: 2, firstName: "Luis" });
    expect(mockCreateNotification.mock.calls[0][0].idempotencyKey).toBe("student_registered:7");
  });
});
