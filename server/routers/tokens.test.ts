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
import { describe, it, expect } from "vitest";
import { tokensRouter } from "./tokens";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return tokensRouter.createCaller({ user: null } as any);
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

describe("tokens router — autoservicio del estudiante (nunca público) rechaza sin sesión", () => {
  it("tokens.getMyWallet rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getMyWallet()).rejects.toThrow(/please login/i);
  });
  it("tokens.listMyLedger rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listMyLedger({ limit: 20, offset: 0 })).rejects.toThrow(/please login/i);
  });
});
