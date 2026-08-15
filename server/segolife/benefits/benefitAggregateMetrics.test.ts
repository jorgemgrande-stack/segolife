/**
 * benefitAggregateMetrics.test.ts — SEGOLIFE BEHAVIORAL BENEFITS RULE
 * ENGINE (Fase 6, spec §7/§8/§41 tests #10-12). Solo `aggregateWindowStart`
 * es pura (sin BD) — las funciones de conteo se ejercitan indirectamente a
 * través de benefitRuleEngine.test.ts (mock de evaluateAggregateMetric) y
 * en producción; replicar aquí el mismo mock de tabla que
 * makeRuleEngineMockDb para 4 tablas distintas no aporta cobertura nueva
 * sobre lo que ya prueba esa suite.
 */
import { describe, it, expect } from "vitest";
import { aggregateWindowStart } from "./benefitAggregateMetrics";

describe("aggregateWindowStart('day') — corte operativo 06:00 Europe/Madrid, NUNCA aproximación de 24h rodantes", () => {
  it("un trigger a las 00:45 (noche del viernes) devuelve el inicio del día operativo del VIERNES (06:00), no 24h atrás", () => {
    // 2026-06-13T00:45 Madrid (CEST) = 2026-06-12T22:45:00Z. Día operativo = viernes 12.
    const at = new Date("2026-06-12T22:45:00Z");
    const start = aggregateWindowStart("day", at);
    // Viernes 2026-06-12 06:00 Madrid (CEST +2) = 2026-06-12T04:00:00Z.
    expect(start.toISOString()).toBe("2026-06-12T04:00:00.000Z");
  });

  it("dos noches operativas distintas separadas por menos de 24h de reloj NUNCA comparten ventana (la aproximación de 24h rodantes las habría colapsado)", () => {
    // Visita 1: viernes 23:00. Visita 2: sábado 22:00 (23h de diferencia de
    // reloj, pero DOS noches operativas distintas — viernes y sábado).
    const visit1 = new Date("2026-06-12T21:00:00Z"); // viernes 23:00 Madrid
    const visit2 = new Date("2026-06-13T20:00:00Z"); // sábado 22:00 Madrid
    const windowForVisit2 = aggregateWindowStart("day", visit2);
    // El inicio de la ventana de la visita 2 (sábado 06:00) es POSTERIOR al
    // instante de la visita 1 (viernes 23:00) — visita 1 queda FUERA de la
    // ventana "day" de visita 2, tal y como debe ser.
    expect(windowForVisit2.getTime()).toBeGreaterThan(visit1.getTime());
  });

  it("un trigger a mediodía (fuera de horario nocturno) usa las 06:00 del mismo día de calendario", () => {
    const at = new Date("2026-06-12T10:00:00Z"); // mediodía Madrid (CEST)
    const start = aggregateWindowStart("day", at);
    expect(start.toISOString()).toBe("2026-06-12T04:00:00.000Z"); // 06:00 CEST mismo día
  });

  it("justo en el corte (06:00:00 Madrid) el día operativo ya es el que empieza, no el anterior", () => {
    const at = new Date("2026-06-12T04:00:00Z"); // exactamente 06:00 Madrid (CEST)
    const start = aggregateWindowStart("day", at);
    expect(start.toISOString()).toBe("2026-06-12T04:00:00.000Z");
  });
});

describe("aggregateWindowStart('week'/'month') — mismo criterio simple que el motor legacy, sin corte nocturno", () => {
  it("'week' ancla al lunes 00:00 de calendario", () => {
    const at = new Date("2026-06-12T21:00:00Z"); // viernes
    const start = aggregateWindowStart("week", at);
    expect(start.getDay()).toBe(1); // lunes
    expect(start.getHours()).toBe(0);
  });

  it("'month' ancla al día 1 00:00 de calendario", () => {
    const at = new Date("2026-06-12T21:00:00Z");
    const start = aggregateWindowStart("month", at);
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
  });
});
