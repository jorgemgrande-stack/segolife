/**
 * rbacSeed.ts — seed RBAC explícito e idempotente para Segolife.
 *
 * Se ejecuta SOLO vía `pnpm db:seed` (scripts/db-seed.ts). NUNCA se invoca
 * desde server/_core/index.ts — ver CLAUDE.md, fase de saneamiento de startup.
 *
 * Reutiliza el catálogo RBAC ya existente (drizzle/0069_rbac_roles.sql,
 * 0070_rbac_permissions.sql, 0071/0076_rbac_*_user_roles.sql), que se aplica
 * vía `pnpm db:migrate`. Este seed NO reemplaza esas migraciones — solo:
 *
 *  1. Garantiza que el catálogo mínimo de roles/permisos existe (defensivo:
 *     funciona incluso si db:migrate aún no corrió en este entorno).
 *  2. Añade los permisos `students.view` / `students.manage` — usados ya por
 *     server/routers/students.ts pero nunca sembrados en ninguna migración
 *     histórica (el módulo de estudiantes es posterior a 0070) — y, con el
 *     mismo criterio, `venues.view` / `venues.manage` / `events.view` /
 *     `events.manage` (Fase 1D, server/routers/venues.ts y events.ts) y
 *     `tokens.view` / `tokens.manage` / `tokens.adjust` / `tokens.rules.manage`
 *     (Fase 2, server/routers/tokens.ts).
 *  3. Concede esos permisos al rol `admin`.
 *  4. Confirma que `settings.manage` existe (ya sembrado en 0070 — solo
 *     verificación, no inserta nada nuevo).
 *  5. Re-sincroniza `rbac_user_roles` para todos los usuarios existentes,
 *     mapeando su rol legacy (`users.role`) al rol RBAC del mismo `key` —
 *     mismo patrón idempotente ya usado en 0071/0076 (INSERT IGNORE).
 *
 * Todo con INSERT IGNORE / comprobación previa — seguro de re-ejecutar.
 */
import mysql from "mysql2/promise";

const BASELINE_ROLES: Array<[string, string, string, boolean]> = [
  ["admin",   "Administrador",       "Acceso total a la plataforma", true],
  ["agente",  "Agente comercial",    "Gestión de leads y CRM",       true],
  ["monitor", "Monitor",             "Operativa de actividades",     true],
  ["user",    "Usuario",             "Sin acceso al panel",          true],
];

const STUDENTS_PERMISSIONS: Array<[string, string, string, string]> = [
  ["students.view",   "students", "view",   "Ver perfiles y datos de estudiantes"],
  ["students.manage", "students", "manage", "Gestionar (crear/editar/anotar) perfiles de estudiantes"],
];

const VENUES_EVENTS_PERMISSIONS: Array<[string, string, string, string]> = [
  ["venues.view",   "venues", "view",   "Ver venues/negocios"],
  ["venues.manage", "venues", "manage", "Gestionar (crear/editar/activar) venues/negocios"],
  ["events.view",   "events", "view",   "Ver eventos"],
  ["events.manage", "events", "manage", "Gestionar (crear/editar/activar/destacar) eventos"],
];

const TOKENS_PERMISSIONS: Array<[string, string, string, string]> = [
  ["tokens.view",         "tokens", "view",         "Ver wallets, ledger, reglas y campañas de SegoTokens"],
  ["tokens.manage",       "tokens", "manage",        "Gestionar productos de venue, campañas y horarios de SegoTokens"],
  ["tokens.adjust",       "tokens", "adjust",        "Ajustar manualmente el saldo de un wallet y revertir movimientos"],
  ["tokens.rules.manage", "tokens", "rules.manage",  "Crear/editar/activar reglas del motor de SegoTokens"],
];

export async function seedRbacIfNeeded(): Promise<{
  rolesEnsured: string[];
  permissionsAdded: string[];
  grantsEnsured: string[];
  userRolesSynced: number;
}> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const rolesEnsured: string[] = [];
  const permissionsAdded: string[] = [];
  const grantsEnsured: string[] = [];

  try {
    // 1. Catálogo mínimo de roles — defensivo, no depende de que db:migrate haya corrido.
    for (const [key, name, description, isLegacy] of BASELINE_ROLES) {
      const [result] = await conn.execute(
        `INSERT IGNORE INTO rbac_roles (\`key\`, name, description, is_legacy, is_active, sort_order)
         VALUES (?, ?, ?, ?, 1, 0)`,
        [key, name, description, isLegacy ? 1 : 0]
      ) as any[];
      if ((result as any).affectedRows > 0) rolesEnsured.push(key);
    }

    // 2. Permisos students.view / students.manage / venues.* / events.* /
    //    tokens.* — no sembrados en ninguna migración histórica.
    for (const [key, module, action, description] of [...STUDENTS_PERMISSIONS, ...VENUES_EVENTS_PERMISSIONS, ...TOKENS_PERMISSIONS]) {
      const [result] = await conn.execute(
        `INSERT IGNORE INTO rbac_permissions (\`key\`, module, action, description) VALUES (?, ?, ?, ?)`,
        [key, module, action, description]
      ) as any[];
      if ((result as any).affectedRows > 0) permissionsAdded.push(key);
    }

    // 3. Conceder students.* / venues.* / events.* / tokens.* al rol admin
    //    (idempotente, no asume que el CROSS JOIN histórico de 0070/0077 se
    //    haya vuelto a ejecutar para estos permisos nuevos).
    for (const [key] of [...STUDENTS_PERMISSIONS, ...VENUES_EVENTS_PERMISSIONS, ...TOKENS_PERMISSIONS]) {
      const [result] = await conn.execute(
        `INSERT IGNORE INTO rbac_role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
         WHERE r.\`key\` = 'admin' AND p.\`key\` = ?`,
        [key]
      ) as any[];
      if ((result as any).affectedRows > 0) grantsEnsured.push(`admin -> ${key}`);
    }

    // 4. Verificación de settings.manage (ya sembrado en 0070 vía CROSS JOIN a admin).
    //    No lo insertamos aquí — solo lo confirmamos para dejar constancia en el resultado.
    const [settingsManageRows] = await conn.execute(
      `SELECT 1 FROM rbac_permissions WHERE \`key\` = 'settings.manage' LIMIT 1`
    ) as any[];
    if ((settingsManageRows as any[]).length === 0) {
      console.warn("[RbacSeed] settings.manage no existe en rbac_permissions — ejecuta 'pnpm db:migrate' primero (lo siembra 0070_rbac_permissions.sql)");
    } else {
      const [grantRows] = await conn.execute(
        `INSERT IGNORE INTO rbac_role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
         WHERE r.\`key\` = 'admin' AND p.\`key\` = 'settings.manage'`
      ) as any[];
      if ((grantRows as any).affectedRows > 0) grantsEnsured.push("admin -> settings.manage");
    }

    // 5. Sincronizar rbac_user_roles para usuarios existentes (mismo patrón que 0071/0076).
    const [syncResult] = await conn.execute(
      `INSERT IGNORE INTO rbac_user_roles (user_id, role_id)
       SELECT u.id, r.id FROM users u
       JOIN rbac_roles r ON r.\`key\` = u.role AND r.is_active = 1`
    ) as any[];
    const userRolesSynced = (syncResult as any).affectedRows ?? 0;

    console.log(
      `[RbacSeed] Roles nuevos: ${rolesEnsured.length || 0} | Permisos nuevos: ${permissionsAdded.join(", ") || "ninguno"} | ` +
      `Grants nuevos: ${grantsEnsured.join(", ") || "ninguno"} | rbac_user_roles sincronizadas: ${userRolesSynced}`
    );

    return { rolesEnsured, permissionsAdded, grantsEnsured, userRolesSynced };
  } finally {
    await conn.end();
  }
}
