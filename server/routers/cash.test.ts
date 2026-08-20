/**
 * cash.test.ts — SEGOLIFE FASE 10 (spec §44-53/§85). RBAC: cash.view/
 * cash.operate son operativa de venue (venue_admin/staff vía rol RBAC
 * `staff`) — cash.manage reservado para uso futuro, GLOBAL_ADMIN exclusivo.
 */
import { describe, it, expect } from "vitest";
import { cashRouter } from "./cash";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return cashRouter.createCaller({ user: null } as any);
}
// id fuera de rango real (999999): nunca colisiona con un usuario sembrado
// en la BD local con roles RBAC reales ya asignados (checkRbacOrLegacy
// resuelve por RBAC real si el id coincide, ignorando el `role` fabricado
// aquí) — mismo fix que server/nayade.test.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(role: string, id = 999999) {
  return cashRouter.createCaller({ user: { id, role } } as any);
}

describe("cash router — nunca accesible sin sesión", () => {
  it("currentSession/history rechazan sin sesión", async () => {
    await expect(callerWithoutSession().currentSession({ venueId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().history({ venueId: 1 })).rejects.toThrow(/please login/i);
  });
});

describe("cash router — Student nunca accede a operativa de caja", () => {
  it("un Student (role='user') recibe FORBIDDEN", async () => {
    await expect(callerAs("user").currentSession({ venueId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("user").openSession({ venueId: 1, openingCashCents: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("cash router — GLOBAL_ADMIN llega al handler real (middleware no lo bloquea)", () => {
  it("admin no recibe FORBIDDEN/UNAUTHORIZED en currentSession", async () => {
    await expect(callerAs("admin").currentSession({ venueId: 1 })).rejects.not.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("admin").currentSession({ venueId: 1 })).rejects.not.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
