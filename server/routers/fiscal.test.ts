/**
 * fiscal.test.ts — SEGOLIFE FASE 10 (spec §5/§83/§86). RBAC: "Facturación"
 * es GLOBAL_ADMIN exclusivo — Venue Admin nunca ve/gestiona entidades
 * fiscales, tipos de IVA ni documentos, ni siquiera de su propio venue
 * (spec "fiscal"/"settlements" añadidos a VENUE_ADMIN_FORBIDDEN_MODULES).
 * Mismo criterio de middleware-rechaza-antes-de-BD que salesOperations.test.ts.
 */
import { describe, it, expect } from "vitest";
import { fiscalRouter } from "./fiscal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return fiscalRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(role: string, id = 1) {
  return fiscalRouter.createCaller({ user: { id, role } } as any);
}

describe("fiscal router — nunca accesible sin sesión", () => {
  it("listEntities/listTaxRates/listSeries/listDocuments rechazan sin sesión", async () => {
    await expect(callerWithoutSession().listEntities()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().listTaxRates()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().listSeries({})).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().listDocuments({})).rejects.toThrow(/please login/i);
  });

  it("myBillingProfile/myDocuments (Student self-service) también rechazan sin sesión", async () => {
    await expect(callerWithoutSession().myBillingProfile()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().myDocuments()).rejects.toThrow(/please login/i);
  });
});

describe("fiscal router — Venue Admin/Student nunca acceden a configuración fiscal global (spec §5/§83/§86)", () => {
  it("venue_admin recibe FORBIDDEN en todas las queries/mutations de configuración", async () => {
    await expect(callerAs("venue_admin").listEntities()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("venue_admin").listTaxRates()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("venue_admin").upsertEntity({ legalName: "X", taxId: "Y" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("venue_admin").issueInvoice({ sourceType: "commerce_transaction", sourceId: 1, seriesId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un Student (role='user') tampoco puede ver/gestionar Facturación global", async () => {
    await expect(callerAs("user").listEntities()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("user").setVenueSellerConfig({ venueId: 1, sellerEntityId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("fiscal router — GLOBAL_ADMIN llega al handler real (middleware no lo bloquea)", () => {
  it("admin no recibe FORBIDDEN/UNAUTHORIZED en listEntities", async () => {
    await expect(callerAs("admin").listEntities()).rejects.not.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("admin").listEntities()).rejects.not.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("fiscal router — Student self-service, ownership server-side (spec §25)", () => {
  it("myDocument nunca confía en un id ajeno — Student solo ve SU documento (verificado a nivel de servicio, aquí solo confirmamos que la ruta exige sesión propia)", async () => {
    await expect(callerAs("user", 42).myDocument({ id: 999 })).rejects.not.toMatchObject({ code: "FORBIDDEN" });
  });
});
