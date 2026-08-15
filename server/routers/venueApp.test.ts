/**
 * venueApp.test.ts — SEGOLIFE VENUE & PARTNER APP (spec §31, IDOR HARD
 * GATE). `today`/`studentCard` reciben `venueId` explícito en el input —
 * exactamente el patrón que spec §31 exige testear: "manipulate venueId —
 * server must validate relationships". `studentCard` además prueba que
 * NUNCA acepta un userId en crudo (spec §30): solo re-resolviendo el mismo
 * token escaneado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// today/studentCard llaman a requireVenueAccess (que a su vez llama a
// getVenueStaffAccess por referencia INTERNA al módulo — mockear solo
// getVenueStaffAccess no la intercepta). myAuthorizedVenues sí llama a
// getVenueStaffAccess directamente (cross-module), así que se mockean
// ambas por separado, cada una controlando su propio caller.
const { mockGetVenueStaffAccess, mockRequireVenueAccess } = vi.hoisted(() => ({
  mockGetVenueStaffAccess: vi.fn(),
  mockRequireVenueAccess: vi.fn(),
}));
vi.mock("../segolife/benefits/venueStaffAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/benefits/venueStaffAccess")>();
  return { ...actual, getVenueStaffAccess: mockGetVenueStaffAccess, requireVenueAccess: mockRequireVenueAccess };
});

const { mockToday, mockStudentCard } = vi.hoisted(() => ({ mockToday: vi.fn(), mockStudentCard: vi.fn() }));
vi.mock("../segolife/venues/venueAppService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/venues/venueAppService")>();
  return { ...actual, getVenueTodaySnapshot: mockToday, getVenueStudentCard: mockStudentCard };
});

const { mockLookupByToken } = vi.hoisted(() => ({ mockLookupByToken: vi.fn() }));
vi.mock("../segolife/commerce/studentIdentityService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/commerce/studentIdentityService")>();
  return { ...actual, lookupStudentByIdentityToken: mockLookupByToken };
});

import { venueAppRouter } from "./venueApp";

const CASANOVA = 1;
const TIA_FELISA = 2;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return venueAppRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(userId: number) {
  return venueAppRouter.createCaller({ user: { id: userId, role: "venue_admin" } } as any);
}

describe("venueApp router — rechaza sin sesión", () => {
  it("myAuthorizedVenues rechaza sin sesión", async () => {
    await expect(callerWithoutSession().myAuthorizedVenues()).rejects.toThrow(/please login/i);
  });
  it("today rechaza sin sesión", async () => {
    await expect(callerWithoutSession().today({ venueId: CASANOVA })).rejects.toThrow(/please login/i);
  });
  it("studentCard rechaza sin sesión", async () => {
    await expect(callerWithoutSession().studentCard({ venueId: CASANOVA, token: "a".repeat(20) })).rejects.toThrow(/please login/i);
  });
});

describe("venueApp router — IDOR: Venue Admin de Casanova no puede operar Tía Felisa manipulando venueId", () => {
  const ALLOWED = [CASANOVA];

  beforeEach(() => {
    mockGetVenueStaffAccess.mockReset();
    mockRequireVenueAccess.mockReset();
    mockToday.mockReset();
    mockStudentCard.mockReset();
    mockLookupByToken.mockReset();
    mockRequireVenueAccess.mockImplementation(async (_userId: number, _role: string, venueId: number) => {
      if (!ALLOWED.includes(venueId)) throw new TRPCError({ code: "FORBIDDEN", message: "Sin acceso a este venue" });
    });
  });

  it("today de su propio venue: permitido", async () => {
    mockToday.mockResolvedValue({ currentEvent: null, nextEvent: null, checkInsToday: 0, uniqueStudentsToday: 0, recentActivity: [] });
    await expect(callerAs(10).today({ venueId: CASANOVA })).resolves.toBeTruthy();
  });

  it("today de OTRO venue: DENEGADO, nunca llega a componer el snapshot", async () => {
    await expect(callerAs(10).today({ venueId: TIA_FELISA })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockToday).not.toHaveBeenCalled();
  });

  it("studentCard de OTRO venue: DENEGADO antes de resolver el token", async () => {
    await expect(callerAs(10).studentCard({ venueId: TIA_FELISA, token: "a".repeat(20) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockLookupByToken).not.toHaveBeenCalled();
  });

  it("studentCard con un token que no resuelve a ningún Student: NOT_FOUND, nunca compone la ficha", async () => {
    mockLookupByToken.mockResolvedValue(null);
    await expect(callerAs(10).studentCard({ venueId: CASANOVA, token: "a".repeat(20) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockStudentCard).not.toHaveBeenCalled();
  });

  it("studentCard resuelve SIEMPRE el userId a partir del token escaneado, nunca de un id enviado por el cliente (spec §30)", async () => {
    mockLookupByToken.mockResolvedValue({ userId: 777, name: "Ana" });
    mockStudentCard.mockResolvedValue({ userId: 777, name: "Ana", communities: [], checkedInToday: false, walletBalance: 0, benefitsHere: [], recentActivityHere: [] });
    await callerAs(10).studentCard({ venueId: CASANOVA, token: "a".repeat(20) });
    expect(mockStudentCard).toHaveBeenCalledWith(777, CASANOVA);
  });
});
