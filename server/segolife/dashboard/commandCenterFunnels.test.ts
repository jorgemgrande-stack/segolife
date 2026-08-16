/**
 * commandCenterFunnels.test.ts — Fase 14, spec §14/§40. Cubre los 3 funnels
 * de conversión (evento/referido/benefit) — solo etapas con hecho canónico
 * real, nunca "visto" para Benefits.
 */
import { describe, it, expect, vi } from "vitest";

const { mockGetBenefitsPerformance } = vi.hoisted(() => ({ mockGetBenefitsPerformance: vi.fn() }));
vi.mock("./commandCenterLoyalty", () => ({ getBenefitsPerformance: (...args: unknown[]) => mockGetBenefitsPerformance(...args) }));

import { getEventFunnel, getReferralFunnel, getBenefitFunnel } from "./commandCenterFunnels";
import type { DashboardFilterContext } from "./dashboardFilters";

function fakeExecuteDb(queue: unknown[][]) {
  const execute = vi.fn();
  for (const rows of queue) execute.mockResolvedValueOnce([rows, []]);
  return { execute };
}

const CTX: DashboardFilterContext = { communityId: null, from: new Date("2026-08-01T00:00:00.000Z"), to: new Date("2026-08-15T00:00:00.000Z"), rangeLabel: "30d" };
const CTX_COMMUNITY: DashboardFilterContext = { ...CTX, communityId: 3 };

describe("getEventFunnel", () => {
  it("compone las 3 etapas reales: pedidos pagados, entradas emitidas, asistencias", async () => {
    const db = fakeExecuteDb([[{ n: 42 }], [{ n: 55 }], [{ n: 38 }]]);
    const funnel = await getEventFunnel(CTX, db as never);
    expect(funnel.stages).toEqual([
      { key: "orders_paid", label: "Pedidos pagados", count: 42 },
      { key: "tickets_issued", label: "Entradas emitidas", count: 55 },
      { key: "attendance", label: "Asistencias confirmadas", count: 38 },
    ]);
  });

  it("con dataset vacío, las 3 etapas son 0 (nunca error/NaN)", async () => {
    const db = fakeExecuteDb([[], [], []]);
    const funnel = await getEventFunnel(CTX, db as never);
    expect(funnel.stages.every(s => s.count === 0)).toBe(true);
  });

  it("aplica el filtro de comunidad a las 3 queries cuando communityId no es null", async () => {
    const db = fakeExecuteDb([[{ n: 1 }], [{ n: 1 }], [{ n: 1 }]]);
    await getEventFunnel(CTX_COMMUNITY, db as never);
    expect(db.execute).toHaveBeenCalledTimes(3);
    for (const call of db.execute.mock.calls) {
      const queryText = JSON.stringify(call[0]);
      expect(queryText).toContain("community_id");
    }
  });
});

describe("getReferralFunnel", () => {
  it("'convertidos' incluye tanto converted como rewarded (todo recompensado pasó por convertido)", async () => {
    const db = fakeExecuteDb([[
      { status: "registered", n: 10 },
      { status: "converted", n: 4 },
      { status: "rewarded", n: 3 },
    ]]);
    const funnel = await getReferralFunnel(CTX, db as never);
    expect(funnel.stages).toEqual([
      { key: "registered", label: "Referidos registrados", count: 17 },
      { key: "converted", label: "Convertidos", count: 7 },
      { key: "rewarded", label: "Recompensados", count: 3 },
    ]);
  });

  it("con dataset vacío, las 3 etapas son 0", async () => {
    const db = fakeExecuteDb([[]]);
    const funnel = await getReferralFunnel(CTX, db as never);
    expect(funnel.stages.every(s => s.count === 0)).toBe(true);
  });

  it("valores de status reservados (ineligible/expired/cancelled) no rompen el cálculo si aparecieran", async () => {
    const db = fakeExecuteDb([[
      { status: "registered", n: 5 },
      { status: "ineligible", n: 2 },
      { status: "expired", n: 1 },
    ]]);
    const funnel = await getReferralFunnel(CTX, db as never);
    expect(funnel.stages[0].count).toBe(8); // registered cuenta TODAS las filas del periodo, incluidas ineligible/expired
    expect(funnel.stages[1].count).toBe(0); // converted/rewarded siguen en 0
  });

  it("filtra por communityId directamente sobre la columna community_id de referrals", async () => {
    const db = fakeExecuteDb([[]]);
    await getReferralFunnel(CTX_COMMUNITY, db as never);
    const queryText = JSON.stringify(db.execute.mock.calls[0][0]);
    expect(queryText).toContain("community_id");
  });
});

describe("getBenefitFunnel", () => {
  it("reutiliza getBenefitsPerformance y mapea generated/redeemed/expired a etapas, SIN etapa 'visto'", async () => {
    mockGetBenefitsPerformance.mockResolvedValueOnce({
      generated: 20, available: 12, redeemed: 6, expired: 2, redemptionRatePct: 30, expiringWithin48h: 0, mostRedeemed: [],
    });
    const funnel = await getBenefitFunnel(CTX, {} as never);
    expect(funnel.stages).toEqual([
      { key: "granted", label: "Concedidos", count: 20 },
      { key: "redeemed", label: "Canjeados", count: 6 },
      { key: "expired", label: "Expirados", count: 2 },
    ]);
    expect(funnel.stages.some(s => s.key === "viewed")).toBe(false);
  });

  it("nunca reimplementa el cálculo — delega 100% en getBenefitsPerformance con el mismo ctx/db", async () => {
    mockGetBenefitsPerformance.mockResolvedValueOnce({ generated: 0, available: 0, redeemed: 0, expired: 0, redemptionRatePct: null, expiringWithin48h: 0, mostRedeemed: [] });
    const db = {};
    await getBenefitFunnel(CTX, db as never);
    expect(mockGetBenefitsPerformance).toHaveBeenCalledWith(CTX, db);
  });
});
