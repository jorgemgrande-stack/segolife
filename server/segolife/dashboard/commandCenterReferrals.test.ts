/**
 * commandCenterReferrals.test.ts — Fase 14, spec §17/§40. Referral BI del
 * Command Center — agregación SQL acotada por periodo/comunidad (nunca
 * fetch-all como el getReferralOverview() heredado), mismo criterio de
 * tokensIssued que el admin real de Referrals.
 */
import { describe, it, expect, vi } from "vitest";

const { mockPendingReconciliation } = vi.hoisted(() => ({ mockPendingReconciliation: vi.fn() }));
vi.mock("../referrals/referralService", () => ({
  findReferralsPendingReconciliation: (...args: unknown[]) => mockPendingReconciliation(...args),
}));

import { getReferralBi } from "./commandCenterReferrals";
import type { DashboardFilterContext } from "./dashboardFilters";

function fakeExecuteDb(queue: unknown[][]) {
  const execute = vi.fn();
  for (const rows of queue) execute.mockResolvedValueOnce([rows, []]);
  return { execute };
}

const CTX: DashboardFilterContext = { communityId: null, from: new Date("2026-08-01T00:00:00.000Z"), to: new Date("2026-08-15T00:00:00.000Z"), rangeLabel: "30d" };

describe("getReferralBi", () => {
  it("registered incluye TODOS los status del periodo; converted incluye converted+rewarded", async () => {
    mockPendingReconciliation.mockResolvedValueOnce([]);
    const db = fakeExecuteDb([
      [{ status: "registered", n: 10, inviters: 8 }, { status: "converted", n: 4, inviters: 3 }, { status: "rewarded", n: 3, inviters: 3 }],
      [{ tokens_issued: 300, unique_inviters: 12 }],
      [],
    ]);
    const bi = await getReferralBi(CTX, db as never);
    expect(bi.registeredInPeriod).toBe(17);
    expect(bi.convertedInPeriod).toBe(7);
    expect(bi.rewardedInPeriod).toBe(3);
    expect(bi.tokensIssuedInPeriod).toBe(300);
    expect(bi.uniqueInvitersInPeriod).toBe(12);
  });

  it("conversionRatePct null con 0 registrados (nunca división por cero)", async () => {
    mockPendingReconciliation.mockResolvedValueOnce([]);
    const db = fakeExecuteDb([[], [{ tokens_issued: 0, unique_inviters: 0 }], []]);
    const bi = await getReferralBi(CTX, db as never);
    expect(bi.registeredInPeriod).toBe(0);
    expect(bi.conversionRatePct).toBeNull();
  });

  it("calcula conversionRatePct correctamente en el caso normal", async () => {
    mockPendingReconciliation.mockResolvedValueOnce([]);
    const db = fakeExecuteDb([
      [{ status: "registered", n: 6, inviters: 6 }, { status: "converted", n: 2, inviters: 2 }, { status: "rewarded", n: 2, inviters: 2 }],
      [{ tokens_issued: 100, unique_inviters: 8 }],
      [],
    ]);
    const bi = await getReferralBi(CTX, db as never);
    // registered total = 6+2+2=10, converted = 2+2=4 -> 40%
    expect(bi.conversionRatePct).toBe(40);
  });

  it("pendingReconciliation reutiliza findReferralsPendingReconciliation (mismo criterio del admin real, sin duplicar)", async () => {
    mockPendingReconciliation.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const db = fakeExecuteDb([[], [{ tokens_issued: 0, unique_inviters: 0 }], []]);
    const bi = await getReferralBi(CTX, db as never);
    expect(bi.pendingReconciliation).toBe(2);
    expect(mockPendingReconciliation).toHaveBeenCalledWith(15, db);
  });

  it("mapea topReferrers correctamente", async () => {
    mockPendingReconciliation.mockResolvedValueOnce([]);
    const db = fakeExecuteDb([
      [],
      [{ tokens_issued: 0, unique_inviters: 0 }],
      [{ referrer_user_id: 42, name: "María", converted_count: 5 }],
    ]);
    const bi = await getReferralBi(CTX, db as never);
    expect(bi.topReferrers).toEqual([{ referrerUserId: 42, name: "María", convertedCount: 5 }]);
  });

  it("valores reservados de status (ineligible/expired/cancelled) se suman a 'registered' si aparecieran, sin romper el cálculo", async () => {
    mockPendingReconciliation.mockResolvedValueOnce([]);
    const db = fakeExecuteDb([
      [{ status: "registered", n: 3, inviters: 3 }, { status: "ineligible", n: 1, inviters: 1 }],
      [{ tokens_issued: 0, unique_inviters: 0 }],
      [],
    ]);
    const bi = await getReferralBi(CTX, db as never);
    expect(bi.registeredInPeriod).toBe(4);
    expect(bi.convertedInPeriod).toBe(0);
  });

  it("aplica el filtro de comunidad directamente sobre referrals.community_id en las 3 queries", async () => {
    mockPendingReconciliation.mockResolvedValueOnce([]);
    const db = fakeExecuteDb([[], [{ tokens_issued: 0, unique_inviters: 0 }], []]);
    await getReferralBi({ ...CTX, communityId: 3 }, db as never);
    expect(db.execute).toHaveBeenCalledTimes(3);
    for (const call of db.execute.mock.calls) {
      expect(JSON.stringify(call[0])).toContain("community_id");
    }
  });
});
