/**
 * hrCreatePortalAccessGuard.test.ts — PRE-16.16B. hr.employees.createPortalAccess
 * reutilizaba CUALQUIER cuenta `users` existente con el mismo email,
 * sobrescribiendo su rol a "employee" sin comprobar qué rol tenía antes —
 * una colisión de email con una cuenta admin/agente/etc. la degradaba en
 * silencio (hallazgo del audit RBAC/IDOR de esta fase). Se corrigió con una
 * guarda explícita: solo se reutiliza si el rol previo ya era
 * "user"/"employee"/"monitor".
 *
 * Mismo patrón de mock que server/routers/integrations.test.ts: se mockea
 * drizzle-orm/mysql2 (hr.ts construye su propio `db` inline, sin BD real
 * en test) con una cola de respuestas en el orden exacto en que
 * createPortalAccess llama a select().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const employeeFixture = {
  id: 42,
  fullName: "Empleado de Prueba",
  email: "colision@example.invalid",
  isActive: true,
};

// Cola de respuestas de select(): 1ª llamada = lookup de employees,
// 2ª llamada = lookup de users por email. Se resetea por test.
let selectQueue: unknown[][] = [];

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
    insert: () => ({ values: async () => [{ affectedRows: 1 }] }),
  }),
}));

import { hrRouter } from "./hr";

function adminCaller() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return hrRouter.createCaller({ user: { id: 1, role: "admin", isActive: true } } as any);
}

beforeEach(() => {
  selectQueue = [];
  vi.clearAllMocks();
});

describe("hr.employees.createPortalAccess — guarda contra sobrescritura de rol de una cuenta existente", () => {
  it("PRE-16.16B fix: colisión de email con una cuenta 'admin' existente -> CONFLICT, no se sobrescribe el rol", async () => {
    selectQueue = [
      [employeeFixture],
      [{ id: 99, role: "admin" }],
    ];
    await expect(
      (adminCaller() as any).employees.createPortalAccess({ employeeId: 42, sendEmailNow: false })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("colisión con una cuenta 'user' (sin acceso previo) sigue permitida — no bloquea el flujo normal de invitación", async () => {
    selectQueue = [
      [employeeFixture],
      [{ id: 99, role: "user" }],
    ];
    await expect(
      (adminCaller() as any).employees.createPortalAccess({ employeeId: 42, sendEmailNow: false })
    ).resolves.toBeDefined();
  });

  it("re-invitación de una cuenta que ya era 'employee' sigue permitida", async () => {
    selectQueue = [
      [employeeFixture],
      [{ id: 99, role: "employee" }],
    ];
    await expect(
      (adminCaller() as any).employees.createPortalAccess({ employeeId: 42, sendEmailNow: false })
    ).resolves.toBeDefined();
  });
});
