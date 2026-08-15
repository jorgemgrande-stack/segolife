/**
 * venues.test.ts — RBAC a nivel de router (Fase 1D). Mismo patrón que
 * server/routers/students.test.ts: los procedures admin exigen sesión +
 * permiso `venues.view`/`venues.manage` (permissionProcedure), así que
 * rechazan ANTES de tocar la BD — se puede probar con `ctx.user = null` sin
 * mockear nada más. Los procedures `public*` son publicProcedure a propósito
 * (usados por /ie, /uva) y no se prueban aquí — no exigen sesión, así que no
 * hay nada de RBAC que verificar a este nivel.
 *
 * `getMyVenueById` (VENUE & PARTNER APP, spec §21) usa protectedProcedure +
 * requireVenueAccess en vez de permissionProcedure — se prueba aparte abajo,
 * con IDOR real (venueId manipulado), no solo "rechaza sin sesión".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// requireVenueAccess llama a getVenueStaffAccess por referencia INTERNA al
// mismo módulo — mockear solo getVenueStaffAccess no intercepta esa llamada
// (vi.mock no reescribe referencias léxicas dentro del propio módulo). Se
// mockea requireVenueAccess directamente, que es lo que venues.ts importa y
// llama de verdad.
const { mockRequireVenueAccess } = vi.hoisted(() => ({ mockRequireVenueAccess: vi.fn() }));
vi.mock("../segolife/benefits/venueStaffAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/benefits/venueStaffAccess")>();
  return { ...actual, requireVenueAccess: mockRequireVenueAccess };
});

const { mockGetVenueById } = vi.hoisted(() => ({ mockGetVenueById: vi.fn() }));
vi.mock("../db/venuesDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/venuesDb")>();
  return { ...actual, getVenueById: mockGetVenueById };
});

import { venuesRouter } from "./venues";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return venuesRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(userId: number) {
  return venuesRouter.createCaller({ user: { id: userId, role: "venue_admin" } } as any);
}

describe("venues router — endpoints admin (nunca públicos) rechazan sin sesión", () => {
  it("venues.list rechaza sin sesión", async () => {
    await expect(callerWithoutSession().list({ limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });

  it("venues.getById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getById({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("venues.listCategories rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listCategories()).rejects.toThrow(/please login/i);
  });

  it("venues.create rechaza sin sesión", async () => {
    await expect(
      callerWithoutSession().create({ name: "Café Central", slug: "cafe-central", communityIds: [] })
    ).rejects.toThrow(/please login/i);
  });

  it("venues.update rechaza sin sesión", async () => {
    await expect(callerWithoutSession().update({ id: 1, name: "Nuevo nombre" })).rejects.toThrow(/please login/i);
  });

  it("venues.setActive rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setActive({ id: 1, active: false })).rejects.toThrow(/please login/i);
  });

  it("venues.setCommunities rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setCommunities({ id: 1, communityIds: [1] })).rejects.toThrow(/please login/i);
  });

  it("venues.createCategory rechaza sin sesión", async () => {
    await expect(callerWithoutSession().createCategory({ name: "Bar", slug: "bar" })).rejects.toThrow(/please login/i);
  });

  it("venues.getMyVenueById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getMyVenueById({ id: 1 })).rejects.toThrow(/please login/i);
  });
});

describe("venues.getMyVenueById — IDOR: Venue Admin de Casanova no puede leer Tía Felisa cambiando el id", () => {
  const ALLOWED = [1]; // solo Casanova (id=1)

  beforeEach(() => {
    mockRequireVenueAccess.mockReset();
    mockGetVenueById.mockReset();
    mockRequireVenueAccess.mockImplementation(async (_userId: number, _role: string, venueId: number) => {
      if (!ALLOWED.includes(venueId)) throw new TRPCError({ code: "FORBIDDEN", message: "Sin acceso a este venue" });
    });
  });

  it("su propio venue: permitido", async () => {
    mockGetVenueById.mockResolvedValue({ venue: { id: 1, name: "Casanova" }, category: null, communities: [] });
    await expect(callerAs(10).getMyVenueById({ id: 1 })).resolves.toBeTruthy();
  });

  it("otro venue (Tía Felisa, id=2): DENEGADO, nunca llega a leer la BD", async () => {
    await expect(callerAs(10).getMyVenueById({ id: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockGetVenueById).not.toHaveBeenCalled();
  });
});
