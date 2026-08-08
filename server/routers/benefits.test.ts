/**
 * benefits.test.ts — RBAC a nivel de router (Fase 4). Mismo patrón que
 * server/routers/consumptionQr.test.ts (Fase 3): todos los procedures
 * (admin, staff y autoservicio del estudiante) exigen sesión —
 * protectedProcedure/permissionProcedure rechazan ANTES de tocar la BD, así
 * que se prueban con `ctx.user = null` sin mockear nada más.
 * `staffRedeem`/`myBenefits`/`getMyBenefit` están explícitamente marcados
 * como PROTEGIDOS en el roadmap (nunca públicos) — se verifican aquí igual
 * que el resto (ver server/authGuard.ts, bug de Fase 1D).
 */
import { describe, it, expect } from "vitest";
import { benefitsRouter } from "./benefits";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return benefitsRouter.createCaller({ user: null } as any);
}

describe("benefits router — definiciones (admin) rechazan sin sesión", () => {
  it("benefits.listDefinitions rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listDefinitions()).rejects.toThrow(/please login/i);
  });
  it("benefits.getDefinitionById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getDefinitionById({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("benefits.createDefinition rechaza sin sesión", async () => {
    await expect(callerWithoutSession().createDefinition({
      name: "x", slug: "x", benefitType: "free_entry",
    } as any)).rejects.toThrow(/please login/i);
  });
  it("benefits.updateDefinition rechaza sin sesión", async () => {
    await expect(callerWithoutSession().updateDefinition({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("benefits.setDefinitionActive rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setDefinitionActive({ id: 1, active: true })).rejects.toThrow(/please login/i);
  });
  it("benefits.setDefinitionCommunities rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setDefinitionCommunities({ id: 1, communityIds: [] })).rejects.toThrow(/please login/i);
  });
});

describe("benefits router — reglas (admin) rechazan sin sesión", () => {
  it("benefits.listRules rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listRules()).rejects.toThrow(/please login/i);
  });
  it("benefits.getRuleById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getRuleById({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("benefits.createRule rechaza sin sesión", async () => {
    await expect(callerWithoutSession().createRule({
      name: "x", sourceType: "consumption", benefitDefinitionId: 1,
    } as any)).rejects.toThrow(/please login/i);
  });
  it("benefits.updateRule rechaza sin sesión", async () => {
    await expect(callerWithoutSession().updateRule({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("benefits.setRuleActive rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setRuleActive({ id: 1, active: true })).rejects.toThrow(/please login/i);
  });
});

describe("benefits router — concedidos (admin) rechazan sin sesión", () => {
  it("benefits.listGrants rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listGrants({ limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });
  it("benefits.manualGrant rechaza sin sesión", async () => {
    await expect(callerWithoutSession().manualGrant({
      userId: 1, benefitDefinitionId: 1, validFrom: new Date(), reason: "x",
    })).rejects.toThrow(/please login/i);
  });
  it("benefits.cancelGrant rechaza sin sesión", async () => {
    await expect(callerWithoutSession().cancelGrant({ userBenefitId: 1, reason: "x" })).rejects.toThrow(/please login/i);
  });
  it("benefits.listRedemptionAttempts rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listRedemptionAttempts({ limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });
});

describe("benefits router — asignación de staff a venue (admin) rechaza sin sesión", () => {
  it("benefits.listVenueStaff rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listVenueStaff({})).rejects.toThrow(/please login/i);
  });
  it("benefits.addVenueStaff rechaza sin sesión", async () => {
    await expect(callerWithoutSession().addVenueStaff({ userId: 1, venueId: 1 })).rejects.toThrow(/please login/i);
  });
  it("benefits.removeVenueStaff rechaza sin sesión", async () => {
    await expect(callerWithoutSession().removeVenueStaff({ userId: 1, venueId: 1 })).rejects.toThrow(/please login/i);
  });
});

describe("benefits router — 'Mis Beneficios' del estudiante (nunca público) rechaza sin sesión", () => {
  it("benefits.myBenefits rechaza sin sesión", async () => {
    await expect(callerWithoutSession().myBenefits()).rejects.toThrow(/please login/i);
  });
  it("benefits.getMyBenefit rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getMyBenefit({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("benefits.myAuthorizedVenues rechaza sin sesión", async () => {
    await expect(callerWithoutSession().myAuthorizedVenues()).rejects.toThrow(/please login/i);
  });
});

describe("benefits router — validación en puerta del staff (nunca público) rechaza sin sesión", () => {
  it("benefits.staffRedeem rechaza sin sesión — endpoint PROTEGIDO, nunca público", async () => {
    await expect(callerWithoutSession().staffRedeem({ token: "0123456789abcdef", venueId: 1 })).rejects.toThrow(/please login/i);
  });
});
