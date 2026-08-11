import { describe, it, expect } from "vitest";
import { computeSegoScore, computeSegment, computeAlerts, type StudentIntelligenceInput } from "./studentIntelligenceService";
import type { TimelineEventDTO } from "../../../shared/segolife/student360";

const NOW = new Date("2026-08-12T12:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

function ev(overrides: Partial<TimelineEventDTO>): TimelineEventDTO {
  return {
    id: "x:1",
    occurredAt: daysAgo(1),
    type: "event_attendance",
    title: "t",
    description: null,
    source: "event_attendance",
    amountCents: null,
    tokens: null,
    venueName: null,
    eventName: null,
    metadata: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<StudentIntelligenceInput> = {}): StudentIntelligenceInput {
  return {
    registeredAt: new Date(daysAgo(90)),
    profileCompleted: true,
    activitySnapshot: [],
    eventsPurchasedCount: 0,
    eventsAttendedCount: 0,
    totalSpendCents: 0,
    tokensBalance: 0,
    tokensLifetimeEarned: 0,
    benefitsUsedCount: 0,
    benefitsAvailableCount: 0,
    hasBenefitExpiringSoon: false,
    nextEventStartsAt: null,
    unreadNotifications: 0,
    notificationInteractionCount: 0,
    now: NOW,
    ...overrides,
  };
}

describe("computeSegoScore", () => {
  it("estudiante recién registrado (<14 días): insufficientData=true, ninguna dimensión disponible, nunca penaliza", () => {
    const input = baseInput({ registeredAt: new Date(daysAgo(3)) });
    const result = computeSegoScore(input);
    expect(result.insufficientData).toBe(true);
    expect(result.score).toBeNull();
    expect(result.dimensions.every(d => !d.available)).toBe(true);
  });

  it("estudiante establecido sin ninguna actividad: recency no disponible, resto sí, score se calcula (no fabrica dato de recency)", () => {
    const input = baseInput({ registeredAt: new Date(daysAgo(90)) });
    const result = computeSegoScore(input);
    expect(result.insufficientData).toBe(false);
    expect(result.score).not.toBeNull();
    const recency = result.dimensions.find(d => d.key === "recency")!;
    expect(recency.available).toBe(false);
    expect(recency.reason).toContain("Sin actividad");
  });

  it("recency: actividad hoy = 100, actividad hace 60+ días = 0", () => {
    const recent = computeSegoScore(baseInput({ activitySnapshot: [ev({ occurredAt: daysAgo(0), type: "event_attendance" })] }));
    const old = computeSegoScore(baseInput({ activitySnapshot: [ev({ occurredAt: daysAgo(90), type: "event_attendance" })] }));
    const recentDim = recent.dimensions.find(d => d.key === "recency")!;
    const oldDim = old.dimensions.find(d => d.key === "recency")!;
    expect(recentDim.normalizedScore).toBe(100);
    expect(oldDim.normalizedScore).toBe(0);
  });

  it("cada dimensión disponible cita su fuente (sourceLabel no vacío)", () => {
    const result = computeSegoScore(baseInput({ activitySnapshot: [ev({ occurredAt: daysAgo(1) })] }));
    for (const d of result.dimensions) {
      expect(d.sourceLabel).toBeTruthy();
    }
  });

  it("score final es un entero 0-100 cuando hay datos suficientes", () => {
    const result = computeSegoScore(baseInput({
      activitySnapshot: [ev({ occurredAt: daysAgo(1) })],
      eventsPurchasedCount: 3,
      totalSpendCents: 5000,
      tokensLifetimeEarned: 20,
    }));
    expect(result.score).not.toBeNull();
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score!).toBeGreaterThanOrEqual(0);
    expect(result.score!).toBeLessThanOrEqual(100);
  });
});

describe("computeSegment", () => {
  it("nuevo: registrado hace menos de 14 días, sea cual sea su actividad", () => {
    const segment = computeSegment(baseInput({ registeredAt: new Date(daysAgo(2)) }));
    expect(segment.key).toBe("nuevo");
  });

  it("dormido: establecido y sin actividad nunca registrada", () => {
    const segment = computeSegment(baseInput({ registeredAt: new Date(daysAgo(90)), activitySnapshot: [] }));
    expect(segment.key).toBe("dormido");
  });

  it("dormido: última actividad hace más de 60 días", () => {
    const segment = computeSegment(baseInput({
      registeredAt: new Date(daysAgo(200)),
      activitySnapshot: [ev({ occurredAt: daysAgo(70) })],
    }));
    expect(segment.key).toBe("dormido");
  });

  it("en_riesgo: última actividad entre 30 y 60 días", () => {
    const segment = computeSegment(baseInput({
      registeredAt: new Date(daysAgo(200)),
      activitySnapshot: [ev({ occurredAt: daysAgo(45) })],
    }));
    expect(segment.key).toBe("en_riesgo");
  });

  it("activo: actividad reciente (<=30 días) sin cumplir criterios de vip/muy_activo", () => {
    const segment = computeSegment(baseInput({
      registeredAt: new Date(daysAgo(200)),
      activitySnapshot: [ev({ occurredAt: daysAgo(5) })],
    }));
    expect(segment.key).toBe("activo");
  });

  it("vip: gasto acumulado alto con actividad reciente", () => {
    const segment = computeSegment(baseInput({
      registeredAt: new Date(daysAgo(200)),
      activitySnapshot: [ev({ occurredAt: daysAgo(5) })],
      totalSpendCents: 50000,
    }));
    expect(segment.key).toBe("vip");
  });

  it("todo segmento trae un motivo explicado (nunca oculto en JSX)", () => {
    const segment = computeSegment(baseInput());
    expect(segment.reason.length).toBeGreaterThan(0);
  });
});

describe("computeAlerts", () => {
  it("perfil incompleto genera alerta info", () => {
    const alerts = computeAlerts(baseInput({ profileCompleted: false }));
    expect(alerts.some(a => a.key === "incomplete_profile")).toBe(true);
  });

  it("sin actividad 60+ días (y ya establecido) genera alerta de inactividad", () => {
    const alerts = computeAlerts(baseInput({ registeredAt: new Date(daysAgo(200)), activitySnapshot: [] }));
    expect(alerts.some(a => a.key === "inactive_60d")).toBe(true);
  });

  it("estudiante recién registrado sin actividad NO genera alerta de inactividad (no penalizar)", () => {
    const alerts = computeAlerts(baseInput({ registeredAt: new Date(daysAgo(3)), activitySnapshot: [] }));
    expect(alerts.some(a => a.key === "inactive_60d")).toBe(false);
  });

  it("beneficio por vencer genera alerta", () => {
    const alerts = computeAlerts(baseInput({ hasBenefitExpiringSoon: true }));
    expect(alerts.some(a => a.key === "benefit_expiring_soon")).toBe(true);
  });

  it("evento en los próximos 3 días genera alerta", () => {
    const alerts = computeAlerts(baseInput({ nextEventStartsAt: new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString() }));
    expect(alerts.some(a => a.key === "upcoming_ticket")).toBe(true);
  });

  it("evento lejano NO genera alerta de próximo evento", () => {
    const alerts = computeAlerts(baseInput({ nextEventStartsAt: new Date(NOW.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString() }));
    expect(alerts.some(a => a.key === "upcoming_ticket")).toBe(false);
  });

  it("saldo de tokens muy alto genera alerta", () => {
    const alerts = computeAlerts(baseInput({ tokensBalance: 10000 }));
    expect(alerts.some(a => a.key === "high_token_balance")).toBe(true);
  });

  it("estudiante sin nada especial no genera ninguna alerta", () => {
    const alerts = computeAlerts(baseInput({ registeredAt: new Date(daysAgo(90)), activitySnapshot: [ev({ occurredAt: daysAgo(1) })] }));
    expect(alerts).toHaveLength(0);
  });
});
