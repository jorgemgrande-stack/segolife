/**
 * legacyTourismModuleGating.test.ts — PRE-16.16 (§8/§56, decommission por
 * flag). hotel.ts/spa.ts/restaurants.ts (hotel/spa/restaurantes heredados
 * de Náyade, sin aplicación al producto real de Segolife) ya tenían
 * `assertModuleEnabled` en sus procedures ADMIN, pero nunca en los públicos
 * — el nav oculta el enlace, pero cualquiera con la URL/schema tRPC podía
 * seguir creando reservas reales (con cargo vía Redsys en algunos flujos)
 * aunque el flag correspondiente esté a 0 en producción (confirmado por
 * lectura directa de la BD). Este test prueba el invariante real: con el
 * flag desactivado (el estado real de producción hoy), el procedure
 * público rechaza ANTES de tocar la base de datos — nunca llega al
 * resolver, así que no hace falta mockear hotelDb/spaDb/restaurantsDb.
 *
 * En este entorno de test no hay conexión real a BD — getFeatureFlag()
 * cae a su fallback (false) igual que en producción con el flag en 0,
 * así que no hace falta mockear nada más para probar el camino "módulo
 * desactivado, procedure público rechaza".
 */
import { describe, it, expect } from "vitest";
import { hotelRouter } from "./hotel";
import { spaRouter } from "./spa";
import { restaurantsRouter } from "./restaurants";
import { crmRouter } from "./crm";
import { commercialFollowupRouter } from "./commercialFollowup";
import { proposalsRouter } from "./proposals";
import { tpvRouter } from "./tpv";
import { cancellationsRouter } from "./cancellations";

function anonCaller<T extends { createCaller: (ctx: unknown) => unknown }>(router: T) {
  return router.createCaller({ user: null }) as ReturnType<T["createCaller"]>;
}

function adminCaller<T extends { createCaller: (ctx: unknown) => unknown }>(router: T) {
  return router.createCaller({ user: { id: 1, role: "admin" } }) as ReturnType<T["createCaller"]>;
}

describe("hotel.ts — procedures públicos rechazan con hotel_module_enabled desactivado", () => {
  it("getRoomTypes rechaza FORBIDDEN sin tocar hotelDb", async () => {
    await expect((anonCaller(hotelRouter) as any).getRoomTypes()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("searchAvailability (usado antes de crear una reserva real) rechaza FORBIDDEN", async () => {
    await expect((anonCaller(hotelRouter) as any).searchAvailability({
      checkIn: "2026-09-01", checkOut: "2026-09-03", adults: 2, children: 0,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("createHotelBooking (generaría un formulario Redsys real) rechaza FORBIDDEN antes de calcular ningún precio", async () => {
    await expect((anonCaller(hotelRouter) as any).createHotelBooking({
      roomTypeId: 1, checkIn: "2026-09-01", checkOut: "2026-09-03",
      adults: 2, children: 0, customerName: "Test", customerEmail: "test@example.com",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("spa.ts — procedures públicos rechazan con spa_module_enabled desactivado", () => {
  it("getTreatments rechaza FORBIDDEN sin tocar spaDb", async () => {
    await expect((anonCaller(spaRouter) as any).getTreatments({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("createSpaBooking (generaría un formulario Redsys real) rechaza FORBIDDEN", async () => {
    await expect((anonCaller(spaRouter) as any).createSpaBooking({
      treatmentId: 1, date: "2026-09-01", time: "10:00", people: 1,
      customerName: "Test", customerEmail: "test@example.com",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("restaurants.ts — procedures públicos rechazan con restaurants_module_enabled desactivado (sin gate previo, añadido en PRE-16.16)", () => {
  it("getAll rechaza FORBIDDEN sin tocar restaurantsDb", async () => {
    await expect((anonCaller(restaurantsRouter) as any).getAll()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("createBooking (generaría un cargo de depósito real vía Redsys) rechaza FORBIDDEN", async () => {
    await expect((anonCaller(restaurantsRouter) as any).createBooking({
      restaurantId: 1, shiftId: 1, date: "2026-09-01", time: "20:00", guests: 2,
      guestName: "Test", guestEmail: "test@example.com", guestPhone: "600000000",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("crm.ts — router heredado (leads/presupuestos/reservas/facturas) rechaza con crm_module_enabled desactivado", () => {
  it("leads.list (admin/staff) rechaza FORBIDDEN sin tocar la BD", async () => {
    await expect((adminCaller(crmRouter) as any).leads.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("quotes.getByToken (público, backend de QuoteAcceptance.tsx) rechaza FORBIDDEN — coherente con que staff no puede crear presupuestos nuevos", async () => {
    await expect((anonCaller(crmRouter) as any).quotes.getByToken({ token: "a".repeat(20) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("commercialFollowup.ts — Atención Comercial (GHL, sin credenciales reales) rechaza con crm_module_enabled desactivado", () => {
  it("getDashboard rechaza FORBIDDEN", async () => {
    await expect((adminCaller(commercialFollowupRouter) as any).getDashboard()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("proposals.ts — Propuestas Comerciales rechaza con crm_module_enabled desactivado", () => {
  it("list (staff) rechaza FORBIDDEN", async () => {
    await expect((adminCaller(proposalsRouter) as any).list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("getByToken (público, backend de ProposalView.tsx) rechaza FORBIDDEN", async () => {
    await expect((anonCaller(proposalsRouter) as any).getByToken({ token: "a".repeat(20) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("tpv.ts — TPV físico heredado (paralelo al Venue Bar POS real) rechaza con tpv_enabled desactivado", () => {
  it("getRegisters rechaza FORBIDDEN sin tocar la BD — evita doble contabilidad frente al POS real", async () => {
    await expect((adminCaller(tpvRouter) as any).getRegisters()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("cancellations.ts — solicitud pública de anulación rechaza con cancellations_module_enabled desactivado", () => {
  it("createRequest (público, backend de SolicitarAnulacion.tsx) rechaza FORBIDDEN", async () => {
    await expect((anonCaller(cancellationsRouter) as any).createRequest({
      fullName: "Test", activityDate: "2026-09-01", reason: "desistimiento", termsChecked: true,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
