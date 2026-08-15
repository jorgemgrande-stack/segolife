// Siembra puntual e idempotente de los permisos RBAC referrals.view /
// referrals.manage (Fase 8) — mismo criterio exacto que server/_core/rbacSeed.ts
// (INSERT IGNORE, seguro de re-ejecutar). Solo toca rbac_permissions/
// rbac_role_permissions, concedidos EXCLUSIVAMENTE al rol admin (nunca a
// venue_admin/staff — spec §75, GLOBAL_ADMIN only).
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const PERMS = [
  ["referrals.view", "referrals", "view", "Ver campañas, referidos y analítica del motor de invitaciones"],
  ["referrals.manage", "referrals", "manage", "Crear/editar/activar/pausar campañas de referidos, reintentar recompensas pendientes"],
];

(async () => {
  const c = await mysql.createConnection({ uri: DB_URL });
  const permissionsAdded = [];
  const grantsEnsured = [];

  for (const [key, module, action, description] of PERMS) {
    const [result] = await c.execute(
      "INSERT IGNORE INTO rbac_permissions (`key`, module, action, description) VALUES (?, ?, ?, ?)",
      [key, module, action, description]
    );
    if (result.affectedRows > 0) permissionsAdded.push(key);
  }

  for (const [key] of PERMS) {
    const [result] = await c.execute(
      `INSERT IGNORE INTO rbac_role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
       WHERE r.\`key\` = 'admin' AND p.\`key\` = ?`,
      [key]
    );
    if (result.affectedRows > 0) grantsEnsured.push(`admin -> ${key}`);
  }

  console.log("Permisos nuevos:", permissionsAdded.join(", ") || "ninguno (ya existían)");
  console.log("Grants nuevos:", grantsEnsured.join(", ") || "ninguno (ya existían)");

  const [check] = await c.query(`
    SELECT rr.\`key\` AS role, p.\`key\` AS perm
    FROM rbac_role_permissions rrp
    JOIN rbac_roles rr ON rr.id = rrp.role_id
    JOIN rbac_permissions p ON p.id = rrp.permission_id
    WHERE p.\`key\` LIKE 'referrals.%'
  `);
  console.log("[POST] grants reales:", JSON.stringify(check));

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
