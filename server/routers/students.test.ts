/**
 * students.test.ts — endpoint público/privado correcto a nivel de router.
 *
 * Ninguna procedure de `studentsRouter` es `publicProcedure` (a diferencia
 * de `communitiesRouter` en Fase 1B) — todas exigen sesión. El middleware de
 * protectedProcedure/permissionProcedure rechaza ANTES de llamar al
 * resolver, así que se puede probar con `ctx.user = null` sin tocar la BD.
 */
import { describe, it, expect } from "vitest";
import { studentsRouter } from "./students";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return studentsRouter.createCaller({ user: null } as any);
}

describe("students router — endpoint privado (nunca público)", () => {
  it("students.me (autoservicio) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().me()).rejects.toThrow(/please login/i);
  });

  it("students.updateProfile rechaza sin sesión", async () => {
    await expect(callerWithoutSession().updateProfile({})).rejects.toThrow(/please login/i);
  });

  it("students.list (CRM admin) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().list({ limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });

  it("students.getById (CRM admin) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getById({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("students.addNote (escritura admin) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().addNote({ studentProfileId: 1, note: "x" })).rejects.toThrow(/please login/i);
  });
});
