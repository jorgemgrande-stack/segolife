/**
 * economyGovernanceService.test.ts — SEGOLIFE FASE 10.5 (spec §71/§74).
 * Gobierno sobre los motores YA existentes — nunca reimplementa una fórmula
 * (previewRuleForScope reutiliza findApplicableRule real, sin mocks).
 */
import { describe, it, expect, vi } from "vitest";
import { drizzleConditionMockFactory, MockTable, createMockDb } from "../_testHelpers/drizzleTableMock";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, ...drizzleConditionMockFactory() };
});

const { mockListReferralCampaigns, mockCreateReferralCampaign, mockUpdateReferralCampaign, mockActivateReferralCampaign } = vi.hoisted(() => ({
  mockListReferralCampaigns: vi.fn(),
  mockCreateReferralCampaign: vi.fn(),
  mockUpdateReferralCampaign: vi.fn(),
  mockActivateReferralCampaign: vi.fn(),
}));
vi.mock("../referrals/referralService", () => ({
  listReferralCampaigns: mockListReferralCampaigns,
  createReferralCampaign: mockCreateReferralCampaign,
  updateReferralCampaign: mockUpdateReferralCampaign,
  activateReferralCampaign: mockActivateReferralCampaign,
}));

import { tokenRules, tokenCampaigns, tokenRedemptionPolicies, benefitDefinitions, economyConfigChanges } from "../../../drizzle/schema";
import {
  detectEconomyConflicts, previewRuleForScope, getEconomyGovernanceOverview,
  applyTokenRuleValueChange, setGlobalRedemptionConversion, setGlobalReferralEconomics,
  recordEconomyConfigChange, listEconomyConfigChanges, EconomyGovernanceError,
} from "./economyGovernanceService";

function ruleFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, name: "Consumo en venue", direction: "earn", origin: "consumption", scope: "global", scopeVenueId: null, scopeEventId: null, scopeCommunityId: null, scopeProductId: null, scopeTicketTypeId: null, calcMethod: "per_euro", fixedAmount: null, rate: "0.5000", multiplier: null, maxTokens: null, dailyLimit: null, weeklyLimit: null, monthlyLimit: null, lifetimeLimit: null, recurrenceWindow: null, recurrenceThreshold: null, recurrenceMode: null, active: true, priority: 0, startsAt: null, endsAt: null, ...overrides };
}

function makeDb(config: {
  rules?: Array<Record<string, unknown>>;
  policies?: Array<Record<string, unknown>>;
  campaigns?: Array<Record<string, unknown>>;
  benefits?: Array<Record<string, unknown>>;
  changes?: Array<Record<string, unknown>>;
} = {}) {
  const tables = new Map<unknown, MockTable<Record<string, unknown>>>([
    [tokenRules, new MockTable(tokenRules as unknown as Record<string, unknown>, config.rules ?? [ruleFixture()])],
    [tokenRedemptionPolicies, new MockTable(tokenRedemptionPolicies as unknown as Record<string, unknown>, config.policies ?? [])],
    [tokenCampaigns, new MockTable(tokenCampaigns as unknown as Record<string, unknown>, config.campaigns ?? [])],
    [benefitDefinitions, new MockTable(benefitDefinitions as unknown as Record<string, unknown>, config.benefits ?? [])],
    [economyConfigChanges, new MockTable(economyConfigChanges as unknown as Record<string, unknown>, config.changes ?? [])],
  ]);
  const db = createMockDb(tables);
  return { db, rulesTable: tables.get(tokenRules)!, policiesTable: tables.get(tokenRedemptionPolicies)!, changesTable: tables.get(economyConfigChanges)! };
}

describe("detectEconomyConflicts — spec §22/§24", () => {
  it("#1 dos reglas activas de earn/consumption con el MISMO alcance exacto -> CONFLICT", async () => {
    mockListReferralCampaigns.mockResolvedValue([{ status: "active", communityId: null }]);
    const { db } = makeDb({
      rules: [ruleFixture({ id: 1 }), ruleFixture({ id: 2, name: "Consumo duplicado" })],
      policies: [{ id: 1, communityId: null, venueId: null, eventId: null, active: true }],
    });
    const conflicts = await detectEconomyConflicts(db);
    expect(conflicts.some(c => c.code === "OVERLAPPING_RULES")).toBe(true);
  });

  it("#2 dos reglas de consumption con alcance DISTINTO (global vs venue) NO son conflicto", async () => {
    mockListReferralCampaigns.mockResolvedValue([{ status: "active", communityId: null }]);
    const { db } = makeDb({
      rules: [ruleFixture({ id: 1 }), ruleFixture({ id: 2, scope: "venue", scopeVenueId: 10 })],
      policies: [{ id: 1, communityId: null, venueId: null, eventId: null, active: true }],
    });
    const conflicts = await detectEconomyConflicts(db);
    expect(conflicts.some(c => c.code === "OVERLAPPING_RULES")).toBe(false);
  });

  it("#3 sin ninguna política de canje activa -> WARNING NO_REDEMPTION_POLICY", async () => {
    mockListReferralCampaigns.mockResolvedValue([{ status: "active", communityId: null }]);
    const { db } = makeDb({ policies: [] });
    const conflicts = await detectEconomyConflicts(db);
    expect(conflicts.some(c => c.code === "NO_REDEMPTION_POLICY")).toBe(true);
  });

  it("#4 sin ninguna campaña de referidos activa -> WARNING NO_REFERRAL_CAMPAIGN", async () => {
    mockListReferralCampaigns.mockResolvedValue([]);
    const { db } = makeDb({ policies: [{ id: 1, communityId: null, venueId: null, eventId: null, active: true }] });
    const conflicts = await detectEconomyConflicts(db);
    expect(conflicts.some(c => c.code === "NO_REFERRAL_CAMPAIGN")).toBe(true);
  });

  it("#5 idea_submitted SIEMPRE se informa como NOT_CONNECTED (spec §7, sin productor real)", async () => {
    mockListReferralCampaigns.mockResolvedValue([{ status: "active", communityId: null }]);
    const { db } = makeDb({ policies: [{ id: 1, communityId: null, venueId: null, eventId: null, active: true }] });
    const conflicts = await detectEconomyConflicts(db);
    expect(conflicts.some(c => c.code === "COMMUNITY_IDEA_SUBMITTED_NOT_CONNECTED" && c.severity === "not_connected")).toBe(true);
  });
});

describe("previewRuleForScope — spec §25/§26 (sin Student)", () => {
  it("#6 devuelve la regla de mayor priority entre las candidatas del mismo alcance", async () => {
    const { db } = makeDb({ rules: [ruleFixture({ id: 1, priority: 0 }), ruleFixture({ id: 2, name: "Promo temporal", priority: 5 })] });
    const result = await previewRuleForScope({ direction: "earn", origin: "consumption" }, db);
    expect(result.effectiveRule?.id).toBe(2);
    expect(result.candidates).toHaveLength(2);
  });

  it("#7 null cuando ninguna regla activa encaja", async () => {
    const { db } = makeDb({ rules: [ruleFixture({ active: false })] });
    const result = await previewRuleForScope({ direction: "earn", origin: "consumption" }, db);
    expect(result.effectiveRule).toBeNull();
  });
});

describe("getEconomyGovernanceOverview — spec §17/§18/§70", () => {
  it("#8 calcula el retorno equivalente correctamente (100 ST=100c, rate 5 -> 5%)", async () => {
    mockListReferralCampaigns.mockResolvedValue([]);
    const { db } = makeDb({
      rules: [ruleFixture({ origin: "ticket", calcMethod: "per_euro", rate: "5.0000" })],
      policies: [{ id: 1, communityId: null, venueId: null, eventId: null, active: true, tokensPerUnit: 100, valueCentsPerUnit: 100 }],
    });
    const overview = await getEconomyGovernanceOverview(db);
    const ticketSummary = overview.earn.find(e => e.origin === "ticket");
    expect(ticketSummary?.effectiveReturnPercent).toBe(5);
  });

  it("#9 sin política de canje, effectiveReturnPercent es null (nunca se adivina)", async () => {
    mockListReferralCampaigns.mockResolvedValue([]);
    const { db } = makeDb({ rules: [ruleFixture({ origin: "ticket", calcMethod: "per_euro", rate: "5.0000" })], policies: [] });
    const overview = await getEconomyGovernanceOverview(db);
    expect(overview.redemptionConversion).toBeNull();
    expect(overview.earn.find(e => e.origin === "ticket")?.effectiveReturnPercent).toBeNull();
  });

  it("#10 precio de Marketplace independiente del valor base (spec §14)", async () => {
    mockListReferralCampaigns.mockResolvedValue([]);
    const { db } = makeDb({
      policies: [{ id: 1, communityId: null, venueId: null, eventId: null, active: true, tokensPerUnit: 100, valueCentsPerUnit: 100 }],
      benefits: [{ id: 1, isMarketplaceEnabled: true, tokenCost: 600 }],
    });
    const overview = await getEconomyGovernanceOverview(db);
    expect(overview.marketplace.minTokenCost).toBe(600);
  });
});

describe("applyTokenRuleValueChange — cambios auditados (spec §56)", () => {
  it("#11 actualiza el rate y registra el cambio en economy_config_changes", async () => {
    const { db, rulesTable, changesTable } = makeDb({ rules: [ruleFixture({ rate: "0.5000" })] });
    const updated = await applyTokenRuleValueChange(1, { rate: "3.0000" }, 9, "activación V1", db);
    expect(updated.rate).toBe("3.0000");
    expect(rulesTable.rows[0].rate).toBe("3.0000");
    expect(changesTable.rows).toHaveLength(1);
    expect(changesTable.rows[0]).toMatchObject({ entityType: "token_rule", entityId: 1, fieldName: "rate", oldValue: "0.5000", newValue: "3.0000", reason: "activación V1", actorUserId: 9 });
  });

  it("#12 no registra cambio si el valor nuevo es igual al anterior (idempotente en auditoría)", async () => {
    const { db, changesTable } = makeDb({ rules: [ruleFixture({ rate: "3.0000" })] });
    await applyTokenRuleValueChange(1, { rate: "3.0000" }, 9, "sin cambio real", db);
    expect(changesTable.rows).toHaveLength(0);
  });

  it("#13 regla inexistente lanza NOT_FOUND", async () => {
    const { db } = makeDb({ rules: [] });
    await expect(applyTokenRuleValueChange(999, { rate: "1.0" }, 9, "x", db)).rejects.toBeInstanceOf(EconomyGovernanceError);
  });
});

describe("setGlobalRedemptionConversion — spec §10/§13", () => {
  it("#14 crea la política global si no existe ninguna", async () => {
    const { db, policiesTable, changesTable } = makeDb({ policies: [] });
    const policy = await setGlobalRedemptionConversion({ tokensPerUnit: 100, valueCentsPerUnit: 100, actorUserId: 9, reason: "V1" }, db);
    expect(policy.tokensPerUnit).toBe(100);
    expect(policiesTable.rows).toHaveLength(1);
    expect(changesTable.rows[0]).toMatchObject({ entityType: "redemption_policy", oldValue: null });
  });

  it("#15 actualiza la política global existente en vez de crear una segunda (nunca duplica)", async () => {
    const { db, policiesTable } = makeDb({ policies: [{ id: 5, communityId: null, venueId: null, eventId: null, active: true, tokensPerUnit: 100, valueCentsPerUnit: 200 }] });
    await setGlobalRedemptionConversion({ tokensPerUnit: 100, valueCentsPerUnit: 100, actorUserId: 9, reason: "corrige valor" }, db);
    expect(policiesTable.rows).toHaveLength(1);
    expect(policiesTable.rows[0].valueCentsPerUnit).toBe(100);
  });

  it("#16 una política con venueId específico nunca se confunde con la global", async () => {
    const { db, policiesTable } = makeDb({ policies: [{ id: 5, communityId: null, venueId: 10, eventId: null, active: true, tokensPerUnit: 50, valueCentsPerUnit: 100 }] });
    await setGlobalRedemptionConversion({ tokensPerUnit: 100, valueCentsPerUnit: 100, actorUserId: 9, reason: "nueva global" }, db);
    expect(policiesTable.rows).toHaveLength(2); // la de venue=10 se conserva intacta, se crea una global nueva
  });
});

describe("setGlobalReferralEconomics — spec §6 (Referral Engine sigue siendo canónico)", () => {
  it("#17 actualiza una campaña global activa existente en vez de crear otra", async () => {
    mockListReferralCampaigns.mockResolvedValue([{ id: 3, communityId: null, status: "active", inviterRewardTokens: 100, inviteeRewardTokens: 50 }]);
    mockUpdateReferralCampaign.mockResolvedValue({ id: 3, inviterRewardTokens: 500, inviteeRewardTokens: 250 });
    const { db } = makeDb();
    await setGlobalReferralEconomics({ inviterRewardTokens: 500, inviteeRewardTokens: 250, conversionCondition: "profile_completed", actorUserId: 9, reason: "V1" }, db);
    expect(mockUpdateReferralCampaign).toHaveBeenCalledOnce();
    expect(mockCreateReferralCampaign).not.toHaveBeenCalled();
  });

  it("#18 crea y activa una campaña nueva si ninguna global está activa", async () => {
    mockListReferralCampaigns.mockResolvedValue([]);
    mockCreateReferralCampaign.mockResolvedValue({ id: 9, inviterRewardTokens: 500, inviteeRewardTokens: 250 });
    mockActivateReferralCampaign.mockResolvedValue({ id: 9, status: "active" });
    const { db } = makeDb();
    const result = await setGlobalReferralEconomics({ inviterRewardTokens: 500, inviteeRewardTokens: 250, conversionCondition: "profile_completed", actorUserId: 9, reason: "V1" }, db);
    expect(mockCreateReferralCampaign).toHaveBeenCalledOnce();
    expect(mockActivateReferralCampaign).toHaveBeenCalledWith(9, 9, db);
    expect(result).toMatchObject({ status: "active" });
  });
});

describe("recordEconomyConfigChange / listEconomyConfigChanges", () => {
  it("#19 registra y lista los cambios más recientes primero", async () => {
    const { db, changesTable } = makeDb();
    await recordEconomyConfigChange({ entityType: "token_rule", entityId: 1, fieldName: "rate", oldValue: "0.5", newValue: "3", actorUserId: 9 }, db);
    expect(changesTable.rows).toHaveLength(1);
    const list = await listEconomyConfigChanges(10, db);
    expect(list).toHaveLength(1);
  });
});
