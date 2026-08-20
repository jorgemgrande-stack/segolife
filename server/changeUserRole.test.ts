/**
 * changeUserRole.test.ts — SEC-01 (BUG-B: divergencia de RBAC entre
 * administradores). changeUserRole() antes solo actualizaba users.role
 * (campo legacy) sin tocar rbac_user_roles — como checkRbacOrLegacy() es
 * RBAC-first (si el usuario tiene alguna fila real en rbac_user_roles, se
 * usan SOLO esas, ignorando el campo legacy), un cambio de rol vía el
 * selector admin (client/src/components/admin/UsersManager.tsx) podía
 * dejar a alguien mostrando "Administrador general" pero resolviendo los
 * permisos de su rol RBAC anterior, nunca actualizado — el bug real
 * confirmado en producción para herre.casanova@gmail.com (users.role
 * cambiado a "admin", rbac_user_roles seguía en "venue_admin").
 *
 * Integración real contra la BD (mismo criterio que server/nayade.test.ts)
 * — se crea y elimina un usuario desechable propio, nunca se toca ningún
 * usuario real. Requiere BD local disponible (docker compose up -d db);
 * sin BD, getDb() devuelve null y el test falla con un error claro en vez
 * de silencioso.
 */
import { describe, it, expect, afterEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { getDb, changeUserRole } from "./db";
import { users, rbacUserRoles, rbacRoles } from "../drizzle/schema";

const TEST_EMAIL = "_sec01_test_changerole@example.invalid";
let createdUserId: number | null = null;

async function getRbacRoleKeys(userId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) throw new Error("DB no disponible");
  const rows = await db.select({ key: rbacRoles.key })
    .from(rbacUserRoles)
    .innerJoin(rbacRoles, eq(rbacRoles.id, rbacUserRoles.roleId))
    .where(eq(rbacUserRoles.userId, userId));
  return rows.map(r => r.key).sort();
}

describe("changeUserRole — sincroniza rbac_user_roles, nunca solo el campo legacy (SEC-01, BUG-B)", () => {
  afterEach(async () => {
    if (createdUserId === null) return;
    const db = await getDb();
    if (db) {
      await db.delete(rbacUserRoles).where(eq(rbacUserRoles.userId, createdUserId));
      await db.delete(users).where(eq(users.id, createdUserId));
    }
    createdUserId = null;
  });

  it("cambiar de 'monitor' a 'admin' retira el rol RBAC anterior y concede el nuevo — nunca deja ambos acumulados", async () => {
    const db = await getDb();
    if (!db) throw new Error("Esta suite requiere BD local disponible (docker compose up -d db)");

    const [ins] = await db.execute(sql`
      INSERT INTO users (email, name, role, isActive, loginMethod, passwordHash, openId, createdAt, updatedAt)
      VALUES (${TEST_EMAIL}, 'SEC-01 Test User', 'monitor', 1, 'local', 'x', ${'_sec01_test_openid_' + Date.now()}, NOW(), NOW())
    `);
    createdUserId = (ins as any).insertId;
    expect(createdUserId).toBeTruthy();

    // Simula el estado real encontrado en producción: el usuario ya tenía
    // una fila RBAC (aquí "monitor") antes del cambio de rol legacy.
    const [monitorRole] = await db.select({ id: rbacRoles.id }).from(rbacRoles).where(eq(rbacRoles.key, "monitor")).limit(1);
    expect(monitorRole).toBeTruthy();
    await db.insert(rbacUserRoles).values({ userId: createdUserId!, roleId: monitorRole.id });
    expect(await getRbacRoleKeys(createdUserId!)).toEqual(["monitor"]);

    await changeUserRole(createdUserId!, "admin");

    const [userRow] = await db.select({ role: users.role }).from(users).where(eq(users.id, createdUserId!)).limit(1);
    expect(userRow.role).toBe("admin");
    // La aserción real del bug: el rol RBAC debe reflejar "admin", no
    // seguir en "monitor" ni acumular ambos.
    expect(await getRbacRoleKeys(createdUserId!)).toEqual(["admin"]);
  });

  it("cambiar de vuelta a 'monitor' revierte limpio, sin dejar 'admin' acumulado", async () => {
    const db = await getDb();
    if (!db) throw new Error("Esta suite requiere BD local disponible (docker compose up -d db)");

    const [ins] = await db.execute(sql`
      INSERT INTO users (email, name, role, isActive, loginMethod, passwordHash, openId, createdAt, updatedAt)
      VALUES (${TEST_EMAIL}, 'SEC-01 Test User', 'admin', 1, 'local', 'x', ${'_sec01_test_openid_' + Date.now()}, NOW(), NOW())
    `);
    createdUserId = (ins as any).insertId;

    await changeUserRole(createdUserId!, "monitor");
    expect(await getRbacRoleKeys(createdUserId!)).toEqual(["monitor"]);

    await changeUserRole(createdUserId!, "admin");
    expect(await getRbacRoleKeys(createdUserId!)).toEqual(["admin"]);
  });

  it("nunca toca ningún rol RBAC fuera del conjunto de roles legacy conmutables (no revienta ni borra asignaciones ajenas)", async () => {
    const db = await getDb();
    if (!db) throw new Error("Esta suite requiere BD local disponible (docker compose up -d db)");

    const [ins] = await db.execute(sql`
      INSERT INTO users (email, name, role, isActive, loginMethod, passwordHash, openId, createdAt, updatedAt)
      VALUES (${TEST_EMAIL}, 'SEC-01 Test User', 'user', 1, 'local', 'x', ${'_sec01_test_openid_' + Date.now()}, NOW(), NOW())
    `);
    createdUserId = (ins as any).insertId;

    await changeUserRole(createdUserId!, "monitor");
    await changeUserRole(createdUserId!, "user");
    // Cada cambio sucesivo deja EXACTAMENTE un rol RBAC — nunca acumula
    // los intermedios (monitor) del mismo conjunto conmutable.
    expect(await getRbacRoleKeys(createdUserId!)).toEqual(["user"]);
  });
});
