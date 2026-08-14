/**
 * commandCenterVenues.test.ts — Venue Performance: rollup dinámico (la lista
 * de venues sale SIEMPRE de la tabla `venues`, nunca hardcodeada), revenue
 * siempre desglosado Ticket/Commerce/Total (spec §1.4/§14).
 */
import { describe, it, expect, vi } from "vitest";
import { getVenuePerformance } from "./commandCenterVenues";
import type { DashboardFilterContext } from "./dashboardFilters";

vi.mock("./activitySignals", () => ({
  activeStudentsByVenue: vi.fn(async () => new Map([[10, 5], [11, 2]])),
}));
vi.mock("../students/historicalIdentityService", () => ({
  getHistoricalIdentityStatsByVenue: vi.fn(async () => [
    { venueId: 10, total: 8, crossVenue: 3 },
    { venueId: 11, total: 2, crossVenue: 0 },
  ]),
}));

function fakeExecuteDb(queue: unknown[][]) {
  const execute = vi.fn();
  for (const rows of queue) execute.mockResolvedValueOnce([rows, []]);
  return { execute };
}

const NOW = new Date("2026-08-14T12:00:00.000Z");
const CTX: DashboardFilterContext = { communityId: null, from: new Date("2026-07-15T00:00:00.000Z"), to: NOW, rangeLabel: "30d" };

describe("getVenuePerformance", () => {
  it("la lista de venues sale de la tabla venues (dinámica) — nunca hardcodeada", async () => {
    const db = fakeExecuteDb([
      [{ venue_id: 10, venue_name: "Casanova" }, { venue_id: 11, venue_name: "Tía Felisa" }], // venues
      [{ venue_id: 10, tickets_sold: 40, revenue_cents: 100000 }], // tickets
      [{ venue_id: 10, n: 12 }], // attendance
      [{ venue_id: 11, revenue_cents: 5000 }], // commerce (POS)
      [], // consumo QR
      [{ venue_id: 10, earned: 200, spent: 50 }], // tokens
      [{ venue_id: 10, generated: 6, redeemed: 2 }], // benefits
      [{ venue_id: 10, last24h: 2000, prior24h: 1000 }], // trend
    ]);
    const snapshot = await getVenuePerformance(CTX, db as never, NOW);
    expect(snapshot.rows.map(r => r.venueName)).toEqual(["Casanova", "Tía Felisa"]);
  });

  it("Revenue SIEMPRE desglosado: totalEcosystemRevenueCents = ticket + commerce, nunca fusionado sin desglose", async () => {
    const db = fakeExecuteDb([
      [{ venue_id: 10, venue_name: "Casanova" }],
      [{ venue_id: 10, tickets_sold: 40, revenue_cents: 100000 }],
      [],
      [{ venue_id: 10, revenue_cents: 30000 }],
      [], [], [], [],
    ]);
    const snapshot = await getVenuePerformance(CTX, db as never, NOW);
    const row = snapshot.rows[0];
    expect(row.ticketRevenueCents).toBe(100000);
    expect(row.commerceRevenueCents).toBe(30000);
    expect(row.totalEcosystemRevenueCents).toBe(130000);
  });

  it("un venue sin ningún dato en el periodo muestra ceros honestos, nunca null/undefined que rompa el render", async () => {
    const db = fakeExecuteDb([
      [{ venue_id: 99, venue_name: "Venue Nuevo Sin Actividad" }],
      [], [], [], [], [], [], [],
    ]);
    const snapshot = await getVenuePerformance(CTX, db as never, NOW);
    expect(snapshot.rows[0]).toMatchObject({
      activeStudents: 0, historicalIdentities: 0, ticketsSold: 0, attendanceCount: 0,
      ticketRevenueCents: 0, commerceRevenueCents: 0, totalEcosystemRevenueCents: 0,
      segoTokensEarned: 0, segoTokensSpent: 0, benefitsGenerated: 0, benefitsRedeemed: 0,
    });
  });

  it("sin venues en la comunidad filtrada → rows vacío, sin más queries", async () => {
    const db = fakeExecuteDb([[]]);
    const snapshot = await getVenuePerformance(CTX, db as never, NOW);
    expect(snapshot.rows).toEqual([]);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("trend 'up' cuando last24h supera claramente a prior24h; 'flat' cuando ambos son 0", async () => {
    const db = fakeExecuteDb([
      [{ venue_id: 10, venue_name: "Casanova" }, { venue_id: 11, venue_name: "Tía Felisa" }],
      [], [], [], [], [], [],
      [{ venue_id: 10, last24h: 4000, prior24h: 1000 }],
    ]);
    const snapshot = await getVenuePerformance(CTX, db as never, NOW);
    const casanova = snapshot.rows.find(r => r.venueId === 10);
    const tiaFelisa = snapshot.rows.find(r => r.venueId === 11);
    expect(casanova?.trend.direction).toBe("up");
    expect(tiaFelisa?.trend.direction).toBe("flat");
  });

  // ─── Consumo vía QR (SEGOLIFE — Venue Commerce, Consumption QR &
  // SegoTokens): redeemConsumptionQr() nunca crea una fila en
  // commerce_transactions — sin esta segunda fuente, commerceRevenueCents
  // solo vería ventas de /staff/pos. ─────────────────────────────────────

  it("commerceRevenueCents suma POS (commerce_transactions) + consumo QR (consumption_qr_codes) del mismo venue", async () => {
    const db = fakeExecuteDb([
      [{ venue_id: 10, venue_name: "Casanova" }],
      [], [],
      [{ venue_id: 10, revenue_cents: 30000 }], // commerce (POS)
      [{ venue_id: 10, revenue_cents: 12000 }], // consumo QR
      [], [], [],
    ]);
    const snapshot = await getVenuePerformance(CTX, db as never, NOW);
    expect(snapshot.rows[0].commerceRevenueCents).toBe(42000);
  });

  it("un venue con SOLO consumo vía QR (0 ventas de POS) igualmente cuenta como commerce revenue", async () => {
    const db = fakeExecuteDb([
      [{ venue_id: 10, venue_name: "Casanova" }],
      [], [],
      [], // commerce (POS) — sin filas
      [{ venue_id: 10, revenue_cents: 8000 }], // consumo QR
      [], [], [],
    ]);
    const snapshot = await getVenuePerformance(CTX, db as never, NOW);
    expect(snapshot.rows[0].commerceRevenueCents).toBe(8000);
    expect(snapshot.rows[0].totalEcosystemRevenueCents).toBe(8000);
  });
});
