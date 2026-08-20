/**
 * operationsPiiGating.test.ts — PRE-16.16B. dailyOrdersRouter.getForDate y
 * activitiesRouter.getForDate estaban en protectedProcedure (cualquier
 * usuario autenticado, sin comprobación de rol) y devuelven nombre/email/
 * teléfono reales de clientes — hallazgo del audit RBAC/IDOR de esta fase,
 * hecho relevante por la frontera "Venue/Empleado" que pide verificar el
 * spec (un rol employee/monitor no debería alcanzar PII operativa sin
 * permiso). Se corrigió a operationsViewProc (mismo gate que sus
 * procedures hermanos updateOperational/getDashboardStats en este router).
 *
 * En CI (sin BD real) checkRbacOrLegacy cae a fallbackAllowedRoles — no hace
 * falta mockear nada para probar el rechazo por rol. En local (con BD real
 * de desarrollo disponible) se resuelve por RBAC real — de ahí que los ids
 * de usuario fabricados aquí usen un id fuera de rango (999999), para no
 * colisionar con una cuenta admin real ya sembrada en la BD local (mismo
 * fix que server/nayade.test.ts).
 */
import { describe, it, expect } from "vitest";
import { operationsRouter } from "./operations";

function caller(user: unknown) {
  return operationsRouter.createCaller({ user }) as any;
}

describe("operations.ts — dailyOrders.getForDate / activities.getForDate ya no aceptan cualquier rol autenticado", () => {
  it("sin sesión -> UNAUTHORIZED", async () => {
    await expect(caller(null).dailyOrders.getForDate({ date: "2026-09-01" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("PRE-16.16B fix: rol 'user' autenticado sin operations.view -> FORBIDDEN (antes: pasaba, exponía PII de clientes)", async () => {
    await expect(
      caller({ id: 999999, role: "user", isActive: true }).dailyOrders.getForDate({ date: "2026-09-01" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("PRE-16.16B fix: rol 'employee' (Portal del Empleado) tampoco alcanza PII operativa vía este endpoint", async () => {
    await expect(
      caller({ id: 999999, role: "employee", isActive: true }).dailyOrders.getForDate({ date: "2026-09-01" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rol 'monitor' (legacy, con operations.view real vía RBAC seed) pasa el gate — no se ha roto el uso legítimo", async () => {
    // En este entorno de test no hay BD real, así que la query SQL puede
    // fallar después del gate — lo único que este caso garantiza es que el
    // gate en sí no rechaza con FORBIDDEN a un rol que sí debe pasar.
    try {
      // id fuera de rango real: nunca colisiona con un usuario sembrado en la
      // BD local con roles RBAC reales ya asignados (mismo fix que
      // server/nayade.test.ts) — aquí SÍ hay BD real disponible en local.
      await caller({ id: 999999, role: "monitor", isActive: true }).dailyOrders.getForDate({ date: "2026-09-01" });
    } catch (e: any) {
      expect(e.code).not.toBe("FORBIDDEN");
    }
  });

  it("activities.getForDate: mismo fix, mismo comportamiento", async () => {
    await expect(
      caller({ id: 999999, role: "user", isActive: true }).activities.getForDate({ date: "2026-09-01" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
