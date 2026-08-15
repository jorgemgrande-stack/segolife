/**
 * settlements.test.ts — SEGOLIFE FASE 10 (spec §69/§83). RBAC: Liquidaciones
 * es GLOBAL_ADMIN exclusivo por completo (a diferencia de stock/cash, aquí
 * ni siquiera venue_admin tiene acceso — spec §69 "no implementado en esta
 * fase", "settlements" en VENUE_ADMIN_FORBIDDEN_MODULES).
 */
import { describe, it, expect } from "vitest";
import { venueSettlementsRouter } from "./settlements";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return venueSettlementsRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(role: string, id = 1) {
  return venueSettlementsRouter.createCaller({ user: { id, role } } as any);
}

describe("venueSettlements router — nunca accesible sin sesión", () => {
  it("list/listAgreements rechazan sin sesión", async () => {
    await expect(callerWithoutSession().list({})).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().listAgreements({})).rejects.toThrow(/please login/i);
  });
});

describe("venueSettlements router — Venue Admin/Student nunca acceden (spec §69, exclusivo GLOBAL_ADMIN)", () => {
  it("venue_admin recibe FORBIDDEN en todas las queries/mutations", async () => {
    await expect(callerAs("venue_admin").list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("venue_admin").listAgreements({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("venue_admin").calculate({ venueId: 1, periodStart: new Date(), periodEnd: new Date() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un Student (role='user') tampoco puede ver liquidaciones", async () => {
    await expect(callerAs("user").list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("venueSettlements router — GLOBAL_ADMIN llega al handler real (middleware no lo bloquea)", () => {
  it("admin no recibe FORBIDDEN/UNAUTHORIZED en list", async () => {
    await expect(callerAs("admin").list({})).rejects.not.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("admin").list({})).rejects.not.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
