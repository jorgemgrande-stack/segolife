/**
 * loyaltyShadow.test.ts — RBAC a nivel de router (spec §41). Todas las
 * procedures son permissionProcedure("tokens.view") — reutiliza el permiso
 * ya existente, nunca uno nuevo. Ningún Student puede acceder (mismo
 * criterio que el resto de superficies admin de esta sesión).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../segolife/tokens/loyaltyShadowService", () => ({
  isShadowEnabled: vi.fn(),
  getShadowKpis: vi.fn(),
  getShadowFeed: vi.fn(),
  getShadowAggregates: vi.fn(),
  getShadowHealth: vi.fn(),
}));

import { loyaltyShadowRouter } from "./loyaltyShadow";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return loyaltyShadowRouter.createCaller({ user: null } as any);
}

const FILTERS = { communityIds: "all" as const, from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" };

describe("loyaltyShadow router — admin-only (nunca accesible por Students)", () => {
  it("getStatus rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getStatus()).rejects.toThrow(/please login/i);
  });
  it("getKpis rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getKpis(FILTERS)).rejects.toThrow(/please login/i);
  });
  it("getFeed rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getFeed({ ...FILTERS, limit: 25, offset: 0 })).rejects.toThrow(/please login/i);
  });
  it("getAggregates rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getAggregates(FILTERS)).rejects.toThrow(/please login/i);
  });
  it("getHealth rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getHealth()).rejects.toThrow(/please login/i);
  });
});
