/**
 * venues.test.ts — RBAC a nivel de router (Fase 1D). Mismo patrón que
 * server/routers/students.test.ts: los procedures admin exigen sesión +
 * permiso `venues.view`/`venues.manage` (permissionProcedure), así que
 * rechazan ANTES de tocar la BD — se puede probar con `ctx.user = null` sin
 * mockear nada más. Los procedures `public*` son publicProcedure a propósito
 * (usados por /ie, /uva) y no se prueban aquí — no exigen sesión, así que no
 * hay nada de RBAC que verificar a este nivel.
 */
import { describe, it, expect } from "vitest";
import { venuesRouter } from "./venues";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return venuesRouter.createCaller({ user: null } as any);
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
});
