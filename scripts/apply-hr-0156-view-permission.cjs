// Aplica la migración 0156_hr_view_permission — inserta el permission key
// "hr.view" (usado por hrViewProc en server/routers/hr.ts pero nunca
// registrado en rbac_permissions) y lo concede al rol "admin".
//
// Confirmado en producción antes de este fix: el admin real ya tiene fila
// en rbac_user_roles, por lo que checkRbacOrLegacy resuelve por RBAC real
// (nunca lanza) y, al no existir "hr.view" en el catálogo, el resultado es
// siempre acceso denegado — /admin/personal/* inaccesible para cualquier
// admin real hasta este fix.
//
// Idempotente (INSERT IGNORE). Run: railway run --service MySQL node scripts/apply-hr-0156-view-permission.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0156_hr_view_permission";

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0156 — rbac_permissions += 'hr.view' (admin)");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  // ── INSERT permission ────────────────────────────────────────────────────
  const [beforePerm] = await c.query("SELECT id FROM rbac_permissions WHERE `key` = 'hr.view'");
  if (beforePerm.length > 0) {
    console.log("  · skip INSERT rbac_permissions (hr.view ya existe)");
  } else {
    await c.query(
      "INSERT INTO rbac_permissions (`key`, `module`, `action`, `description`) VALUES (?, ?, ?, ?)",
      ["hr.view", "hr", "view", "Ver y gestionar el módulo de Personal / RRHH"]
    );
    console.log("  ✓ INSERT rbac_permissions hr.view");
  }

  // ── Grant to admin ───────────────────────────────────────────────────────
  const [grantExists] = await c.query(`
    SELECT rp.role_id FROM rbac_role_permissions rp
    JOIN rbac_roles r ON r.id = rp.role_id
    JOIN rbac_permissions p ON p.id = rp.permission_id
    WHERE r.\`key\` = 'admin' AND p.\`key\` = 'hr.view'
  `);
  if (grantExists.length > 0) {
    console.log("  · skip GRANT admin→hr.view (ya concedido)");
  } else {
    await c.query(`
      INSERT INTO rbac_role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
      WHERE r.\`key\` = 'admin' AND p.\`key\` = 'hr.view'
    `);
    console.log("  ✓ GRANT admin→hr.view");
  }

  // ── Registrar en __drizzle_migrations ────────────────────────────────────
  console.log("\n[TRACKING] __drizzle_migrations");
  const [exists] = await c.query("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?", [TAG]);
  if (exists[0].n > 0) {
    console.log(`  · skip ${TAG} (ya registrada)`);
  } else {
    await c.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  // ── Post-verificación ────────────────────────────────────────────────────
  const [final] = await c.query(`
    SELECT r.\`key\` AS role, p.\`key\` AS permission
    FROM rbac_role_permissions rp
    JOIN rbac_roles r ON r.id = rp.role_id
    JOIN rbac_permissions p ON p.id = rp.permission_id
    WHERE p.\`key\` = 'hr.view'
  `);
  console.log("\n[DESPUÉS] roles con hr.view:", JSON.stringify(final));
  console.log(final.some(r => r.role === "admin")
    ? "  ✓ OK — admin tiene hr.view"
    : "  ✗ ERROR — admin sigue sin hr.view");

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0156 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
