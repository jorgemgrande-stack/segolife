// Concede el permiso RBAC "dashboard.view" (nuevo, minted en la Fase 15 —
// Admin Command Center) al rol "admin" — el único rol que hoy tiene el resto
// de permisos *.view de referencia (students.view/tokens.view/benefits.view/
// integrations.view/events.view/venues.view). Sin esto, `checkRbacOrLegacy`
// nunca cae al fallback legacy ["admin"] para usuarios CON roles RBAC reales
// asignados (el fallback solo se dispara si la consulta RBAC falla o el
// usuario no tiene ningún rol RBAC) — deja el KPI Strip/Segolife Live/
// Community Pulse/Plan & Play/Funnel/Action Center/System Health/Event
// Performance/Venue Performance con "Acceso denegado" para cualquier admin
// con roles RBAC reales asignados en producción. Idempotente. Solo INSERT
// aditivo — nunca borra ni modifica un permiso existente.
//
// Run: railway ssh --service segolife -- node < scripts/grant-dashboard-view-permission.cjs

const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function main() {
  const conn = await mysql.createConnection(DB_URL);

  const [existingPerm] = await conn.query("SELECT id FROM rbac_permissions WHERE `key` = 'dashboard.view'");
  let permissionId;
  if (existingPerm.length > 0) {
    permissionId = existingPerm[0].id;
    console.log(`· permiso 'dashboard.view' ya existe (id=${permissionId})`);
  } else {
    const [result] = await conn.query(
      "INSERT INTO rbac_permissions (`key`, module, action, description) VALUES (?, ?, ?, ?)",
      ["dashboard.view", "dashboard", "view", "Ver el SEGOLIFE Admin Command Center (/admin)"]
    );
    permissionId = result.insertId;
    console.log(`✓ CREATE rbac_permissions.dashboard.view (id=${permissionId})`);
  }

  const [adminRole] = await conn.query("SELECT id FROM rbac_roles WHERE `key` = 'admin'");
  if (adminRole.length === 0) { console.error("ABORTADO: no existe el rol 'admin'"); process.exit(1); }
  const adminRoleId = adminRole[0].id;

  const [existingGrant] = await conn.query(
    "SELECT 1 FROM rbac_role_permissions WHERE role_id = ? AND permission_id = ?",
    [adminRoleId, permissionId]
  );
  if (existingGrant.length > 0) {
    console.log(`· el rol 'admin' ya tiene 'dashboard.view' concedido`);
  } else {
    await conn.query("INSERT INTO rbac_role_permissions (role_id, permission_id) VALUES (?, ?)", [adminRoleId, permissionId]);
    console.log(`✓ GRANT dashboard.view -> admin (role_id=${adminRoleId})`);
  }

  conn.destroy();
}
main().then(() => process.exit(0)).catch(err => { console.error("ERROR:", err.message); process.exit(1); });
