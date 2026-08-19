/**
 * tokens.test.ts — RBAC a nivel de router (Fase 2). Mismo patrón que
 * server/routers/venues.test.ts / students.test.ts: todos los procedures
 * (admin y autoservicio) exigen sesión — protectedProcedure/permissionProcedure
 * rechazan ANTES de tocar la BD, así que se prueban con `ctx.user = null` sin
 * mockear nada más.
 *
 * El scoping por comunidad (community admin no ve otra comunidad) reutiliza
 * exactamente getCommunityAccess/resolveCommunityFilter, ya cubiertos de
 * forma exhaustiva en server/_core/communityAccess.test.ts — no se duplica
 * aquí, mismo criterio que students.test.ts/venues.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// MG-02 — myRewardForOrder es el único procedure de este router que toca
// datos reales de otro módulo (ticketingDb, para comprobar propiedad del
// pedido) — se mockea solo para ese describe block; el resto de este
// fichero sigue sin mockear nada porque nunca llega a tocar la BD (rechaza
// por falta de sesión antes).
const { mockGetMyOrderById, mockFindActiveGrantBySource, mockRetryPendingTokenClawbacks } = vi.hoisted(() => ({
  mockGetMyOrderById: vi.fn(),
  mockFindActiveGrantBySource: vi.fn(),
  mockRetryPendingTokenClawbacks: vi.fn(),
}));
vi.mock("../segolife/ticketing/ticketingDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/ticketing/ticketingDb")>();
  return { ...actual, getMyOrderById: mockGetMyOrderById };
});
vi.mock("../segolife/tokens/tokenLedgerService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/tokens/tokenLedgerService")>();
  return { ...actual, findActiveGrantBySource: mockFindActiveGrantBySource };
});
// FIX-01 — retryPendingClawbacks delega en el reconciliador; se mockea igual
// que findActiveGrantBySource arriba, para probar solo la delegación del
// router (el reconciliador en sí ya está probado por su cuenta en
// tokenClawbackReconciliationService.test.ts).
vi.mock("../segolife/tokens/tokenClawbackReconciliationService", () => ({
  retryPendingTokenClawbacks: mockRetryPendingTokenClawbacks,
}));

import { tokensRouter } from "./tokens";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return tokensRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(role: string, id = 1) {
  return tokensRouter.createCaller({ user: { id, role } } as any);
}

describe("tokens router — wallet/ledger de un usuario (admin) rechazan sin sesión", () => {
  it("tokens.getWallet rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getWallet({ userId: 1 })).rejects.toThrow(/please login/i);
  });
  it("tokens.listLedger rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listLedger({ userId: 1, limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });
  it("tokens.adjustManual rechaza sin sesión", async () => {
    await expect(
      callerWithoutSession().adjustManual({ userId: 1, direction: "credit", amount: 10, reason: "x" })
    ).rejects.toThrow(/please login/i);
  });
  it("tokens.reverseLedger rechaza sin sesión", async () => {
    await expect(callerWithoutSession().reverseLedger({ ledgerId: 1, reason: "x" })).rejects.toThrow(/please login/i);
  });
  it("tokens.retryPendingClawbacks rechaza sin sesión", async () => {
    await expect(callerWithoutSession().retryPendingClawbacks()).rejects.toThrow(/please login/i);
  });
});

describe("tokens.retryPendingClawbacks — FIX-01 (resolución manual del reconciliador)", () => {
  beforeEach(() => {
    mockRetryPendingTokenClawbacks.mockReset();
  });

  it("un admin delega en el MISMO reconciliador que el job programado, sin lógica propia de reversión", async () => {
    mockRetryPendingTokenClawbacks.mockResolvedValue({ processed: 2, resolved: 1, stillPending: 1, candidateOrderIds: [10, 11] });
    const result = await callerAs("admin").retryPendingClawbacks();
    expect(result).toEqual({ processed: 2, resolved: 1, stillPending: 1, candidateOrderIds: [10, 11] });
    expect(mockRetryPendingTokenClawbacks).toHaveBeenCalledTimes(1);
  });
});

describe("tokens router — reglas (admin) rechazan sin sesión", () => {
  it("tokens.listRules rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listRules()).rejects.toThrow(/please login/i);
  });
  it("tokens.getRuleById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getRuleById({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("tokens.createRule rechaza sin sesión", async () => {
    await expect(
      callerWithoutSession().createRule({ name: "x", direction: "earn", origin: "manual", calcMethod: "fixed" })
    ).rejects.toThrow(/please login/i);
  });
  it("tokens.updateRule rechaza sin sesión", async () => {
    await expect(callerWithoutSession().updateRule({ id: 1, name: "y" })).rejects.toThrow(/please login/i);
  });
  it("tokens.setRuleActive rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setRuleActive({ id: 1, active: false })).rejects.toThrow(/please login/i);
  });
});

describe("tokens router — campañas (admin) rechazan sin sesión", () => {
  it("tokens.listCampaigns rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listCampaigns()).rejects.toThrow(/please login/i);
  });
  it("tokens.getCampaignById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getCampaignById({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("tokens.createCampaign rechaza sin sesión", async () => {
    await expect(callerWithoutSession().createCampaign({ name: "x2" })).rejects.toThrow(/please login/i);
  });
  it("tokens.updateCampaign rechaza sin sesión", async () => {
    await expect(callerWithoutSession().updateCampaign({ id: 1, name: "y" })).rejects.toThrow(/please login/i);
  });
  it("tokens.setCampaignActive rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setCampaignActive({ id: 1, active: false })).rejects.toThrow(/please login/i);
  });
  it("tokens.setCampaignScope rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setCampaignScope({ id: 1, communityIds: [], venueIds: [], eventIds: [] })).rejects.toThrow(/please login/i);
  });
});

describe("tokens router — productos de venue (admin) rechazan sin sesión", () => {
  it("tokens.listVenueProducts rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listVenueProducts({ venueId: 1 })).rejects.toThrow(/please login/i);
  });
  it("tokens.createVenueProduct rechaza sin sesión", async () => {
    await expect(callerWithoutSession().createVenueProduct({ venueId: 1, name: "Cóctel", slug: "coctel" })).rejects.toThrow(/please login/i);
  });
  it("tokens.updateVenueProduct rechaza sin sesión", async () => {
    await expect(callerWithoutSession().updateVenueProduct({ id: 1, name: "y" })).rejects.toThrow(/please login/i);
  });
  it("tokens.setVenueProductActive rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setVenueProductActive({ id: 1, active: false })).rejects.toThrow(/please login/i);
  });
});

describe("tokens router — horarios earn/spend (admin) rechazan sin sesión", () => {
  it("tokens.listSchedules rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listSchedules({ venueId: 1 })).rejects.toThrow(/please login/i);
  });
  it("tokens.createSchedule rechaza sin sesión", async () => {
    await expect(
      callerWithoutSession().createSchedule({ venueId: 1, operationType: "earn", dayOfWeek: 1, startTime: "09:00", endTime: "23:00" })
    ).rejects.toThrow(/please login/i);
  });
  it("tokens.deleteSchedule rechaza sin sesión", async () => {
    await expect(callerWithoutSession().deleteSchedule({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("tokens.setScheduleActive rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setScheduleActive({ id: 1, active: false })).rejects.toThrow(/please login/i);
  });
});

describe("tokens router — dashboard (admin) rechaza sin sesión", () => {
  it("tokens.dashboardSummary rechaza sin sesión", async () => {
    await expect(callerWithoutSession().dashboardSummary()).rejects.toThrow(/please login/i);
  });
});

describe("tokens router — SEGOTOKENS ECONOMY: Rule Preview (spec §26) rechaza sin sesión", () => {
  it("tokens.previewReward rechaza sin sesión", async () => {
    await expect(callerWithoutSession().previewReward({ userId: 42, origin: "attendance" })).rejects.toThrow(/please login/i);
  });
});

describe("tokens router — SEGOTOKENS ECONOMY CONTROL CENTER (Fase 10.5, spec §57/§58/§74)", () => {
  it("economyGovernanceOverview/economyConflicts/economyConfigChanges/previewRuleForScope rechazan sin sesión", async () => {
    await expect(callerWithoutSession().economyGovernanceOverview()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().economyConflicts()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().economyConfigChanges({})).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().previewRuleForScope({ direction: "earn", origin: "consumption" })).rejects.toThrow(/please login/i);
  });

  it("applyTokenRuleValueChange/setGlobalRedemptionConversion/setGlobalReferralEconomics rechazan sin sesión", async () => {
    await expect(callerWithoutSession().applyTokenRuleValueChange({ ruleId: 1, reason: "x" })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().setGlobalRedemptionConversion({ tokensPerUnit: 100, valueCentsPerUnit: 100, reason: "x" })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().setGlobalReferralEconomics({ inviterRewardTokens: 500, inviteeRewardTokens: 250, conversionCondition: "profile_completed", reason: "x" })).rejects.toThrow(/please login/i);
  });

  it("un Venue Admin nunca puede cambiar la economía global (spec §46, reutiliza tokens.manage — solo GLOBAL_ADMIN)", async () => {
    await expect(callerAs("venue_admin").applyTokenRuleValueChange({ ruleId: 1, rate: "99", reason: "intento no autorizado" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("venue_admin").setGlobalRedemptionConversion({ tokensPerUnit: 1, valueCentsPerUnit: 1, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un Student (role='user') nunca puede ver ni cambiar la economía global", async () => {
    await expect(callerAs("user").economyGovernanceOverview()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("user").applyTokenRuleValueChange({ ruleId: 1, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("GLOBAL_ADMIN llega al handler real (middleware no lo bloquea)", async () => {
    await expect(callerAs("admin").economyGovernanceOverview()).rejects.not.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("admin").economyGovernanceOverview()).rejects.not.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("tokens router — autoservicio del estudiante (nunca público) rechaza sin sesión", () => {
  it("tokens.getMyWallet rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getMyWallet()).rejects.toThrow(/please login/i);
  });
  it("tokens.listMyLedger rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listMyLedger({ limit: 20, offset: 0 })).rejects.toThrow(/please login/i);
  });
});

describe("tokens router — SEGOTOKENS REWARD PREVIEW & ECONOMY TRANSPARENCY (Fase 10.6)", () => {
  it("previewMyReward/previewMyEventReward/previewMyRewardBatch/previewMyEventRewardBatch/myWalletPromotionalValue rechazan sin sesión", async () => {
    await expect(callerWithoutSession().previewMyReward({ origin: "attendance" })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().previewMyEventReward({ eventId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().previewMyRewardBatch({ items: [] })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().previewMyEventRewardBatch({ items: [] })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().myWalletPromotionalValue()).rejects.toThrow(/please login/i);
  });

  it("un userId inyectado en el input del cliente no rompe el parseo ni sustituye la identidad real (zod lo descarta; el router siempre añade userId: ctx.user.id DESPUÉS del spread del input)", async () => {
    // El router hace `previewMyRewardBatch(ctx.user.id, input.items)` — el
    // input nunca declara `userId` en su schema, así que aunque el cliente lo
    // envíe, zod lo descarta antes de llegar al handler. Con items:[] la
    // llamada resuelve sin tocar la BD, así que este test verifica el
    // comportamiento real sin depender de mocks de infraestructura.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await callerAs("user", 7).previewMyRewardBatch({ items: [], userId: 999 } as any);
    expect(result).toEqual({});
  });

  it("previewMyRewardBatch/previewMyEventRewardBatch rechazan un lote por encima del tope (protección de payload — spec §30)", async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ key: `k${i}`, origin: "attendance" as const }));
    await expect(callerAs("user").previewMyRewardBatch({ items })).rejects.toThrow();
    const eventItems = Array.from({ length: 25 }, (_, i) => ({ key: `k${i}`, eventId: i + 1 }));
    await expect(callerAs("user").previewMyEventRewardBatch({ items: eventItems })).rejects.toThrow();
  });

  it("un Student (role='user') SÍ puede llegar al handler real (autoservicio, nunca requiere permiso de admin)", async () => {
    await expect(callerAs("user").previewMyReward({ origin: "attendance" })).rejects.not.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("user").previewMyRewardBatch({ items: [] })).resolves.toEqual({});
    await expect(callerAs("user").previewMyEventRewardBatch({ items: [] })).resolves.toEqual({});
  });
});

describe("tokens.myRewardForOrder — MG-02 (confirmación de compra, hecho real vs preview)", () => {
  beforeEach(() => {
    mockGetMyOrderById.mockReset();
    mockFindActiveGrantBySource.mockReset();
  });

  it("rechaza sin sesión", async () => {
    await expect(callerWithoutSession().myRewardForOrder({ orderId: 1 })).rejects.toThrow(/please login/i);
  });

  it("pedido no encontrado / no es del Student que pregunta -> NOT_FOUND, nunca revela nada de otro pedido (IDOR)", async () => {
    mockGetMyOrderById.mockResolvedValue(null);
    await expect(callerAs("user", 7).myRewardForOrder({ orderId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockFindActiveGrantBySource).not.toHaveBeenCalled();
  });

  it("pedido propio con recompensa YA concedida -> granted:true con el importe real del ledger", async () => {
    mockGetMyOrderById.mockResolvedValue({ order: { id: 1, userId: 7 }, items: [], venueId: 1 });
    mockFindActiveGrantBySource.mockResolvedValue({ ledgerId: 501, amount: 100 });
    const result = await callerAs("user", 7).myRewardForOrder({ orderId: 1 });
    expect(result).toEqual({ granted: true, amount: 100 });
    expect(mockFindActiveGrantBySource).toHaveBeenCalledWith(7, "ticket", 1);
  });

  it("pedido propio sin recompensa concedida (aún no liquidada / nunca elegible) -> granted:false, amount:null (nunca fabrica un importe)", async () => {
    mockGetMyOrderById.mockResolvedValue({ order: { id: 2, userId: 7 }, items: [], venueId: 1 });
    mockFindActiveGrantBySource.mockResolvedValue(null);
    const result = await callerAs("user", 7).myRewardForOrder({ orderId: 2 });
    expect(result).toEqual({ granted: false, amount: null });
  });
});
