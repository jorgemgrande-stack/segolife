/**
 * commandCenterLoyalty.test.ts — SegoTokens Economy (READ-ONLY, liveStatus
 * refleja tokenEngine.ts:LIVE_LOYALTY_ENABLED, nunca "tokens expirando") y
 * Benefits Performance (expiración perezosa, expiringWithin48h, ranking de
 * más canjeados).
 */
import { describe, it, expect, vi } from "vitest";
import { getLoyaltyEconomy, getBenefitsPerformance, getCrossVenueBenefitFlow } from "./commandCenterLoyalty";
import type { DashboardFilterContext } from "./dashboardFilters";
import { LIVE_LOYALTY_ENABLED } from "../tokens/tokenEngine";

function fakeExecuteDb(queue: unknown[][]) {
  const execute = vi.fn();
  for (const rows of queue) execute.mockResolvedValueOnce([rows, []]);
  return { execute };
}

const NOW = new Date("2026-08-14T12:00:00.000Z");
const CTX: DashboardFilterContext = { communityId: null, from: new Date("2026-07-15T00:00:00.000Z"), to: NOW, rangeLabel: "30d" };

describe("getLoyaltyEconomy", () => {
  it("liveStatus refleja tokenEngine.ts:LIVE_LOYALTY_ENABLED (SegoTokens Live Activation)", async () => {
    const db = fakeExecuteDb([
      [{ earned: 500, spent: 200 }],
      [{ active_wallets: 30, circulating: 4000, avg_balance: 133.3 }],
      [], [], [], [],
    ]);
    const snapshot = await getLoyaltyEconomy(CTX, db as never);
    expect(snapshot.liveStatus).toBe(LIVE_LOYALTY_ENABLED ? "LIVE_ACTIVE" : "LIVE_LOCKED");
    expect(snapshot.earnedInPeriod).toBe(500);
    expect(snapshot.spentInPeriod).toBe(200);
    expect(snapshot.circulatingBalance).toBe(4000);
    expect(snapshot.activeWallets).toBe(30);
  });

  it("nunca expone ningún campo relacionado con 'expiración' de tokens (spec §19 — no existe expires_at)", async () => {
    const db = fakeExecuteDb([
      [{ earned: 10, spent: 0 }],
      [{ active_wallets: 1, circulating: 10, avg_balance: 10 }],
      [], [], [], [],
    ]);
    const snapshot = await getLoyaltyEconomy(CTX, db as never);
    const keys = Object.keys(snapshot).join(",").toLowerCase();
    expect(keys).not.toContain("expir");
  });

  it("sin wallets activas → avgBalance null, nunca división por cero", async () => {
    const db = fakeExecuteDb([
      [{ earned: 0, spent: 0 }],
      [{ active_wallets: 0, circulating: 0, avg_balance: 0 }],
      [], [], [], [],
    ]);
    const snapshot = await getLoyaltyEconomy(CTX, db as never);
    expect(snapshot.avgBalance).toBeNull();
    expect(snapshot.activeWallets).toBe(0);
  });

  it("topEarningRules / tokensByVenue / tokensByEvent se mapean correctamente", async () => {
    const db = fakeExecuteDb([
      [{ earned: 100, spent: 20 }],
      [{ active_wallets: 5, circulating: 500, avg_balance: 100 }],
      [{ rule_id: 3, rule_name: "Asistencia a evento", total: 80 }, { rule_id: null, rule_name: "Sin regla asociada (manual)", total: 20 }],
      [{ venue_id: 10, venue_name: "Casanova", earned: 60, spent: 10 }],
      [{ event_id: 55, event_name: "After Party", earned: 40, spent: 5 }],
      [],
    ]);
    const snapshot = await getLoyaltyEconomy(CTX, db as never);
    expect(snapshot.topEarningRules).toEqual([
      { ruleId: 3, ruleName: "Asistencia a evento", totalEarned: 80 },
      { ruleId: null, ruleName: "Sin regla asociada (manual)", totalEarned: 20 },
    ]);
    expect(snapshot.tokensByVenue).toEqual([{ venueId: 10, venueName: "Casanova", earned: 60, spent: 10 }]);
    expect(snapshot.tokensByEvent).toEqual([{ eventId: 55, eventName: "After Party", earned: 40, spent: 5 }]);
  });

  // SEGOLIFE ADMIN AI/BI/COMMAND CENTER (Fase 12, spec §17/§22): "ST emitido
  // por origen" — histórico real de token_ledger.source_type, nunca la
  // config de reglas (economyGovernanceService solo etiqueta orígenes).
  it("tokensByOrigin se mapea desde GROUP BY token_ledger.source_type, incluye orígenes de Comunity (spec §22)", async () => {
    const db = fakeExecuteDb([
      [{ earned: 100, spent: 20 }],
      [{ active_wallets: 5, circulating: 500, avg_balance: 100 }],
      [], [], [],
      [
        { origin: "ticket", earned: 500, spent: 0 },
        { origin: "consumption", earned: 300, spent: 0 },
        { origin: "community_response", earned: 50, spent: 0 },
        { origin: null, earned: 0, spent: 10 },
      ],
    ]);
    const snapshot = await getLoyaltyEconomy(CTX, db as never);
    expect(snapshot.tokensByOrigin).toEqual([
      { origin: "ticket", earned: 500, spent: 0 },
      { origin: "consumption", earned: 300, spent: 0 },
      { origin: "community_response", earned: 50, spent: 0 },
      { origin: "desconocido", earned: 0, spent: 10 },
    ]);
  });
});

describe("getCrossVenueBenefitFlow (spec §20/§70 — flujo cruzado entre venues)", () => {
  it("mapea venue origen → venue destino con tasa de canje, solo pares con AMBOS venues reales y distintos", async () => {
    const db = fakeExecuteDb([
      [
        { source_venue_id: 10, source_venue_name: "Casanova", destination_venue_id: 20, destination_venue_name: "Tía Felisa", granted: 100, redeemed: 38 },
      ],
    ]);
    const flow = await getCrossVenueBenefitFlow(CTX, db as never);
    expect(flow).toEqual([
      { sourceVenueId: 10, sourceVenueName: "Casanova", destinationVenueId: 20, destinationVenueName: "Tía Felisa", granted: 100, redeemed: 38, redemptionRatePct: 38 },
    ]);
  });

  it("granted=0 (sin filas) → lista vacía honesta, nunca lanza", async () => {
    const db = fakeExecuteDb([[]]);
    const flow = await getCrossVenueBenefitFlow(CTX, db as never);
    expect(flow).toEqual([]);
  });
});

describe("getBenefitsPerformance", () => {
  it("expiración perezosa: expired incluye status='active' con validUntil vencido (mismo criterio que overview)", async () => {
    const db = fakeExecuteDb([
      [{ generated: 10, available: 4, redeemed: 3, expired: 3 }],
      [{ n: 1 }],
      [],
    ]);
    const snapshot = await getBenefitsPerformance(CTX, db as never, NOW);
    expect(snapshot.generated).toBe(10);
    expect(snapshot.expired).toBe(3);
    expect(snapshot.redemptionRatePct).toBe(30);
    expect(snapshot.expiringWithin48h).toBe(1);
  });

  it("generated=0 → redemptionRatePct null, nunca división por cero", async () => {
    const db = fakeExecuteDb([
      [{ generated: 0, available: 0, redeemed: 0, expired: 0 }],
      [{ n: 0 }],
      [],
    ]);
    const snapshot = await getBenefitsPerformance(CTX, db as never, NOW);
    expect(snapshot.redemptionRatePct).toBeNull();
  });

  it("mostRedeemed se mapea correctamente desde el JOIN con benefit_definitions", async () => {
    const db = fakeExecuteDb([
      [{ generated: 20, available: 5, redeemed: 12, expired: 3 }],
      [{ n: 2 }],
      [{ benefit_definition_id: 7, benefit_name: "Entrada gratis After Party", redeemed_count: 9 }],
    ]);
    const snapshot = await getBenefitsPerformance(CTX, db as never, NOW);
    expect(snapshot.mostRedeemed).toEqual([{ benefitDefinitionId: 7, benefitName: "Entrada gratis After Party", redeemedCount: 9 }]);
  });

  it("sin ningún Benefit en el periodo → estado vacío honesto, nunca lanza", async () => {
    const db = fakeExecuteDb([[], [], []]);
    const snapshot = await getBenefitsPerformance(CTX, db as never, NOW);
    expect(snapshot.generated).toBe(0);
    expect(snapshot.mostRedeemed).toEqual([]);
    expect(snapshot.redemptionRatePct).toBeNull();
  });
});
