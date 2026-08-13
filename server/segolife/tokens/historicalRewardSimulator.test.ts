/**
 * historicalRewardSimulator.test.ts — simulación pura de política (sin BD).
 * Fixtures sintéticos deliberadamente simples para poder calcular el
 * resultado esperado a mano y comprobar exactamente los triggers de
 * idempotencia (spec §33: nunca conceder dos veces compra/asistencia por el
 * mismo evento, ni first_action, ni cross_venue, ni el mismo hito).
 */
import { describe, it, expect } from "vitest";
import {
  POLICY_MODELS,
  simulatePolicyModel,
  computeModelStats,
  computeEconomicImpact,
  type SimulationIdentity,
  type PolicyModel,
} from "./historicalRewardSimulator";

function row(overrides: Partial<{ operationType: "order" | "attendance"; occurredAt: Date; eventId: number | null; venueId: number | null; amountCents: number | null }> = {}) {
  return {
    operationType: "order" as const,
    occurredAt: new Date("2026-01-01"),
    eventId: 1,
    venueId: 1,
    amountCents: 1000,
    ...overrides,
  };
}

describe("POLICY_MODELS", () => {
  it("define exactamente los 5 modelos A-E, cada uno con nombre y descripción", () => {
    expect(POLICY_MODELS.map(m => m.key)).toEqual(["A", "B", "C", "D", "E"]);
    for (const m of POLICY_MODELS) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
    }
  });
});

describe("simulatePolicyModel — idempotencia por trigger", () => {
  it("purchase: nunca premia dos veces el mismo identidad+evento aunque haya varias filas order", () => {
    const model: PolicyModel = { key: "B", name: "t", description: "t", purchaseTokens: 10, attendanceTokens: 0, firstActionBonus: 0, milestoneEvery: null, milestoneBonus: 0, crossVenueBonus: 0 };
    const identities: SimulationIdentity[] = [{
      identityKey: "email:a@x.com", isKnownStudent: false,
      rows: [row({ eventId: 1 }), row({ eventId: 1 }), row({ eventId: 1 })], // 3 tickets del mismo pedido/evento
    }];
    const events = simulatePolicyModel(model, identities);
    expect(events).toHaveLength(1);
    expect(events[0].tokens).toBe(10);
  });

  it("purchase: SÍ premia por separado eventos distintos de la misma identidad", () => {
    const model: PolicyModel = { key: "B", name: "t", description: "t", purchaseTokens: 10, attendanceTokens: 0, firstActionBonus: 0, milestoneEvery: null, milestoneBonus: 0, crossVenueBonus: 0 };
    const identities: SimulationIdentity[] = [{
      identityKey: "email:a@x.com", isKnownStudent: false,
      rows: [row({ eventId: 1 }), row({ eventId: 2 })],
    }];
    const events = simulatePolicyModel(model, identities);
    expect(events).toHaveLength(2);
  });

  it("attendance: nunca premia dos veces el mismo identidad+evento", () => {
    const model: PolicyModel = { key: "A", name: "t", description: "t", purchaseTokens: 0, attendanceTokens: 10, firstActionBonus: 0, milestoneEvery: null, milestoneBonus: 0, crossVenueBonus: 0 };
    const identities: SimulationIdentity[] = [{
      identityKey: "email:a@x.com", isKnownStudent: false,
      rows: [row({ operationType: "attendance", eventId: 1 }), row({ operationType: "attendance", eventId: 1 })],
    }];
    const events = simulatePolicyModel(model, identities);
    expect(events).toHaveLength(1);
  });

  it("first_action: solo dispara una vez, en la primera fila cronológica", () => {
    const model: PolicyModel = { key: "C", name: "t", description: "t", purchaseTokens: 0, attendanceTokens: 0, firstActionBonus: 15, milestoneEvery: null, milestoneBonus: 0, crossVenueBonus: 0 };
    const identities: SimulationIdentity[] = [{
      identityKey: "email:a@x.com", isKnownStudent: false,
      rows: [
        row({ eventId: 2, occurredAt: new Date("2026-03-01") }),
        row({ eventId: 1, occurredAt: new Date("2026-01-01") }), // más antigua, aunque venga después en el array
      ],
    }];
    const events = simulatePolicyModel(model, identities);
    const firstActionEvents = events.filter(e => e.triggerType === "first_action");
    expect(firstActionEvents).toHaveLength(1);
    expect(firstActionEvents[0].eventId).toBe(1); // la cronológicamente primera, no la primera del array
  });

  it("cross_venue: dispara solo al alcanzar el 2º venue distinto, nunca de nuevo en un 3º", () => {
    const model: PolicyModel = { key: "D", name: "t", description: "t", purchaseTokens: 0, attendanceTokens: 0, firstActionBonus: 0, milestoneEvery: null, milestoneBonus: 0, crossVenueBonus: 20 };
    const identities: SimulationIdentity[] = [{
      identityKey: "email:a@x.com", isKnownStudent: false,
      rows: [
        row({ venueId: 1, occurredAt: new Date("2026-01-01") }),
        row({ venueId: 2, occurredAt: new Date("2026-02-01") }),
        row({ venueId: 3, occurredAt: new Date("2026-03-01") }),
      ],
    }];
    const events = simulatePolicyModel(model, identities);
    const crossVenueEvents = events.filter(e => e.triggerType === "cross_venue");
    expect(crossVenueEvents).toHaveLength(1);
    expect(crossVenueEvents[0].venueId).toBe(2); // el momento exacto del 2º venue distinto
  });

  it("milestone: dispara exactamente al cruzar cada múltiplo de eventos distintos, nunca dos veces el mismo umbral", () => {
    const model: PolicyModel = { key: "E", name: "t", description: "t", purchaseTokens: 0, attendanceTokens: 0, firstActionBonus: 0, milestoneEvery: 2, milestoneBonus: 50, crossVenueBonus: 0 };
    const identities: SimulationIdentity[] = [{
      identityKey: "email:a@x.com", isKnownStudent: false,
      rows: [
        row({ eventId: 1, occurredAt: new Date("2026-01-01") }),
        row({ eventId: 1, occurredAt: new Date("2026-01-02") }), // mismo evento repetido — no debe re-disparar
        row({ eventId: 2, occurredAt: new Date("2026-02-01") }), // 2º evento distinto → cruza umbral=2
        row({ eventId: 3, occurredAt: new Date("2026-03-01") }), // 3º evento — no cruza (umbral siguiente es 4)
        row({ eventId: 4, occurredAt: new Date("2026-04-01") }), // 4º evento → cruza umbral=4
      ],
    }];
    const events = simulatePolicyModel(model, identities);
    const milestoneEvents = events.filter(e => e.triggerType === "milestone");
    expect(milestoneEvents).toHaveLength(2);
    expect(milestoneEvents.map(e => e.eventId)).toEqual([2, 4]);
  });

  it("un modelo con un trigger a 0 nunca lo genera (p.ej. modelo A no premia compra)", () => {
    const modelA = POLICY_MODELS.find(m => m.key === "A")!;
    const identities: SimulationIdentity[] = [{ identityKey: "email:a@x.com", isKnownStudent: false, rows: [row({ operationType: "order" })] }];
    const events = simulatePolicyModel(modelA, identities);
    expect(events.filter(e => e.triggerType === "purchase")).toHaveLength(0);
  });

  it("modelo C combina compra + bono de asistencia en el mismo evento (spec modo purchase+attendance-bonus)", () => {
    const modelC = POLICY_MODELS.find(m => m.key === "C")!;
    const identities: SimulationIdentity[] = [{
      identityKey: "email:a@x.com", isKnownStudent: false,
      rows: [row({ operationType: "order", eventId: 1 }), row({ operationType: "attendance", eventId: 1, occurredAt: new Date("2026-01-02") })],
    }];
    const events = simulatePolicyModel(modelC, identities);
    const totalTokens = events.reduce((s, e) => s + e.tokens, 0);
    expect(totalTokens).toBe(modelC.purchaseTokens + modelC.attendanceTokens + modelC.firstActionBonus);
  });
});

describe("computeModelStats — agregación", () => {
  const modelD = POLICY_MODELS.find(m => m.key === "D")!;

  it("distingue Students conocidos de identidades históricas", () => {
    const identities: SimulationIdentity[] = [
      { identityKey: "email:student@x.com", isKnownStudent: true, rows: [row({ operationType: "attendance", eventId: 1 })] },
      { identityKey: "email:historical@x.com", isKnownStudent: false, rows: [row({ operationType: "attendance", eventId: 2 })] },
    ];
    const events = simulatePolicyModel(modelD, identities);
    const stats = computeModelStats(modelD, events, identities.length);
    expect(stats.knownStudents.count).toBe(1);
    expect(stats.historicalIdentities.count).toBe(1);
    expect(stats.knownStudents.totalTokens).toBeGreaterThan(0);
  });

  it("el top-10 nunca expone identityKey/email — solo métricas agregadas", () => {
    const identities: SimulationIdentity[] = Array.from({ length: 3 }, (_, i) => ({
      identityKey: `email:persona${i}@x.com`, isKnownStudent: false,
      rows: [row({ operationType: "attendance", eventId: i + 1 })],
    }));
    const events = simulatePolicyModel(modelD, identities);
    const stats = computeModelStats(modelD, events, identities.length);
    for (const entry of stats.top10ByTokens) {
      expect(Object.keys(entry).sort()).toEqual(["distinctEvents", "distinctVenues", "isKnownStudent", "rank", "tokens"].sort());
    }
  });

  it("peopleRewarded cuenta identidades únicas, no número de eventos de recompensa", () => {
    const identities: SimulationIdentity[] = [{
      identityKey: "email:a@x.com", isKnownStudent: false,
      rows: [row({ operationType: "attendance", eventId: 1 }), row({ operationType: "attendance", eventId: 2 })],
    }];
    const events = simulatePolicyModel(modelD, identities);
    const stats = computeModelStats(modelD, events, identities.length);
    expect(stats.peopleRewarded).toBe(1);
    expect(stats.rewardsCount).toBe(events.length);
    expect(events.length).toBeGreaterThan(1);
  });

  it("sin ningún evento de recompensa, las métricas quedan en 0 sin dividir por cero", () => {
    const stats = computeModelStats(modelD, [], 10);
    expect(stats).toMatchObject({
      peopleRewarded: 0, rewardsCount: 0, totalTokensIssued: 0,
      avgTokensPerRewardedPerson: 0, medianTokensPerRewardedPerson: 0, maxTokensPerRewardedPerson: 0,
      top1PercentShare: 0,
    });
  });

  it("top1PercentShare refleja la concentración real (ejemplo: 1 identidad se lleva todo)", () => {
    const identities: SimulationIdentity[] = [
      { identityKey: "email:ballena@x.com", isKnownStudent: false, rows: Array.from({ length: 20 }, (_, i) => row({ operationType: "attendance", eventId: i + 1 })) },
      { identityKey: "email:pequeno@x.com", isKnownStudent: false, rows: [row({ operationType: "attendance", eventId: 100 })] },
    ];
    const modelA = POLICY_MODELS.find(m => m.key === "A")!; // solo asistencia, sin milestone/first-action que distorsione
    const events = simulatePolicyModel(modelA, identities);
    const stats = computeModelStats(modelA, events, identities.length);
    expect(stats.top1PercentShare).toBeGreaterThan(0.5); // la "ballena" concentra la mayoría
  });
});

describe("computeEconomicImpact", () => {
  it("calcula el pasivo económico como tokens totales × valor del token", () => {
    const stats = computeModelStats(POLICY_MODELS[0], [], 0);
    const withTokens = { ...stats, totalTokensIssued: 1000 };
    const impact = computeEconomicImpact(withTokens, 500_000, 2); // 2 céntimos/token, 5.000€ de revenue
    expect(impact.totalLiabilityEurCents).toBe(2000); // 20,00€
    expect(impact.rewardRateOverRevenue).toBeCloseTo(2000 / 500_000, 6);
  });

  it("sin revenue, rewardRateOverRevenue es 0 (nunca divide por cero)", () => {
    const stats = computeModelStats(POLICY_MODELS[0], [], 0);
    const impact = computeEconomicImpact({ ...stats, totalTokensIssued: 100 }, 0, 1);
    expect(impact.rewardRateOverRevenue).toBe(0);
  });
});
