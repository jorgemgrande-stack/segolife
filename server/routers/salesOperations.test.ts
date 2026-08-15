/**
 * salesOperations.test.ts — SEGOLIFE COMMERCE CORE (Fase 9, spec §80/§85).
 * RBAC/IDOR: "Ventas y Operaciones" es GLOBAL_ADMIN exclusivamente — Venue
 * Admin sigue confinado a Venue App con sus propios datos acotados (spec
 * §80), nunca esta superficie global. Mismo criterio de middleware-rechaza-
 * antes-de-BD que community.test.ts/referrals.test.ts.
 */
import { describe, it, expect } from "vitest";
import { salesOperationsRouter } from "./salesOperations";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return salesOperationsRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(role: string, id = 1) {
  return salesOperationsRouter.createCaller({ user: { id, role } } as any);
}

describe("salesOperations router — nunca accesible sin sesión", () => {
  it("listSales/overview/dailyOperations/operationalCalendar/eventOperationsDetail/listRefunds rechazan sin sesión", async () => {
    await expect(callerWithoutSession().listSales({})).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().overview({ from: new Date(), to: new Date() })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().dailyOperations({})).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().operationalCalendar({ fromDate: "2026-08-01", toDate: "2026-08-31" })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().eventOperationsDetail({ eventId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().listRefunds({})).rejects.toThrow(/please login/i);
  });
});

describe("salesOperations router — #38/#80 Venue Admin nunca ve la superficie global (spec §80, VENUE_ADMIN_FORBIDDEN_MODULES incluye 'sales')", () => {
  it("venue_admin recibe FORBIDDEN en todas las queries", async () => {
    await expect(callerAs("venue_admin").listSales({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("venue_admin").overview({ from: new Date(), to: new Date() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("venue_admin").dailyOperations({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("venue_admin").listRefunds({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un Student (role='user') tampoco puede ver Ventas y Operaciones global", async () => {
    await expect(callerAs("user").listSales({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("salesOperations router — #38 GLOBAL_ADMIN llega al handler real (middleware no lo bloquea)", () => {
  it("admin no recibe FORBIDDEN/UNAUTHORIZED en listSales", async () => {
    await expect(callerAs("admin").listSales({})).rejects.not.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("admin").listSales({})).rejects.not.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
