/**
 * commandCenterCommerce.test.ts — SEGOLIFE ADMIN AI/BI/COMMAND CENTER
 * (Fase 12, spec §15/§16/§69). POS product performance y payment mix.
 */
import { describe, it, expect, vi } from "vitest";
import { getPosProductPerformance, getPaymentMix } from "./commandCenterCommerce";
import type { DashboardFilterContext } from "./dashboardFilters";

function fakeExecuteDb(queue: unknown[][]) {
  const execute = vi.fn();
  for (const rows of queue) execute.mockResolvedValueOnce([rows, []]);
  return { execute };
}

const CTX: DashboardFilterContext = { communityId: null, from: new Date("2026-07-15T00:00:00.000Z"), to: new Date("2026-08-14T12:00:00.000Z"), rangeLabel: "30d" };

describe("getPosProductPerformance", () => {
  it("mapea unidades vendidas y ventas brutas por producto, ordenado por unidades", async () => {
    const db = fakeExecuteDb([
      [
        { venue_product_id: 1, product_name: "Gin Tonic", venue_id: 10, venue_name: "Tía Felisa", units_sold: 120, gross_sales_cents: 96000 },
        { venue_product_id: 2, product_name: "Cerveza", venue_id: 10, venue_name: "Tía Felisa", units_sold: 80, gross_sales_cents: 32000 },
      ],
    ]);
    const rows = await getPosProductPerformance(CTX, db as never);
    expect(rows).toEqual([
      { venueProductId: 1, productName: "Gin Tonic", venueId: 10, venueName: "Tía Felisa", unitsSold: 120, grossSalesCents: 96000 },
      { venueProductId: 2, productName: "Cerveza", venueId: 10, venueName: "Tía Felisa", unitsSold: 80, grossSalesCents: 32000 },
    ]);
  });

  it("sin ventas en el periodo -> lista vacía honesta, nunca lanza", async () => {
    const db = fakeExecuteDb([[]]);
    const rows = await getPosProductPerformance(CTX, db as never);
    expect(rows).toEqual([]);
  });
});

describe("getPaymentMix", () => {
  it("desglosa por método de pago SIN colapsar cash/card/mixed_cash/mixed_card/segotokens", async () => {
    const db = fakeExecuteDb([
      [
        { payment_method: "cash", n: 10, gross: 20000 },
        { payment_method: "mixed_card", n: 3, gross: 6000 },
        { payment_method: "segotokens", n: 2, gross: 1000 },
      ],
      [{ n: 1500 }],
    ]);
    const snapshot = await getPaymentMix(CTX, db as never);
    expect(snapshot.rows).toEqual([
      { paymentMethod: "cash", transactionCount: 10, grossSalesCents: 20000 },
      { paymentMethod: "mixed_card", transactionCount: 3, grossSalesCents: 6000 },
      { paymentMethod: "segotokens", transactionCount: 2, grossSalesCents: 1000 },
    ]);
  });

  it("segoTokensPromotionalValueCents se reporta APARTE, nunca sumado a grossSalesCents de ninguna fila (spec §16, nunca 'revenue')", async () => {
    const db = fakeExecuteDb([
      [{ payment_method: "segotokens", n: 2, gross: 1000 }],
      [{ n: 1500 }],
    ]);
    const snapshot = await getPaymentMix(CTX, db as never);
    expect(snapshot.segoTokensPromotionalValueCents).toBe(1500);
    // El "gross" de la fila segotokens es el total_cents BRUTO de la venta (nunca mutado, spec §10 Fase 10.7), distinto del valor promocional aparte.
    expect(snapshot.rows.find(r => r.paymentMethod === "segotokens")?.grossSalesCents).toBe(1000);
  });

  it("sin transacciones en el periodo -> rows vacío y valor promocional 0, nunca lanza", async () => {
    const db = fakeExecuteDb([[], []]);
    const snapshot = await getPaymentMix(CTX, db as never);
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.segoTokensPromotionalValueCents).toBe(0);
  });
});
