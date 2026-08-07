/**
 * events.test.ts — RBAC a nivel de router (Fase 1D). Mismo patrón que
 * server/routers/venues.test.ts / students.test.ts: los procedures admin
 * exigen sesión + permiso `events.view`/`events.manage` (permissionProcedure),
 * así que rechazan ANTES de tocar la BD. Los procedures `public*` (usados por
 * /ie, /uva) son publicProcedure a propósito y no se prueban aquí.
 */
import { describe, it, expect } from "vitest";
import { eventsRouter } from "./events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return eventsRouter.createCaller({ user: null } as any);
}

describe("events router — endpoints admin (nunca públicos) rechazan sin sesión", () => {
  it("events.list rechaza sin sesión", async () => {
    await expect(callerWithoutSession().list({ limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });

  it("events.getById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getById({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("events.create rechaza sin sesión", async () => {
    await expect(
      callerWithoutSession().create({
        name: "Fiesta de bienvenida", slug: "fiesta-de-bienvenida",
        startsAt: new Date("2026-09-15T20:00:00Z"), communityIds: [],
      })
    ).rejects.toThrow(/please login/i);
  });

  it("events.update rechaza sin sesión", async () => {
    await expect(callerWithoutSession().update({ id: 1, name: "Nuevo nombre" })).rejects.toThrow(/please login/i);
  });

  it("events.setActive rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setActive({ id: 1, active: false })).rejects.toThrow(/please login/i);
  });

  it("events.setFeatured rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setFeatured({ id: 1, featured: true })).rejects.toThrow(/please login/i);
  });

  it("events.setCommunities rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setCommunities({ id: 1, communityIds: [1] })).rejects.toThrow(/please login/i);
  });
});
