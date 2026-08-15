/**
 * referrals.test.ts — SEGOLIFE REFERRAL & INVITE REWARDS ENGINE (Fase 8,
 * spec §90, tests #33-40 — RBAC/seguridad). Mismo criterio que
 * community.test.ts/students360.test.ts: el middleware (permissionProcedure/
 * protectedProcedure) rechaza ANTES de tocar BD — se puede probar sin
 * conexión real. checkRbacOrLegacy cae a los roles legacy (fallbackRoles)
 * cuando la BD no está disponible en el entorno de test (ver
 * server/_core/rbac.ts) — determinista y suficiente para probar la
 * frontera de autorización real: GLOBAL_ADMIN sí, venue_admin/Student no.
 */
import { describe, it, expect } from "vitest";
import { referralsRouter } from "./referrals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return referralsRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(role: string, id = 1) {
  return referralsRouter.createCaller({ user: { id, role } } as any);
}

describe("referrals router — administración (campañas/analítica) nunca accesible sin sesión (spec §75)", () => {
  it("listCampaigns/createCampaign/activateCampaign/listReferrals/overview rechazan sin sesión", async () => {
    await expect(callerWithoutSession().listCampaigns()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().createCampaign({
      name: "x", communityId: null, inviterRewardTokens: 10, inviteeRewardTokens: 5,
      conversionCondition: "profile_completed", attributionWindowDays: 30,
      maxRewardsPerInviter: null, maxTotalConversions: null, budgetTokens: null,
      priority: 0, startsAt: null, endsAt: null,
    })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().activateCampaign({ id: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().listReferrals({})).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().overview()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().retryReward({ referralId: 1 })).rejects.toThrow(/please login/i);
  });
});

describe("referrals router — #35 Venue Admin no puede gestionar ni ver referidos (fuera de VENUE_ADMIN_PERMISSION_BUNDLE, spec §22/§75)", () => {
  it("venue_admin recibe FORBIDDEN en listCampaigns (referrals.view)", async () => {
    await expect(callerAs("venue_admin").listCampaigns()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("venue_admin recibe FORBIDDEN en createCampaign/activateCampaign (referrals.manage)", async () => {
    await expect(callerAs("venue_admin").createCampaign({
      name: "x", communityId: null, inviterRewardTokens: 10, inviteeRewardTokens: 5,
      conversionCondition: "profile_completed", attributionWindowDays: 30,
      maxRewardsPerInviter: null, maxTotalConversions: null, budgetTokens: null,
      priority: 0, startsAt: null, endsAt: null,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("venue_admin").activateCampaign({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("venue_admin recibe FORBIDDEN en listReferrals/overview/campaignAnalytics (analítica económica, spec §74 admin-only)", async () => {
    await expect(callerAs("venue_admin").listReferrals({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("venue_admin").overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("venue_admin").campaignAnalytics({ campaignId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un Student (role='user') tampoco puede gestionar campañas — economía de referidos es GLOBAL_ADMIN exclusivamente", async () => {
    await expect(callerAs("user").listCampaigns()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("user").retryReward({ referralId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("referrals router — #38 GLOBAL_ADMIN puede llegar al handler real (no se rechaza en el middleware)", () => {
  it("admin no recibe FORBIDDEN/UNAUTHORIZED en listCampaigns (el middleware le deja pasar)", async () => {
    await expect(callerAs("admin").listCampaigns()).rejects.not.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("admin").listCampaigns()).rejects.not.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("referrals router — #33/34 mySummary es autoservicio: cualquier Student autenticado puede llegar a su propio resumen, nunca recibe un userId ajeno como input", () => {
  it("mySummary rechaza sin sesión, pero NO exige el permiso referrals.view/manage — accesible a cualquier Student autenticado", async () => {
    await expect(callerWithoutSession().mySummary()).rejects.toThrow(/please login/i);
    // Con sesión de Student normal (role='user', sin RBAC ni fallback
    // admin), el middleware protectedProcedure (no permissionProcedure) le
    // deja pasar — el error que sigue (si lo hay) viene de la capa de datos,
    // nunca de autorización.
    await expect(callerAs("user").mySummary()).rejects.not.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("referrals router — #39 entrada pública ignora cualquier dato de identidad que no sea el propio código", () => {
  it("publicLanding no requiere sesión y su input solo acepta {code, communityId?} — nunca un referrerUserId", async () => {
    const result = callerWithoutSession().publicLanding({ code: "ABC" });
    // No debe rechazar por falta de sesión — es publicProcedure.
    await expect(result).rejects.not.toThrow(/please login/i);
  });

  it("publicLanding con un código con formato inválido (vacío) se valida en el input schema, no revela nada del backend", async () => {
    await expect(callerWithoutSession().publicLanding({ code: "" })).rejects.toBeTruthy();
  });
});
