/**
 * adminBootstrap.ts — lógica del bootstrap del primer administrador global
 * de Segolife (invocado por scripts/bootstrap-segolife-admin.ts, nunca desde
 * npm start / db:migrate / db:seed / el arranque del servidor).
 *
 * Auditoría previa (ver informe de la tarea): RBAC (rbac_user_roles → rol
 * "admin") es la ÚNICA fuente de autorización real — server/_core/rbac.ts,
 * checkRbacOrLegacy: si el usuario tiene fila en rbac_user_roles, usa
 * EXCLUSIVAMENTE esos permisos, users.role ni se consulta. El rol "admin" ya
 * tiene granted todos los permisos del catálogo (Fases 4-8), así que esta
 * única asignación basta — nunca se crean permisos individuales aquí.
 *
 * users.role='admin' se fija igualmente porque client/src/components/
 * AdminLayout.tsx:504 bloquea /admin del lado CLIENTE comparando ese campo
 * legacy contra una lista fija — sin ese valor el panel muestra "Sin
 * permisos" aunque el backend ya autorizaría todo vía RBAC. Es el valor
 * mínimo ya soportado por el enum, no una fuente de autorización nueva.
 *
 * NUNCA actualiza un usuario existente — si el email ya existe, aborta
 * (BootstrapAdminError código EMAIL_EXISTS). "Idempotente" aquí significa
 * "seguro de re-ejecutar", no "upsert".
 */
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, sql } from "drizzle-orm";
import { users, rbacRoles, rbacUserRoles, type User } from "../../drizzle/schema";

const BCRYPT_ROUNDS = 12; // mismo cost factor que server/passwordReset.ts y el resto del repo

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL ?? "", connectionLimit: 1 });
const _db = drizzle(_pool);

export type DbHandle = typeof _db;

export class BootstrapAdminError extends Error {
  constructor(public code: "EMAIL_EXISTS" | "ADMIN_ROLE_MISSING" | "VERIFICATION_FAILED", message: string) {
    super(message);
    this.name = "BootstrapAdminError";
  }
}

export interface BootstrapAdminInput {
  email: string;
  name: string;
  password: string;
}

export interface BootstrapAdminResult {
  userId: number;
  email: string;
  name: string;
  isActive: boolean;
}

export async function bootstrapAdmin(input: BootstrapAdminInput, db?: DbHandle): Promise<BootstrapAdminResult> {
  const conn = db ?? _db;
  const email = input.email.trim().toLowerCase();

  const [existing] = await conn
    .select({ id: users.id })
    .from(users)
    .where(sql`LOWER(${users.email}) = LOWER(${email})`)
    .limit(1);

  if (existing) {
    throw new BootstrapAdminError("EMAIL_EXISTS", `Ya existe un usuario con este email (id=${existing.id})`);
  }

  const [adminRole] = await conn
    .select({ id: rbacRoles.id, isActive: rbacRoles.isActive })
    .from(rbacRoles)
    .where(eq(rbacRoles.key, "admin"))
    .limit(1);

  if (!adminRole || !adminRole.isActive) {
    throw new BootstrapAdminError("ADMIN_ROLE_MISSING", 'El rol RBAC "admin" no existe o está inactivo en rbac_roles');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const [insertResult] = await conn.insert(users).values({
    openId: `local_${Date.now()}`,
    email,
    name: input.name,
    passwordHash,
    role: "admin",
    loginMethod: "local",
    isActive: true,
  });
  const userId = (insertResult as unknown as { insertId: number }).insertId;
  if (!userId) throw new BootstrapAdminError("VERIFICATION_FAILED", "INSERT de users no devolvió insertId");

  await conn.insert(rbacUserRoles).values({ userId, roleId: adminRole.id });

  const [verifyUser] = await conn.select().from(users).where(eq(users.id, userId)).limit(1);
  const [verifyRole] = await conn.select().from(rbacUserRoles).where(eq(rbacUserRoles.userId, userId)).limit(1);
  if (!verifyUser || !verifyRole) throw new BootstrapAdminError("VERIFICATION_FAILED", "Verificación post-inserción falló");

  return { userId, email: (verifyUser as User).email!, name: (verifyUser as User).name!, isActive: (verifyUser as User).isActive };
}
