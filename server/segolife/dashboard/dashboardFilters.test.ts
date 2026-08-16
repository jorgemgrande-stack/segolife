/**
 * dashboardFilters.test.ts — puro, sin BD. Rango de tiempo y resolución de
 * contexto de filtro (spec §5, §33).
 */
import { describe, it, expect } from "vitest";
import { resolveTimeRange, resolveDashboardFilterContext } from "./dashboardFilters";

describe("resolveTimeRange", () => {
  // SEGOLIFE ADMIN AI/BI/COMMAND CENTER (Fase 12, spec §4, CRÍTICO): "Hoy"
  // usa el mismo corte nightlife de 06:00 Europe/Madrid que
  // resolveOperationalDate (tokenScheduleService.ts, Fase 6) — nunca
  // medianoche de calendario. Antes de esta fase, este test comprobaba el
  // comportamiento INCORRECTO (medianoche UTC del servidor); se actualiza
  // aquí porque el fix es intencional, no una regresión.
  it("today — por la tarde: el corte es 06:00 Madrid DE HOY (agosto = CEST, +2h → 04:00 UTC)", () => {
    const now = new Date("2026-08-14T15:30:00.000Z"); // 17:30 Madrid (CEST)
    const { from, to } = resolveTimeRange("today", now);
    expect(to).toEqual(now);
    expect(from.toISOString()).toBe("2026-08-14T04:00:00.000Z");
  });

  it("today — de madrugada (antes del corte): pertenece operativamente a la noche ANTERIOR, nunca al día de calendario que acaba de empezar", () => {
    const now = new Date("2026-08-15T01:00:00.000Z"); // 03:00 Madrid (CEST) del 15 — antes del corte de las 06:00
    const { from, to } = resolveTimeRange("today", now);
    expect(to).toEqual(now);
    // El "hoy operativo" sigue siendo el 14, no el 15 — el corte de las
    // 06:00 Madrid del día 14 (04:00 UTC), no medianoche del 15.
    expect(from.toISOString()).toBe("2026-08-14T04:00:00.000Z");
  });

  it("today — en invierno (CET, +1h) el corte de las 06:00 Madrid es 05:00 UTC, distinto del verano", () => {
    const now = new Date("2026-01-14T15:30:00.000Z"); // 16:30 Madrid (CET)
    const { from } = resolveTimeRange("today", now);
    expect(from.toISOString()).toBe("2026-01-14T05:00:00.000Z");
  });

  it("7d — exactamente 7 días atrás", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    const { from } = resolveTimeRange("7d", now);
    expect(now.getTime() - from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("30d — exactamente 30 días atrás", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    const { from } = resolveTimeRange("30d", now);
    expect(now.getTime() - from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("course — en agosto (mes 7, 0-indexed) usa el 1 de septiembre DE ESTE año como inicio", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    const { from } = resolveTimeRange("course", now);
    expect(from.getFullYear()).toBe(2026);
    expect(from.getMonth()).toBe(8); // septiembre
    expect(from.getDate()).toBe(1);
  });

  it("course — en marzo usa el 1 de septiembre DEL AÑO ANTERIOR (el curso ya empezó antes)", () => {
    const now = new Date("2026-03-01T12:00:00.000Z");
    const { from } = resolveTimeRange("course", now);
    expect(from.getFullYear()).toBe(2025);
    expect(from.getMonth()).toBe(8);
  });
});

describe("resolveDashboardFilterContext", () => {
  it("sin communityId → null (\"Todas\"), nunca 0 ni undefined silencioso", () => {
    const ctx = resolveDashboardFilterContext({}, new Date("2026-08-14"));
    expect(ctx.communityId).toBeNull();
    expect(ctx.rangeLabel).toBe("30d"); // default
  });

  it("con communityId explícito, se preserva", () => {
    const ctx = resolveDashboardFilterContext({ communityId: 3, range: "7d" }, new Date("2026-08-14"));
    expect(ctx.communityId).toBe(3);
    expect(ctx.rangeLabel).toBe("7d");
  });

  it("from/to válidos → custom, ignora range", () => {
    const ctx = resolveDashboardFilterContext({ range: "today", from: "2026-01-01", to: "2026-02-01" }, new Date("2026-08-14"));
    expect(ctx.rangeLabel).toBe("custom");
    expect(ctx.from.getFullYear()).toBe(2026);
    expect(ctx.from.getMonth()).toBe(0);
  });

  it("from/to inválidos (from >= to) → cae de vuelta al range normal, nunca lanza", () => {
    const ctx = resolveDashboardFilterContext({ range: "7d", from: "2026-02-01", to: "2026-01-01" }, new Date("2026-08-14"));
    expect(ctx.rangeLabel).toBe("7d");
  });

  it("from/to con fechas no parseables → cae de vuelta al range normal, nunca lanza", () => {
    const ctx = resolveDashboardFilterContext({ range: "today", from: "no-es-fecha", to: "tampoco" }, new Date("2026-08-14"));
    expect(ctx.rangeLabel).toBe("today");
  });
});
