/**
 * hrEmployeeAlignment.test.ts — PRE-16.16B. Regresión focalizada para los
 * fixes de seguridad de esta fase (Portal del Empleado / Portal de
 * Gestoría, ahora funcionalidad activa de Segolife por decisión de negocio
 * explícita, no legacy).
 *
 * Mismo patrón que legacyTourismModuleGating.test.ts: employeeProcedure /
 * gestoriaProcedure rechazan en su propio middleware, ANTES de tocar la
 * base de datos — no hace falta mockear hr.ts/gestoria.ts's `db` (pool
 * mysql2 real) para probar estos casos.
 */
import { describe, it, expect } from "vitest";
import { hrRouter } from "./hr";
import { gestoriaRouter } from "./gestoria";

function caller<T extends { createCaller: (ctx: unknown) => unknown }>(router: T, user: unknown) {
  return router.createCaller({ user }) as ReturnType<T["createCaller"]>;
}

describe("hr.ts — employeeProcedure: cuenta desactivada no conserva acceso al portal", () => {
  it("sin sesión -> UNAUTHORIZED", async () => {
    await expect((caller(hrRouter, null) as any).portal.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rol sin acceso al portal (ej. 'user') -> FORBIDDEN", async () => {
    await expect(
      (caller(hrRouter, { id: 1, role: "user", isActive: true }) as any).portal.me()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("PRE-16.16B fix: role='employee' pero isActive=false -> FORBIDDEN, sin llegar a resolveCurrentEmployee", async () => {
    await expect(
      (caller(hrRouter, { id: 1, role: "employee", isActive: false }) as any).portal.me()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("PRE-16.16B fix: mismo caso para el rol legacy 'monitor' con isActive=false -> FORBIDDEN", async () => {
    await expect(
      (caller(hrRouter, { id: 1, role: "monitor", isActive: false }) as any).portal.myDocuments()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("isActive=false también bloquea timeClock.clockIn (mutación, no solo lectura)", async () => {
    await expect(
      (caller(hrRouter, { id: 1, role: "employee", isActive: false }) as any).timeClock.clockIn({})
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("isActive=false también bloquea leaves.request (mutación, no solo lectura)", async () => {
    await expect(
      (caller(hrRouter, { id: 1, role: "employee", isActive: false }) as any).leaves.request({
        type: "vacaciones", fromDate: "2026-09-01", toDate: "2026-09-02", reason: "test",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("gestoria.ts — gestoriaProcedure: mismo fix de isActive que employeeProcedure", () => {
  it("sin sesión -> UNAUTHORIZED", async () => {
    await expect((caller(gestoriaRouter, null) as any).portal.dossiers()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rol distinto de 'gestoria' -> FORBIDDEN", async () => {
    await expect(
      (caller(gestoriaRouter, { id: 1, role: "admin", isActive: true }) as any).portal.dossiers()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("PRE-16.16B fix: role='gestoria' pero isActive=false -> FORBIDDEN", async () => {
    await expect(
      (caller(gestoriaRouter, { id: 1, role: "gestoria", isActive: false }) as any).portal.dossiers()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
