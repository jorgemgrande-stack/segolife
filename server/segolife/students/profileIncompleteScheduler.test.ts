/**
 * profileIncompleteScheduler.test.ts — F66 (Communication Center). Verifica
 * que NUNCA usa sendImmediately (audienceType marketing debe respetar
 * isChannelAllowed(), ver cabecera del propio scheduler) y que la
 * idempotencyKey es estable por estudiante.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateNotification, mockSelectRows } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn(),
  mockSelectRows: { rows: [] as any[] },
}));

vi.mock("../engagement/notificationService", () => ({ createNotification: mockCreateNotification }));
vi.mock("../engagement/templates", () => ({ renderTemplate: (key: string) => ({ key, titleEn: "t", titleEs: "t-es", bodyEn: "b", bodyEs: "b-es" }) }));
vi.mock("../engagement/communicationChannelMatrix", () => ({ resolveAdditionalChannels: () => ["email"] }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => {
    const b: any = {};
    b.select = () => b;
    b.from = () => b;
    b.innerJoin = () => b;
    b.where = () => Promise.resolve(mockSelectRows.rows);
    return b;
  },
}));

import { tick } from "./profileIncompleteScheduler";

beforeEach(() => {
  mockCreateNotification.mockReset().mockResolvedValue({ status: "created" });
  mockSelectRows.rows = [];
});

describe("profileIncompleteScheduler — tick()", () => {
  it("notifica cada perfil incompleto devuelto por la query, con audienceType marketing y SIN sendImmediately", async () => {
    mockSelectRows.rows = [{ userId: 42, email: "student@example.invalid" }];

    await tick();

    expect(mockCreateNotification).toHaveBeenCalledOnce();
    const call = mockCreateNotification.mock.calls[0][0];
    expect(call).toMatchObject({
      userId: 42, type: "profile_incomplete", audienceType: "marketing",
      idempotencyKey: "profile_incomplete:42", recipient: { email: "student@example.invalid" },
    });
    expect(call.sendImmediately).toBeUndefined(); // NUNCA — debe respetar isChannelAllowed()
  });

  it("varios estudiantes incompletos: cada uno recibe su propia idempotencyKey", async () => {
    mockSelectRows.rows = [{ userId: 1, email: "a@example.invalid" }, { userId: 2, email: "b@example.invalid" }];
    await tick();
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification.mock.calls[0][0].idempotencyKey).toBe("profile_incomplete:1");
    expect(mockCreateNotification.mock.calls[1][0].idempotencyKey).toBe("profile_incomplete:2");
  });

  it("sin ningún perfil incompleto por debajo del cutoff → no notifica", async () => {
    mockSelectRows.rows = [];
    await tick();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("un fallo al notificar UN estudiante no impide notificar al resto", async () => {
    mockSelectRows.rows = [{ userId: 1, email: "a@example.invalid" }, { userId: 2, email: "b@example.invalid" }];
    mockCreateNotification.mockImplementation(async (input: { userId: number }) => {
      if (input.userId === 1) throw new Error("fallo simulado");
      return { status: "created" };
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(tick()).resolves.toBeUndefined();
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
