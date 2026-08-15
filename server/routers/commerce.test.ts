/**
 * commerce.test.ts — SEGOLIFE VENUE & PARTNER APP (spec §21/§31, IDOR
 * CRITICAL encontrado en la auditoría de esta fase): `listByVenue`/
 * `listItems` estaban gateados únicamente por `commerce.view` (permiso
 * GLOBAL que un Venue Admin ya tiene desde la fase RBAC) SIN comprobación
 * de propiedad de venue — cualquier Venue Admin real podía pedir las
 * transacciones de OTRO venue con solo cambiar `venueId`/`transactionId`.
 * Este archivo prueba el fix (`assertVenueAuthorized`), no solo que el
 * router "rechaza sin sesión" (eso ya no basta para demostrar el gate real).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetVenueStaffAccess } = vi.hoisted(() => ({ mockGetVenueStaffAccess: vi.fn() }));
vi.mock("../segolife/benefits/venueStaffAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/benefits/venueStaffAccess")>();
  return { ...actual, getVenueStaffAccess: mockGetVenueStaffAccess };
});

const { mockListByVenue, mockListItems, mockGetTxVenueId } = vi.hoisted(() => ({
  mockListByVenue: vi.fn(),
  mockListItems: vi.fn(),
  mockGetTxVenueId: vi.fn(),
}));
vi.mock("../segolife/commerce/commerceDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/commerce/commerceDb")>();
  return {
    ...actual,
    listCommerceTransactionsByVenue: mockListByVenue,
    listCommerceTransactionItems: mockListItems,
    getCommerceTransactionVenueId: mockGetTxVenueId,
  };
});

import { commerceRouter } from "./commerce";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return commerceRouter.createCaller({ user: null } as any);
}
// role "admin" satisface el fallback legacy de commerceViewProcedure
// (permissionProcedure("commerce.view", ["admin"])) sin tocar BD real — el
// alcance por venue real de un Venue Admin lo sigue controlando por
// completo el mock de getVenueStaffAccess de abajo, independiente del rol.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(userId: number) {
  return commerceRouter.createCaller({ user: { id: userId, role: "admin" } } as any);
}

const CASANOVA = 1;
const TIA_FELISA = 2;

describe("commerce router — rechaza sin sesión", () => {
  it("listByVenue rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listByVenue({ venueId: CASANOVA })).rejects.toThrow(/please login/i);
  });
  it("listItems rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listItems({ transactionId: 1 })).rejects.toThrow(/please login/i);
  });
});

describe("commerce router — IDOR CRITICAL: Venue Admin de Casanova no puede leer transacciones de Tía Felisa", () => {
  beforeEach(() => {
    mockGetVenueStaffAccess.mockReset();
    mockListByVenue.mockReset();
    mockListItems.mockReset();
    mockGetTxVenueId.mockReset();
    // Venue Admin real: solo tiene fila venue_staff activa para Casanova.
    mockGetVenueStaffAccess.mockResolvedValue([CASANOVA]);
  });

  it("listByVenue de SU propio venue (Casanova): permitido", async () => {
    mockListByVenue.mockResolvedValue([{ id: 1, venueId: CASANOVA }]);
    const result = await callerAs(10).listByVenue({ venueId: CASANOVA });
    expect(result).toEqual([{ id: 1, venueId: CASANOVA }]);
    expect(mockListByVenue).toHaveBeenCalledWith(CASANOVA);
  });

  it("listByVenue de OTRO venue (Tía Felisa) cambiando venueId en el input: DENEGADO, nunca llega a leer la BD", async () => {
    await expect(callerAs(10).listByVenue({ venueId: TIA_FELISA })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockListByVenue).not.toHaveBeenCalled();
  });

  it("listItems de una transacción de OTRO venue manipulando transactionId: DENEGADO — el venueId se resuelve del lado servidor, nunca se confía en uno del cliente", async () => {
    mockGetTxVenueId.mockResolvedValue(TIA_FELISA);
    await expect(callerAs(10).listItems({ transactionId: 999 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockListItems).not.toHaveBeenCalled();
  });

  it("listItems de una transacción inexistente: NOT_FOUND, no FORBIDDEN (no confirma ni niega autorización sobre algo que no existe)", async () => {
    mockGetTxVenueId.mockResolvedValue(null);
    await expect(callerAs(10).listItems({ transactionId: 424242 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("admin global ('all'): puede leer cualquier venue", async () => {
    mockGetVenueStaffAccess.mockResolvedValue("all");
    mockListByVenue.mockResolvedValue([]);
    await expect(callerAs(1).listByVenue({ venueId: TIA_FELISA })).resolves.toEqual([]);
  });
});
