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
 *     `events.manage` (Fase 1D, server/routers/venues.ts y events.ts),
 *     `tokens.view` / `tokens.manage` / `tokens.adjust` / `tokens.rules.manage`
 *     (Fase 2, server/routers/tokens.ts), `qr.view` / `qr.issue` /
 *     `qr.manage` / `qr.cancel` (Fase 3, server/routers/consumptionQr.ts) y
 *     `benefits.view` / `benefits.manage` / `benefits.grant` /
 *     `benefits.redeem` / `benefits.cancel` (Fase 4, server/routers/benefits.ts).
 *     También da de alta el rol RBAC `staff` (personal de puerta/venue, sin
 *     acceso al resto del panel admin) — ver comentario de STAFF_PERMISSIONS
 *     más abajo y drizzle/schema.ts, comentario de venue_staff.
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

// Rol NUEVO (Fase 4, no legacy — is_legacy=false porque no existe un
// users.role histórico equivalente). Personal de puerta/caja de UN venue
// concreto (ver drizzle/schema.ts, venue_staff): solo puede validar Benefits,
// y solo de los venues donde tenga una fila en venue_staff — el alcance por
// venue se aplica en server/segolife/benefits/venueStaffAccess.ts, no aquí.
const STAFF_ROLE: [string, string, string, boolean] = ["staff", "Staff de venue", "Validación de beneficios en puerta/caja", false];

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

const QR_PERMISSIONS: Array<[string, string, string, string]> = [
  ["qr.view",   "qr", "view",   "Ver QR de consumición, batches, canjes e intentos"],
  ["qr.issue",  "qr", "issue",  "Emitir QR de consumición individuales o en lote"],
  ["qr.manage", "qr", "manage", "Gestión operativa de QR (batches, listados, impresión)"],
  ["qr.cancel", "qr", "cancel", "Cancelar QR emitidos no canjeados"],
];

const BENEFITS_PERMISSIONS: Array<[string, string, string, string]> = [
  ["benefits.view",    "benefits", "view",    "Ver definiciones, reglas, beneficios concedidos y canjes"],
  ["benefits.manage",  "benefits", "manage",  "Crear/editar/activar definiciones y reglas de beneficios"],
  ["benefits.grant",   "benefits", "grant",   "Conceder un beneficio manualmente a un estudiante"],
  ["benefits.redeem",  "benefits", "redeem",  "Validar (canjear) el QR de un beneficio en puerta/caja"],
  ["benefits.cancel",  "benefits", "cancel",  "Cancelar un beneficio concedido no usado"],
];

// Fase 5 — Ticketing & Commerce Core + Integration Hub. No sembrados en
// ninguna migración histórica (igual que benefits.* en Fase 4).
const INTEGRATIONS_PERMISSIONS: Array<[string, string, string, string]> = [
  ["integrations.view",   "integrations", "view",   "Ver integraciones (Fourvenues/Weezevent), su estado y credenciales configuradas (nunca el secreto)"],
  ["integrations.manage", "integrations", "manage", "Crear/editar/activar/desactivar integraciones, cambiar credenciales, lanzar sync manual"],
];

// event_ticketing.* (NO "ticketing.*" a secas — ese permiso ya existe y lo
// usa server/routers/ticketing.ts, el pipeline LEGACY de cupones/plataformas
// de Náyade, sin ninguna relación con venta de entradas de eventos — un
// nombre igual habría concedido acceso cruzado sin querer).
const EVENT_TICKETING_PERMISSIONS: Array<[string, string, string, string]> = [
  ["event_ticketing.view",   "event_ticketing", "view",   "Ver canales de venta, tipos de entrada, inventario, pedidos y entradas de un evento"],
  ["event_ticketing.manage", "event_ticketing", "manage", "Crear/editar canales de venta y tipos de entrada"],
];

const COMMERCE_PERMISSIONS: Array<[string, string, string, string]> = [
  ["commerce.view",   "commerce", "view",   "Ver transacciones de comercio (consumiciones) de un venue"],
  ["commerce.manage", "commerce", "manage", "Vincular manualmente operaciones de comercio no resueltas a un estudiante"],
];

const ATTENDANCE_PERMISSIONS: Array<[string, string, string, string]> = [
  ["attendance.view",   "attendance", "view",   "Ver asistencia registrada de un evento"],
  ["attendance.manage", "attendance", "manage", "Vincular manualmente operaciones de asistencia no resueltas a un estudiante"],
];

// Fase 7 — Engagement, Notifications & Communications Core.
const ENGAGEMENT_PERMISSIONS: Array<[string, string, string, string]> = [
  ["engagement.view",              "engagement", "view",              "Ver campañas, notificaciones, deliveries, audiencias y fallos"],
  ["engagement.manage",            "engagement", "manage",            "Crear/editar/programar/cancelar campañas"],
  ["engagement.send",              "engagement", "send",              "Enviar una campaña ahora (manual) o lanzar un test send"],
  ["engagement.templates.manage",  "engagement", "templates.manage",  "Ver el catálogo de plantillas de sistema (gestión real vive en código/versionado)"],
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
    for (const [key, name, description, isLegacy] of [...BASELINE_ROLES, STAFF_ROLE]) {
      const [result] = await conn.execute(
        `INSERT IGNORE INTO rbac_roles (\`key\`, name, description, is_legacy, is_active, sort_order)
         VALUES (?, ?, ?, ?, 1, 0)`,
        [key, name, description, isLegacy ? 1 : 0]
      ) as any[];
      if ((result as any).affectedRows > 0) rolesEnsured.push(key);
    }

    // 2. Permisos students.view / students.manage / venues.* / events.* /
    //    tokens.* / qr.* / benefits.* / integrations.* / ticketing.* /
    //    commerce.* / attendance.* — no sembrados en ninguna migración histórica.
    for (const [key, module, action, description] of [...STUDENTS_PERMISSIONS, ...VENUES_EVENTS_PERMISSIONS, ...TOKENS_PERMISSIONS, ...QR_PERMISSIONS, ...BENEFITS_PERMISSIONS, ...INTEGRATIONS_PERMISSIONS, ...EVENT_TICKETING_PERMISSIONS, ...COMMERCE_PERMISSIONS, ...ATTENDANCE_PERMISSIONS, ...ENGAGEMENT_PERMISSIONS]) {
      const [result] = await conn.execute(
        `INSERT IGNORE INTO rbac_permissions (\`key\`, module, action, description) VALUES (?, ?, ?, ?)`,
        [key, module, action, description]
      ) as any[];
      if ((result as any).affectedRows > 0) permissionsAdded.push(key);
    }

    // 3. Conceder students.* / venues.* / events.* / tokens.* / qr.* /
    //    benefits.* / integrations.* / ticketing.* / commerce.* /
    //    attendance.* al rol admin (idempotente, no asume que el CROSS JOIN
    //    histórico de 0070/0077 se haya vuelto a ejecutar para estos permisos
    //    nuevos).
    for (const [key] of [...STUDENTS_PERMISSIONS, ...VENUES_EVENTS_PERMISSIONS, ...TOKENS_PERMISSIONS, ...QR_PERMISSIONS, ...BENEFITS_PERMISSIONS, ...INTEGRATIONS_PERMISSIONS, ...EVENT_TICKETING_PERMISSIONS, ...COMMERCE_PERMISSIONS, ...ATTENDANCE_PERMISSIONS, ...ENGAGEMENT_PERMISSIONS]) {
      const [result] = await conn.execute(
        `INSERT IGNORE INTO rbac_role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
         WHERE r.\`key\` = 'admin' AND p.\`key\` = ?`,
        [key]
      ) as any[];
      if ((result as any).affectedRows > 0) grantsEnsured.push(`admin -> ${key}`);
    }

    // 3b. El rol `staff` (nuevo) SOLO recibe benefits.view/benefits.redeem —
    //     nunca manage/grant/cancel (esos siguen siendo exclusivos de admin).
    //     El alcance por venue concreto se aplica en runtime vía venue_staff,
    //     no aquí (RBAC solo resuelve el verbo, no el dato — ver
    //     communityAccess.ts para el mismo criterio aplicado a comunidad).
    for (const key of ["benefits.view", "benefits.redeem"]) {
      const [result] = await conn.execute(
        `INSERT IGNORE INTO rbac_role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
         WHERE r.\`key\` = 'staff' AND p.\`key\` = ?`,
        [key]
      ) as any[];
      if ((result as any).affectedRows > 0) grantsEnsured.push(`staff -> ${key}`);
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
