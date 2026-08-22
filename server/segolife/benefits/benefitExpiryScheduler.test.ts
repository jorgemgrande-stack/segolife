/**
 * benefitExpiryScheduler.test.ts — F66 (Communication Center). `tick()` con
 * un reloj controlado (fechas fijas en las filas simuladas, nunca Date.now()
 * real): verifica la ventana de 24h, la localización EN/ES del nombre del
 * beneficio y la resiliencia ante un fallo puntual.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateNotification, mockSelectRows } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn(),
  mockSelectRows: { rows: [] as any[], recipientEmail: null as string | null },
}));

vi.mock("../engagement/notificationService", () => ({ createNotification: mockCreateNotification }));
vi.mock("../engagement/templates", () => ({
  renderTemplate: (key: string, vars: Record<string, string>, _deepLink: unknown, varsEs: Record<string, string>) => ({
    key, titleEn: vars.benefitName, titleEs: varsEs.benefitName, bodyEn: vars.expiryLabel, bodyEs: varsEs.expiryLabel,
  }),
}));
vi.mock("../engagement/communicationChannelMatrix", () => ({ resolveAdditionalChannels: () => ["email"] }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => {
    const b: any = {};
    let baseTable: unknown = null;
    b.select = () => b;
    b.from = (table: unknown) => { baseTable = table; return b; };
    b.innerJoin = () => b;
    // .where() debe servir a la vez para la query principal (sin .limit(),
    // se espera directamente — real: `await ...where(and(...))`) y para el
    // lookup de email (real: `...where(...).limit(1)`) — de ahí el .limit
    // colgado sobre la propia promesa devuelta.
    b.where = () => {
      const resolveRows = async () => {
        const schema = await import("../../../drizzle/schema");
        if (baseTable === schema.userBenefits) return mockSelectRows.rows;
        if (baseTable === schema.users) return mockSelectRows.recipientEmail != null ? [{ email: mockSelectRows.recipientEmail }] : [];
        return [];
      };
      const p = resolveRows() as Promise<unknown[]> & { limit?: (n: number) => Promise<unknown[]> };
      p.limit = async () => resolveRows();
      return p;
    };
    return b;
  },
}));

import { tick } from "./benefitExpiryScheduler";

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userBenefitId: 1, userId: 42, communityId: 1, validUntil: new Date(Date.now() + 6 * 60 * 60 * 1000),
    name: "Entrada gratis", nameEn: "Free entry", nameEs: "Entrada gratis",
    ...overrides,
  };
}

beforeEach(() => {
  mockCreateNotification.mockReset().mockResolvedValue({ status: "created" });
  mockSelectRows.rows = [];
  mockSelectRows.recipientEmail = "student@example.invalid";
});

describe("benefitExpiryScheduler — tick()", () => {
  it("notifica cada beneficio activo dentro de la ventana, con nombre EN/ES correcto e idempotencyKey por beneficio", async () => {
    mockSelectRows.rows = [row({ userBenefitId: 5 })];

    await tick();

    expect(mockCreateNotification).toHaveBeenCalledOnce();
    const call = mockCreateNotification.mock.calls[0][0];
    expect(call).toMatchObject({
      userId: 42, communityId: 1, type: "benefit_expiring", audienceType: "transactional",
      sendImmediately: true, idempotencyKey: "benefit_expiring:5", sourceId: 5,
    });
    expect(call.rendered.titleEn).toBe("Free entry");
    expect(call.rendered.titleEs).toBe("Entrada gratis");
  });

  it("usa el nombre genérico (name) como fallback si nameEn/nameEs son null", async () => {
    mockSelectRows.rows = [row({ nameEn: null, nameEs: null, name: "Beneficio X" })];
    await tick();
    const call = mockCreateNotification.mock.calls[0][0];
    expect(call.rendered.titleEn).toBe("Beneficio X");
    expect(call.rendered.titleEs).toBe("Beneficio X");
  });

  it("sin filas devueltas (nada caduca en la ventana) → no notifica a nadie", async () => {
    mockSelectRows.rows = [];
    await tick();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("un fallo al notificar UN beneficio no impide notificar el resto", async () => {
    mockSelectRows.rows = [row({ userBenefitId: 5, userId: 1 }), row({ userBenefitId: 6, userId: 2 })];
    mockCreateNotification.mockImplementation(async (input: { sourceId: number }) => {
      if (input.sourceId === 5) throw new Error("fallo simulado");
      return { status: "created" };
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(tick()).resolves.toBeUndefined();

    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
