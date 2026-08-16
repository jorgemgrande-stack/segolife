/**
 * commandCenterComparison.test.ts — Fase 14, spec §19/§27 (comparison
 * calculations, empty datasets, zero values).
 */
import { describe, it, expect } from "vitest";
import { previousPeriodContext, comparePeriods } from "./commandCenterComparison";
import type { DashboardFilterContext } from "./dashboardFilters";

describe("previousPeriodContext", () => {
  it("el periodo anterior tiene EXACTAMENTE la misma duración que el actual, terminando donde empieza el actual", () => {
    const ctx: DashboardFilterContext = {
      communityId: null,
      from: new Date("2026-08-08T00:00:00.000Z"),
      to: new Date("2026-08-15T00:00:00.000Z"),
      rangeLabel: "7d",
    };
    const prev = previousPeriodContext(ctx);
    expect(prev.to.toISOString()).toBe(ctx.from.toISOString());
    expect(prev.to.getTime() - prev.from.getTime()).toBe(ctx.to.getTime() - ctx.from.getTime());
    expect(prev.from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("preserva communityId y rangeLabel — nunca cambia la comunidad al comparar (spec §19)", () => {
    const ctx: DashboardFilterContext = { communityId: 3, from: new Date("2026-08-14T06:00:00Z"), to: new Date("2026-08-15T06:00:00Z"), rangeLabel: "today" };
    const prev = previousPeriodContext(ctx);
    expect(prev.communityId).toBe(3);
    expect(prev.rangeLabel).toBe("today");
  });

  it("funciona para un rango 'hoy' de duración nocturna (24h) — compara con la noche operativa anterior, no un día de calendario aleatorio (spec §19 ejemplo)", () => {
    const ctx: DashboardFilterContext = { communityId: null, from: new Date("2026-08-14T04:00:00Z"), to: new Date("2026-08-15T04:00:00Z"), rangeLabel: "today" };
    const prev = previousPeriodContext(ctx);
    expect(prev.from.toISOString()).toBe("2026-08-13T04:00:00.000Z");
    expect(prev.to.toISOString()).toBe("2026-08-14T04:00:00.000Z");
  });
});

describe("comparePeriods", () => {
  it("calcula delta absoluto y porcentual correctamente en el caso normal", () => {
    const r = comparePeriods(124, 100);
    expect(r.deltaAbs).toBe(24);
    expect(r.deltaPct).toBe(24);
    expect(r.direction).toBe("up");
  });

  it("detecta bajada", () => {
    const r = comparePeriods(80, 100);
    expect(r.deltaAbs).toBe(-20);
    expect(r.deltaPct).toBe(-20);
    expect(r.direction).toBe("down");
  });

  it("current === previous -> flat, deltaPct 0", () => {
    const r = comparePeriods(50, 50);
    expect(r.direction).toBe("flat");
    expect(r.deltaPct).toBe(0);
    expect(r.deltaAbs).toBe(0);
  });

  it("previous=0, current=0 -> deltaPct null, nunca NaN/Infinity (spec §19/§27 zero values)", () => {
    const r = comparePeriods(0, 0);
    expect(r.deltaPct).toBeNull();
    expect(r.deltaAbs).toBe(0);
    expect(r.direction).toBe("flat");
  });

  it("previous=0, current>0 -> deltaPct null (nunca 'Infinity%'), deltaAbs real", () => {
    const r = comparePeriods(30, 0);
    expect(r.deltaPct).toBeNull();
    expect(r.deltaAbs).toBe(30);
    expect(r.direction).toBe("up");
  });

  it("redondea deltaPct a 1 decimal", () => {
    const r = comparePeriods(103, 90);
    expect(r.deltaPct).toBeCloseTo(14.4, 1);
  });
});
