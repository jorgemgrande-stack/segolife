/**
 * economyOverviewService.test.ts — SEGOTOKENS ECONOMY & REWARD POLICY.
 * REUSE FIRST: se mockea getLoyaltyEconomy (ya testeado en su propio
 * archivo del Command Center) en vez de reprobar su SQL aquí — lo que se
 * prueba es la ORQUESTACIÓN (issued today/7d/30d, active wallets,
 * reversiones, valor estimado, shadow status), no la agregación por
 * regla/venue que ya cubre commandCenterLoyalty.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { systemSettings } from "../../../drizzle/schema";

const { mockGetLoyaltyEconomy, mockIsShadowEnabled } = vi.hoisted(() => ({
  mockGetLoyaltyEconomy: vi.fn(),
  mockIsShadowEnabled: vi.fn(),
}));
vi.mock("../dashboard/commandCenterLoyalty", () => ({ getLoyaltyEconomy: mockGetLoyaltyEconomy }));
vi.mock("./loyaltyShadowService", () => ({ isShadowEnabled: mockIsShadowEnabled }));

import { getEconomyOverviewExtras } from "./economyOverviewService";

function fakeDb(opts: {
  periodRow?: { today: number; d7: number; d30: number };
  activeWallets?: number;
  reversals?: number;
  tokenValueCents?: string | null;
}) {
  const period = opts.periodRow ?? { today: 0, d7: 0, d30: 0 };
  let executeCall = 0;
  const db = {
    execute: vi.fn(async () => {
      executeCall++;
      if (executeCall === 1) return [[period]];
      if (executeCall === 2) return [[{ n: opts.activeWallets ?? 0 }]];
      return [[{ n: opts.reversals ?? 0 }]];
    }),
    select: (_cols?: unknown) => ({
      from: (table: unknown) => ({
        where: (_cond?: unknown) => ({
          limit: async () => (table === systemSettings ? [{ value: opts.tokenValueCents ?? null }].filter(r => r.value !== null) : []),
        }),
      }),
    }),
  };
  return db as never;
}

describe("getEconomyOverviewExtras", () => {
  it("agrega issued today/7d/30d, active students, reversiones y shadow status", async () => {
    mockGetLoyaltyEconomy.mockResolvedValue({
      liveStatus: "LIVE_LOCKED", earnedInPeriod: 100, spentInPeriod: 0, circulatingBalance: 500, activeWallets: 4, avgBalance: 125,
      topEarningRules: [{ ruleId: 1, ruleName: "Asistencia a evento", totalEarned: 80 }],
      tokensByVenue: [{ venueId: 1, venueName: "Casanova", earned: 60, spent: 0 }, { venueId: 4, venueName: "Tía Felisa", earned: 40, spent: 0 }],
      tokensByEvent: [],
    });
    mockIsShadowEnabled.mockResolvedValue(true);
    const db = fakeDb({ periodRow: { today: 15, d7: 45, d30: 100 }, activeWallets: 3, reversals: 1, tokenValueCents: "2" });

    const result = await getEconomyOverviewExtras(db);

    expect(result.issuedToday).toBe(15);
    expect(result.issued7d).toBe(45);
    expect(result.issued30d).toBe(100);
    expect(result.activeStudentsWithTokens).toBe(3);
    expect(result.reversalsCount).toBe(1);
    expect(result.shadowEnabled).toBe(true);
    expect(result.estimatedTokenValueCents).toBe(2);
    expect(result.topEarningRule).toEqual({ ruleId: 1, ruleName: "Asistencia a evento", totalEarned: 80 });
  });

  it("top venue es el de MAYOR earned, no el primero de la lista sin ordenar", async () => {
    mockGetLoyaltyEconomy.mockResolvedValue({
      liveStatus: "LIVE_LOCKED", earnedInPeriod: 0, spentInPeriod: 0, circulatingBalance: 0, activeWallets: 0, avgBalance: null,
      topEarningRules: [],
      tokensByVenue: [{ venueId: 1, venueName: "Casanova", earned: 20, spent: 0 }, { venueId: 7, venueName: "Limoncello", earned: 90, spent: 0 }],
      tokensByEvent: [],
    });
    mockIsShadowEnabled.mockResolvedValue(false);
    const db = fakeDb({});

    const result = await getEconomyOverviewExtras(db);

    expect(result.topVenue).toEqual({ venueId: 7, venueName: "Limoncello", earned: 90 });
  });

  it("sin ningún setting de valor de token -> usa el default (2 céntimos), nunca lanza", async () => {
    mockGetLoyaltyEconomy.mockResolvedValue({
      liveStatus: "LIVE_LOCKED", earnedInPeriod: 0, spentInPeriod: 0, circulatingBalance: 0, activeWallets: 0, avgBalance: null,
      topEarningRules: [], tokensByVenue: [], tokensByEvent: [],
    });
    mockIsShadowEnabled.mockResolvedValue(false);
    const db = fakeDb({ tokenValueCents: null });

    const result = await getEconomyOverviewExtras(db);

    expect(result.estimatedTokenValueCents).toBe(2);
    expect(result.topEarningRule).toBeNull();
    expect(result.topVenue).toBeNull();
  });
});
