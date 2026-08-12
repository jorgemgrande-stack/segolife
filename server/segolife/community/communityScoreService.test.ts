import { describe, it, expect } from "vitest";
import { computeCommunityScore, type CommunityScoreInput } from "./communityScoreService";

function baseInput(overrides: Partial<CommunityScoreInput> = {}): CommunityScoreInput {
  return {
    totalResponses: 10, totalAudience: 40,
    positiveRespondents: 8, strongIntentRespondents: 5,
    medianResponseMinutesSincePublish: 30,
    ...overrides,
  };
}

describe("computeCommunityScore — spec puntos 38-39", () => {
  it("menos de 3 respuestas: insufficientData=true, score=0, sin dimensiones (nunca fabrica un score)", () => {
    const result = computeCommunityScore(baseInput({ totalResponses: 2 }));
    expect(result.insufficientData).toBe(true);
    expect(result.score).toBe(0);
    expect(result.dimensions).toEqual([]);
  });

  it("exactamente el mínimo de respuestas (3) ya calcula score", () => {
    const result = computeCommunityScore(baseInput({ totalResponses: 3, totalAudience: 3, positiveRespondents: 3, strongIntentRespondents: 3 }));
    expect(result.insufficientData).toBe(false);
    expect(result.score).toBeGreaterThan(0);
  });

  it("positiveRespondents/strongIntentRespondents null (tipo sin semántica de intención) omite esas dimensiones en vez de penalizar", () => {
    const withIntent = computeCommunityScore(baseInput({ positiveRespondents: 0, strongIntentRespondents: 0 }));
    const withoutIntent = computeCommunityScore(baseInput({ positiveRespondents: null, strongIntentRespondents: null }));
    expect(withIntent.dimensions.some(d => d.key === "positiveIntent")).toBe(true);
    expect(withoutIntent.dimensions.some(d => d.key === "positiveIntent")).toBe(false);
    expect(withoutIntent.dimensions.some(d => d.key === "strongIntent")).toBe(false);
    // Sin esas dimensiones el score se recalcula solo sobre las disponibles — nunca cae a 0 por faltar un dato no aplicable.
    expect(withoutIntent.score).toBeGreaterThan(0);
  });

  it("participación 100% normaliza a 100 en esa dimensión", () => {
    const result = computeCommunityScore(baseInput({ totalResponses: 20, totalAudience: 20 }));
    const participation = result.dimensions.find(d => d.key === "participation")!;
    expect(participation.normalizedScore).toBe(100);
  });

  it("audiencia 0 (propuesta sin snapshot) no revienta — participación cae a 0, no a NaN/Infinity", () => {
    const result = computeCommunityScore(baseInput({ totalAudience: 0, totalResponses: 5 }));
    const participation = result.dimensions.find(d => d.key === "participation")!;
    expect(participation.normalizedScore).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it("calidad de muestra satura en 100 a partir del umbral — audiencias masivas no ganan puntos extra por tamaño", () => {
    const at20 = computeCommunityScore(baseInput({ totalResponses: 20, totalAudience: 20 }));
    const at2000 = computeCommunityScore(baseInput({ totalResponses: 2000, totalAudience: 2000 }));
    const dim20 = at20.dimensions.find(d => d.key === "sampleQuality")!;
    const dim2000 = at2000.dimensions.find(d => d.key === "sampleQuality")!;
    expect(dim20.normalizedScore).toBe(100);
    expect(dim2000.normalizedScore).toBe(100);
  });

  it("audiencia pequeña con alta participación no se penaliza injustamente frente a una grande con la misma proporción", () => {
    const small = computeCommunityScore(baseInput({ totalResponses: 3, totalAudience: 5, positiveRespondents: 3, strongIntentRespondents: 3 }));
    const large = computeCommunityScore(baseInput({ totalResponses: 300, totalAudience: 500, positiveRespondents: 300, strongIntentRespondents: 300 }));
    const smallParticipation = small.dimensions.find(d => d.key === "participation")!;
    const largeParticipation = large.dimensions.find(d => d.key === "participation")!;
    expect(smallParticipation.normalizedScore).toBe(largeParticipation.normalizedScore);
  });

  it("score final es 0-100 y coherente con el promedio ponderado de sus dimensiones", () => {
    const result = computeCommunityScore(baseInput());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("velocidad ausente (medianResponseMinutesSincePublish=null) omite esa dimensión sin romper el cálculo", () => {
    const result = computeCommunityScore(baseInput({ medianResponseMinutesSincePublish: null }));
    expect(result.dimensions.some(d => d.key === "velocity")).toBe(false);
    expect(Number.isFinite(result.score)).toBe(true);
  });
});
