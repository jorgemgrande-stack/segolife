/**
 * consumptionQr.test.ts — RBAC a nivel de router (Fase 3). Mismo patrón que
 * server/routers/tokens.test.ts / venues.test.ts: todos los procedures
 * (admin y autoservicio) exigen sesión — protectedProcedure/permissionProcedure
 * rechazan ANTES de tocar la BD, así que se prueban con `ctx.user = null` sin
 * mockear nada más. `redeem` es la ruta explícitamente marcada como PROTEGIDA
 * en el roadmap (nunca pública) — se verifica aquí igual que el resto.
 */
import { describe, it, expect } from "vitest";
import { consumptionQrRouter } from "./consumptionQr";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return consumptionQrRouter.createCaller({ user: null } as any);
}

describe("consumptionQr router — emisión (admin) rechaza sin sesión", () => {
  it("consumptionQr.issue rechaza sin sesión", async () => {
    await expect(callerWithoutSession().issue({ venueId: 1 })).rejects.toThrow(/please login/i);
  });
  it("consumptionQr.issueBatch rechaza sin sesión", async () => {
    await expect(callerWithoutSession().issueBatch({ venueId: 1, quantity: 5 })).rejects.toThrow(/please login/i);
  });
});

describe("consumptionQr router — listados (admin) rechazan sin sesión", () => {
  it("consumptionQr.list rechaza sin sesión", async () => {
    await expect(callerWithoutSession().list({ limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });
  it("consumptionQr.getById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getById({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("consumptionQr.listBatches rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listBatches({})).rejects.toThrow(/please login/i);
  });
  it("consumptionQr.getBatchDetail rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getBatchDetail({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("consumptionQr.listAttempts rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listAttempts({ limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });
  it("consumptionQr.getStatus rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getStatus({ qrId: 1 })).rejects.toThrow(/please login/i);
  });
});

describe("consumptionQr router — cancelación (admin) rechaza sin sesión", () => {
  it("consumptionQr.cancel rechaza sin sesión", async () => {
    await expect(callerWithoutSession().cancel({ qrId: 1, reason: "x" })).rejects.toThrow(/please login/i);
  });
});

describe("consumptionQr router — canje y autoservicio del estudiante (nunca público) rechazan sin sesión", () => {
  it("consumptionQr.redeem rechaza sin sesión — endpoint PROTEGIDO, nunca público", async () => {
    await expect(callerWithoutSession().redeem({ token: "0123456789abcdef" })).rejects.toThrow(/please login/i);
  });
  it("consumptionQr.myRedemptions rechaza sin sesión", async () => {
    await expect(callerWithoutSession().myRedemptions({ limit: 20 })).rejects.toThrow(/please login/i);
  });
});
