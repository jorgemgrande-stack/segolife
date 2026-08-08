/**
 * adminBootstrap.test.ts — bootstrap del primer administrador global de
 * Segolife. Cubre exactamente las propiedades exigidas en la auditoría:
 * creación real, asignación RBAC, abort en email duplicado (nunca update),
 * fallo si el rol "admin" no existe, contraseña nunca expuesta en el
 * resultado, y ausencia total de efectos secundarios (student_profile,
 * user_communities, wallet, permisos individuales) — solo se toca `users` y
 * `rbac_user_roles`, nunca ninguna otra tabla.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { users, rbacRoles, rbacUserRoles } from "../../drizzle/schema";
import { bootstrapAdmin, BootstrapAdminError } from "./adminBootstrap";

function makeMockDb(config: { existingUser?: { id: number } | null; adminRole?: { id: number; isActive: boolean } | null }) {
  const insertedTables: unknown[] = [];
  let mode: "select" | "insert" = "select";
  let currentTable: unknown = null;
  let selectFromUsersCallCount = 0;
  let insertId = 100;

  const b: any = {};
  b.select = () => { mode = "select"; return b; };
  b.insert = (t: unknown) => { mode = "insert"; currentTable = t; insertedTables.push(t); return b; };
  b.from = (t: unknown) => { currentTable = t; return b; };
  b.where = () => b;
  b.values = (_v: Record<string, unknown>) => Promise.resolve([{ insertId: insertId++ }]);
  b.limit = () => {
    if (mode !== "select") return Promise.resolve([]);
    if (currentTable === users) {
      selectFromUsersCallCount++;
      // 1ª select-from-users = comprobación de duplicado; 2ª = verificación post-inserción.
      if (selectFromUsersCallCount === 1) {
        return Promise.resolve(config.existingUser ? [config.existingUser] : []);
      }
      return Promise.resolve([{ id: 100, email: "jorgemgrande@gmail.com", name: "Jorge Grande", isActive: true }]);
    }
    if (currentTable === rbacRoles) {
      return Promise.resolve(config.adminRole ? [config.adminRole] : []);
    }
    if (currentTable === rbacUserRoles) {
      return Promise.resolve([{ userId: 100, roleId: config.adminRole?.id ?? 1 }]);
    }
    return Promise.resolve([]);
  };
  return { db: b as any, insertedTables };
}

describe("bootstrapAdmin — creación", () => {
  it("crea el usuario y asigna el rol RBAC admin cuando no existe y el rol admin está disponible", async () => {
    const { db, insertedTables } = makeMockDb({ existingUser: null, adminRole: { id: 1, isActive: true } });
    const result = await bootstrapAdmin({ email: "jorgemgrande@gmail.com", name: "Jorge Grande", password: "ContraseñaFuerte123!" }, db);

    expect(result.userId).toBe(100);
    expect(result.email).toBe("jorgemgrande@gmail.com");
    expect(insertedTables).toEqual([users, rbacUserRoles]);
  });

  it("nunca expone la contraseña ni el hash en el resultado devuelto", async () => {
    const { db } = makeMockDb({ existingUser: null, adminRole: { id: 1, isActive: true } });
    const result = await bootstrapAdmin({ email: "jorgemgrande@gmail.com", name: "Jorge Grande", password: "ContraseñaFuerte123!" }, db);

    expect(JSON.stringify(result)).not.toContain("ContraseñaFuerte123!");
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("solo inserta en users y rbac_user_roles — nunca student_profiles/user_communities/wallets/permisos individuales", async () => {
    const { db, insertedTables } = makeMockDb({ existingUser: null, adminRole: { id: 1, isActive: true } });
    await bootstrapAdmin({ email: "jorgemgrande@gmail.com", name: "Jorge Grande", password: "ContraseñaFuerte123!" }, db);

    expect(insertedTables).toHaveLength(2);
    expect(insertedTables).toContain(users);
    expect(insertedTables).toContain(rbacUserRoles);
  });
});

describe("bootstrapAdmin — email duplicado", () => {
  it("aborta si el email ya existe — nunca actualiza, nunca inserta nada", async () => {
    const { db, insertedTables } = makeMockDb({ existingUser: { id: 42 }, adminRole: { id: 1, isActive: true } });

    await expect(
      bootstrapAdmin({ email: "jorgemgrande@gmail.com", name: "Jorge Grande", password: "ContraseñaFuerte123!" }, db)
    ).rejects.toBeInstanceOf(BootstrapAdminError);

    expect(insertedTables).toHaveLength(0);
  });

  it("el error de email duplicado tiene código EMAIL_EXISTS", async () => {
    const { db } = makeMockDb({ existingUser: { id: 42 }, adminRole: { id: 1, isActive: true } });
    await expect(
      bootstrapAdmin({ email: "jorgemgrande@gmail.com", name: "Jorge Grande", password: "ContraseñaFuerte123!" }, db)
    ).rejects.toMatchObject({ code: "EMAIL_EXISTS" });
  });

  it("segundo intento sobre el mismo email nunca duplica (idempotencia segura = abort, no upsert)", async () => {
    const { db: db1, insertedTables: inserts1 } = makeMockDb({ existingUser: null, adminRole: { id: 1, isActive: true } });
    await bootstrapAdmin({ email: "jorgemgrande@gmail.com", name: "Jorge Grande", password: "Primera123!" }, db1);
    expect(inserts1).toHaveLength(2);

    const { db: db2, insertedTables: inserts2 } = makeMockDb({ existingUser: { id: 100 }, adminRole: { id: 1, isActive: true } });
    await expect(
      bootstrapAdmin({ email: "jorgemgrande@gmail.com", name: "Jorge Grande", password: "Segunda456!" }, db2)
    ).rejects.toMatchObject({ code: "EMAIL_EXISTS" });
    expect(inserts2).toHaveLength(0);
  });
});

describe("bootstrapAdmin — rol admin ausente", () => {
  it("falla con ADMIN_ROLE_MISSING si rbac_roles no tiene un rol 'admin' activo — nunca crea el usuario sin RBAC", async () => {
    const { db, insertedTables } = makeMockDb({ existingUser: null, adminRole: null });

    await expect(
      bootstrapAdmin({ email: "jorgemgrande@gmail.com", name: "Jorge Grande", password: "ContraseñaFuerte123!" }, db)
    ).rejects.toMatchObject({ code: "ADMIN_ROLE_MISSING" });
    expect(insertedTables).toHaveLength(0);
  });

  it("falla igual si el rol admin existe pero está inactivo", async () => {
    const { db, insertedTables } = makeMockDb({ existingUser: null, adminRole: { id: 1, isActive: false } });
    await expect(
      bootstrapAdmin({ email: "jorgemgrande@gmail.com", name: "Jorge Grande", password: "ContraseñaFuerte123!" }, db)
    ).rejects.toMatchObject({ code: "ADMIN_ROLE_MISSING" });
    expect(insertedTables).toHaveLength(0);
  });
});

describe("bootstrap-segolife-admin — nunca se integra en boot/migrate/seed", () => {
  const ROOT = join(__dirname, "..", "..");
  const FORBIDDEN_IMPORTS = [/adminBootstrap/, /bootstrap-segolife-admin/];
  const FILES_THAT_MUST_NEVER_IMPORT_IT = [
    join(ROOT, "server", "_core", "index.ts"),
    join(ROOT, "scripts", "db-migrate.ts"),
    join(ROOT, "scripts", "db-seed.ts"),
  ];

  it.each(FILES_THAT_MUST_NEVER_IMPORT_IT)("%s no importa el bootstrap de admin", (file) => {
    const source = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_IMPORTS) {
      expect(source, `${file} no debe importar el bootstrap de admin (nunca automático)`).not.toMatch(pattern);
    }
  });
});
