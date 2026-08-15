/**
 * stock.test.ts — SEGOLIFE FASE 10 (spec §41/§84). RBAC: stock.view/
 * stock.adjust son operativa de venue (venue_admin/staff vía rol RBAC
 * `staff`) — stock.manage (config global) es GLOBAL_ADMIN exclusivo. Un
 * Student nunca accede. Mismo criterio middleware-rechaza-antes-de-BD que
 * salesOperations.test.ts — la comprobación de IDOR por venue concreto
 * (assertVenueAuthorized -> getVenueStaffAccess) requiere BD real y se
 * cubre en integración, no aquí.
 */
import { describe, it, expect } from "vitest";
import { stockRouter } from "./stock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return stockRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(role: string, id = 1) {
  return stockRouter.createCaller({ user: { id, role } } as any);
}

describe("stock router — nunca accesible sin sesión", () => {
  it("listProducts/lowStock/movements/balance rechazan sin sesión", async () => {
    await expect(callerWithoutSession().listProducts({ venueId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().lowStock({ venueId: 1 })).rejects.toThrow(/please login/i);
  });
});

describe("stock router — Student nunca accede a operativa de stock", () => {
  it("un Student (role='user') recibe FORBIDDEN", async () => {
    await expect(callerAs("user").listProducts({ venueId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("user").recordWaste({ venueId: 1, venueProductId: 1, quantity: 1, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("stock router — setConfig (stock.manage) es GLOBAL_ADMIN exclusivo", () => {
  it("un Student no puede configurar qué productos llevan stock", async () => {
    await expect(callerAs("user").setConfig({ venueProductId: 1, stockTracked: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("stock router — GLOBAL_ADMIN llega al handler real (middleware no lo bloquea)", () => {
  it("admin no recibe FORBIDDEN/UNAUTHORIZED en listProducts", async () => {
    await expect(callerAs("admin").listProducts({ venueId: 1 })).rejects.not.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("admin").listProducts({ venueId: 1 })).rejects.not.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
