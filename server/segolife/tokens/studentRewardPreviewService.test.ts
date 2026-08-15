/**
 * studentRewardPreviewService.test.ts — Fase 10.6. No vuelve a probar
 * evaluateReward() (ya cubierto exhaustivamente por rewardEngine.test.ts) —
 * aquí se mockea evaluateReward/getTokenRuleById/getTokenCampaignById/
 * resolveRedemptionPolicy para probar SOLO la traducción a read model
 * (guaranteed vs conditional, amountRequired, promotionalValue, batching,
 * tope de lote) — el mismo criterio de capas que economyGovernanceService.test.ts
 * (mockea referralService entero, no reprueba su lógica interna).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RewardExplanation } from "./rewardEngine";

const evaluateRewardMock = vi.fn();
vi.mock("./rewardEngine", () => ({ evaluateReward: (...args: unknown[]) => evaluateRewardMock(...args) }));

const getTokenRuleByIdMock = vi.fn();
vi.mock("../../db/tokenRulesDb", () => ({ getTokenRuleById: (...args: unknown[]) => getTokenRuleByIdMock(...args) }));

const getTokenCampaignByIdMock = vi.fn();
vi.mock("../../db/tokenCampaignsDb", () => ({ getTokenCampaignById: (...args: unknown[]) => getTokenCampaignByIdMock(...args) }));

const resolveRedemptionPolicyMock = vi.fn();
vi.mock("./tokenSpendService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tokenSpendService")>();
  return { ...actual, resolveRedemptionPolicy: (...args: unknown[]) => resolveRedemptionPolicyMock(...args) };
});

const ensureWalletMock = vi.fn();
vi.mock("./tokenLedgerService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tokenLedgerService")>();
  return { ...actual, ensureWallet: (...args: unknown[]) => ensureWalletMock(...args) };
});

import {
  previewMyReward,
  previewMyEventReward,
  previewMyRewardBatch,
  previewMyEventRewardBatch,
  previewMyWalletValue,
  MAX_BATCH_PREVIEW_ITEMS,
} from "./studentRewardPreviewService";

function rule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Regla", calcMethod: "fixed", fixedAmount: 100, rate: null, multiplier: null,
    ...overrides,
  };
}

function explanation(overrides: Partial<RewardExplanation> = {}): RewardExplanation {
  return {
    eligible: true,
    reason: "GRANTED",
    ruleId: 1,
    breakdown: { base: 100, recurrenceBonus: 0, recurrenceRuleId: null, campaignId: null, campaignMultiplier: null, campaignBonus: null, beforeLimits: 100, final: 100 },
    ...overrides,
  };
}

beforeEach(() => {
  evaluateRewardMock.mockReset();
  getTokenRuleByIdMock.mockReset();
  getTokenCampaignByIdMock.mockReset();
  resolveRedemptionPolicyMock.mockReset();
  ensureWalletMock.mockReset();
  getTokenRuleByIdMock.mockResolvedValue(rule());
  getTokenCampaignByIdMock.mockResolvedValue(null);
  resolveRedemptionPolicyMock.mockResolvedValue(null);
});

describe("previewMyReward — traducción básica", () => {
  it("regla fixed elegible: totalGuaranteedTokens = breakdown.final, amountRequired=false", async () => {
    evaluateRewardMock.mockResolvedValue({ mode: "SIMULATION", explanation: explanation(), ledgerId: null });
    const result = await previewMyReward({ userId: 42, origin: "attendance" });
    expect(result.eligible).toBe(true);
    expect(result.totalGuaranteedTokens).toBe(100);
    expect(result.baseTokens).toBe(100);
    expect(result.amountRequired).toBe(false);
    expect(result.explanation).toBe("GRANTED");
    expect(result.reasonIfNotEligible).toBeNull();
    expect(result.conditionalRewards).toEqual([]);
  });

  it("no encuentra regla (NO_RULE_FOUND): breakdown null, todo en 0, reasonIfNotEligible poblado", async () => {
    evaluateRewardMock.mockResolvedValue({ mode: "SIMULATION", explanation: explanation({ eligible: false, reason: "NO_RULE_FOUND", ruleId: null, breakdown: null }), ledgerId: null });
    const result = await previewMyReward({ userId: 42, origin: "consumption" });
    expect(result.eligible).toBe(false);
    expect(result.totalGuaranteedTokens).toBe(0);
    expect(result.effectiveRate).toBeNull();
    expect(result.reasonIfNotEligible).toBe("NO_RULE_FOUND");
    expect(getTokenRuleByIdMock).not.toHaveBeenCalled();
  });

  it("nunca llama a evaluateReward en modo LIVE — siempre SIMULATION", async () => {
    evaluateRewardMock.mockResolvedValue({ mode: "SIMULATION", explanation: explanation(), ledgerId: null });
    await previewMyReward({ userId: 42, origin: "attendance" });
    expect(evaluateRewardMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, origin: "attendance" }), "SIMULATION", undefined);
  });
});

describe("previewMyReward — amountRequired (regla amount-dependent sin amountSpent)", () => {
  it("regla per_euro sin amountSpent → amountRequired=true, eligible=false, totalGuaranteedTokens=0, pero effectiveRate presente", async () => {
    getTokenRuleByIdMock.mockResolvedValue(rule({ calcMethod: "per_euro", rate: "5", fixedAmount: null }));
    evaluateRewardMock.mockResolvedValue({
      mode: "SIMULATION",
      explanation: explanation({ eligible: false, reason: "RULE_LIMIT_EXCEEDED", breakdown: { base: 0, recurrenceBonus: 0, recurrenceRuleId: null, campaignId: null, campaignMultiplier: null, campaignBonus: null, beforeLimits: 0, final: 0 } }),
      ledgerId: null,
    });
    const result = await previewMyReward({ userId: 42, origin: "ticket" }); // sin amountSpent
    expect(result.amountRequired).toBe(true);
    expect(result.eligible).toBe(false);
    expect(result.totalGuaranteedTokens).toBe(0);
    expect(result.effectiveRate).toBe("5 ST/€");
    expect(result.reasonIfNotEligible).toBe("NO_RULE_FOUND");
  });

  it("misma regla per_euro CON amountSpent → calcula normal, amountRequired=false", async () => {
    getTokenRuleByIdMock.mockResolvedValue(rule({ calcMethod: "per_euro", rate: "5", fixedAmount: null }));
    evaluateRewardMock.mockResolvedValue({
      mode: "SIMULATION",
      explanation: explanation({ breakdown: { base: 50, recurrenceBonus: 0, recurrenceRuleId: null, campaignId: null, campaignMultiplier: null, campaignBonus: null, beforeLimits: 50, final: 50 } }),
      ledgerId: null,
    });
    const result = await previewMyReward({ userId: 42, origin: "ticket", amountSpent: 10 });
    expect(result.amountRequired).toBe(false);
    expect(result.eligible).toBe(true);
    expect(result.totalGuaranteedTokens).toBe(50);
  });

  it("regla fixed sin amountSpent NUNCA se marca amountRequired (no depende de importe)", async () => {
    getTokenRuleByIdMock.mockResolvedValue(rule({ calcMethod: "fixed", fixedAmount: 100 }));
    evaluateRewardMock.mockResolvedValue({ mode: "SIMULATION", explanation: explanation(), ledgerId: null });
    const result = await previewMyReward({ userId: 42, origin: "attendance" });
    expect(result.amountRequired).toBe(false);
    expect(result.totalGuaranteedTokens).toBe(100);
  });
});

describe("previewMyReward — campaña y valor promocional", () => {
  it("campaña activa aporta campaignTokens = beforeLimits - base - recurrence, y campaignLabel/expiresAt se resuelven por id", async () => {
    evaluateRewardMock.mockResolvedValue({
      mode: "SIMULATION",
      explanation: explanation({ breakdown: { base: 100, recurrenceBonus: 0, recurrenceRuleId: null, campaignId: 7, campaignMultiplier: 2, campaignBonus: null, beforeLimits: 200, final: 200 } }),
      ledgerId: null,
    });
    getTokenCampaignByIdMock.mockResolvedValue({ id: 7, name: "Campaña x2", endsAt: new Date("2026-09-01T00:00:00Z") });
    const result = await previewMyReward({ userId: 42, origin: "attendance" });
    expect(result.campaignTokens).toBe(100);
    expect(result.campaignLabel).toBe("Campaña x2");
    expect(result.expiresAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("con política de canje activa, promotionalValue refleja tokens→céntimos con la fórmula real (nunca inventada aquí)", async () => {
    evaluateRewardMock.mockResolvedValue({ mode: "SIMULATION", explanation: explanation(), ledgerId: null }); // final=100
    resolveRedemptionPolicyMock.mockResolvedValue({ tokensPerUnit: 100, valueCentsPerUnit: 100 }); // 100 ST = 1€
    const result = await previewMyReward({ userId: 42, origin: "attendance" });
    expect(result.promotionalValue).toEqual({ cents: 100, formatted: "1.00€" });
  });

  it("sin política de canje activa, promotionalValue es null (honesto, nunca un valor inventado)", async () => {
    evaluateRewardMock.mockResolvedValue({ mode: "SIMULATION", explanation: explanation(), ledgerId: null });
    resolveRedemptionPolicyMock.mockResolvedValue(null);
    const result = await previewMyReward({ userId: 42, origin: "attendance" });
    expect(result.promotionalValue).toBeNull();
  });

  it("capRemaining solo se rellena cuando el tope real recortó el resultado (beforeLimits > final)", async () => {
    evaluateRewardMock.mockResolvedValue({
      mode: "SIMULATION",
      explanation: explanation({ breakdown: { base: 100, recurrenceBonus: 0, recurrenceRuleId: null, campaignId: null, campaignMultiplier: null, campaignBonus: null, beforeLimits: 100, final: 30 } }),
      ledgerId: null,
    });
    const result = await previewMyReward({ userId: 42, origin: "attendance" });
    expect(result.capRemaining).toBe(30);
  });

  it("sin recorte de tope, capRemaining es null", async () => {
    evaluateRewardMock.mockResolvedValue({ mode: "SIMULATION", explanation: explanation(), ledgerId: null });
    const result = await previewMyReward({ userId: 42, origin: "attendance" });
    expect(result.capRemaining).toBeNull();
  });
});

describe("previewMyEventReward — guaranteed (ticket) vs conditional (attendance) nunca mezclados", () => {
  it("compra con recompensa garantizada + asistencia elegible → conditionalRewards contiene attendance, nunca sumado a totalGuaranteedTokens", async () => {
    evaluateRewardMock.mockImplementation((ctx: { origin: string }) => {
      if (ctx.origin === "ticket") {
        return Promise.resolve({ mode: "SIMULATION", explanation: explanation({ ruleId: 1, breakdown: { base: 50, recurrenceBonus: 0, recurrenceRuleId: null, campaignId: null, campaignMultiplier: null, campaignBonus: null, beforeLimits: 50, final: 50 } }), ledgerId: null });
      }
      // attendance
      return Promise.resolve({ mode: "SIMULATION", explanation: explanation({ ruleId: 2, breakdown: { base: 100, recurrenceBonus: 0, recurrenceRuleId: null, campaignId: null, campaignMultiplier: null, campaignBonus: null, beforeLimits: 100, final: 100 } }), ledgerId: null });
    });
    const result = await previewMyEventReward({ userId: 42, eventId: 5, amountSpent: 10 });
    expect(result.actionType).toBe("ticket");
    expect(result.totalGuaranteedTokens).toBe(50); // SOLO la compra, nunca incluye la asistencia
    expect(result.conditionalRewards).toEqual([{ actionType: "attendance", totalTokens: 100, eligible: true, reasonIfNotEligible: null }]);
  });

  it("sin regla de asistencia configurada → conditionalRewards vacío (honesto, no inventa una recompensa condicional inexistente)", async () => {
    evaluateRewardMock.mockImplementation((ctx: { origin: string }) => {
      if (ctx.origin === "ticket") {
        return Promise.resolve({ mode: "SIMULATION", explanation: explanation(), ledgerId: null });
      }
      return Promise.resolve({ mode: "SIMULATION", explanation: explanation({ eligible: false, reason: "NO_RULE_FOUND", ruleId: null, breakdown: null }), ledgerId: null });
    });
    const result = await previewMyEventReward({ userId: 42, eventId: 5, amountSpent: 10 });
    expect(result.conditionalRewards).toEqual([]);
  });
});

describe("previewMyRewardBatch / previewMyEventRewardBatch — lote N+1-safe", () => {
  it("devuelve un resultado por key en el mismo orden de items, en UNA sola resolución de promesas", async () => {
    evaluateRewardMock.mockResolvedValue({ mode: "SIMULATION", explanation: explanation(), ledgerId: null });
    const result = await previewMyRewardBatch(42, [
      { key: "a", origin: "attendance", venueId: 1 },
      { key: "b", origin: "consumption", venueId: 2 },
    ]);
    expect(Object.keys(result)).toEqual(["a", "b"]);
    expect(result.a.totalGuaranteedTokens).toBe(100);
    expect(evaluateRewardMock).toHaveBeenCalledTimes(2);
  });

  it(`aplica el tope duro de ${MAX_BATCH_PREVIEW_ITEMS} items — items extra se descartan silenciosamente en el propio service (el router ya los rechaza antes por zod .max())`, async () => {
    evaluateRewardMock.mockResolvedValue({ mode: "SIMULATION", explanation: explanation(), ledgerId: null });
    const items = Array.from({ length: MAX_BATCH_PREVIEW_ITEMS + 10 }, (_, i) => ({ key: `k${i}`, origin: "attendance" as const }));
    const result = await previewMyRewardBatch(42, items);
    expect(Object.keys(result)).toHaveLength(MAX_BATCH_PREVIEW_ITEMS);
  });

  it("previewMyEventRewardBatch compone guaranteed+conditional para cada evento del lote", async () => {
    evaluateRewardMock.mockImplementation((ctx: { origin: string }) =>
      Promise.resolve({ mode: "SIMULATION", explanation: explanation({ ruleId: ctx.origin === "ticket" ? 1 : 2 }), ledgerId: null })
    );
    const result = await previewMyEventRewardBatch(42, [{ key: "ev1", eventId: 10 }, { key: "ev2", eventId: 11 }]);
    expect(Object.keys(result)).toEqual(["ev1", "ev2"]);
    expect(result.ev1.actionType).toBe("ticket");
    expect(result.ev1.conditionalRewards[0].actionType).toBe("attendance");
  });
});

describe("previewMyWalletValue — valor promocional del saldo (spec §35, Wallet)", () => {
  it("con política global activa, devuelve balance + valor en € vía la MISMA fórmula tokensToValueCents", async () => {
    ensureWalletMock.mockResolvedValue({ userId: 42, balance: 250 });
    resolveRedemptionPolicyMock.mockResolvedValue({ tokensPerUnit: 100, valueCentsPerUnit: 100 });
    const result = await previewMyWalletValue(42);
    expect(result.balance).toBe(250);
    expect(result.promotionalValue).toEqual({ cents: 250, formatted: "2.50€" });
    expect(resolveRedemptionPolicyMock).toHaveBeenCalledWith({}, expect.any(Date), undefined);
  });

  it("sin política global activa, promotionalValue es null (honesto)", async () => {
    ensureWalletMock.mockResolvedValue({ userId: 42, balance: 250 });
    resolveRedemptionPolicyMock.mockResolvedValue(null);
    const result = await previewMyWalletValue(42);
    expect(result.promotionalValue).toBeNull();
  });

  it("saldo en 0 nunca dispara la conversión (evita mostrar '0.00€' innecesariamente)", async () => {
    ensureWalletMock.mockResolvedValue({ userId: 42, balance: 0 });
    resolveRedemptionPolicyMock.mockResolvedValue({ tokensPerUnit: 100, valueCentsPerUnit: 100 });
    const result = await previewMyWalletValue(42);
    expect(result.promotionalValue).toBeNull();
  });
});

describe("previewMyReward — identidad: userId siempre viaja explícito al motor real", () => {
  it("el userId pasado se propaga literal a evaluateReward (el router es quien garantiza que venga de ctx.user.id, no este service)", async () => {
    evaluateRewardMock.mockResolvedValue({ mode: "SIMULATION", explanation: explanation(), ledgerId: null });
    await previewMyReward({ userId: 999, origin: "attendance" });
    expect(evaluateRewardMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 999 }), "SIMULATION", undefined);
  });
});
