// Aplica la migración 0160_crm_view_permission — inserta el permission key
// "crm.view" (usado por staffProcedure en server/_core/trpc.ts, fallback
// legacy admin|agente, pero nunca registrado en rbac_permissions) y lo
// concede a los roles "admin" y "agente".
//
// Confirmado (ver server/nayade.test.ts, test "authenticated user can get
// bookings" y el agente de investigación de deuda de tests): un admin real
// con fila en rbac_user_roles resuelve permisos por RBAC real (nunca lanza
// checkRbacOrLegacy), y al no existir "crm.view" en el catálogo, el
// resultado es siempre acceso denegado — cualquier procedure detrás de
// staffProcedure (bookings.getAll, crm.leads.*, crm.quotes.*,
// commercialFollowup.*, proposals.*, etc.) es inaccesible para CUALQUIER
// admin o agente real hasta este fix, aunque el módulo (crm_module_enabled)
// esté activo. Mismo patrón que scripts/apply-hr-0156-view-permission.cjs.
//
// Idempotente (SELECT-then-INSERT). Run: railway ssh (contenedor /app)
// node scripts/apply-0160-crm-view-permission.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0160_crm_view_permission";
const ROLES = ["admin", "agente"];

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0160 — rbac_permissions += 'crm.view' (admin, agente)");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  // ── INSERT permission ────────────────────────────────────────────────────
  const [beforePerm] = await c.query("SELECT id FROM rbac_permissions WHERE `key` = 'crm.view'");
  if (beforePerm.length > 0) {
    console.log("  · skip INSERT rbac_permissions (crm.view ya existe)");
  } else {
    await c.query(
      "INSERT INTO rbac_permissions (`key`, `module`, `action`, `description`) VALUES (?, ?, ?, ?)",
      ["crm.view", "crm", "view", "Ver y gestionar CRM/leads/presupuestos/reservas del equipo comercial"]
    );
    console.log("  ✓ INSERT rbac_permissions crm.view");
  }

  // ── Grant to admin + agente ──────────────────────────────────────────────
  for (const role of ROLES) {
    const [grantExists] = await c.query(`
      SELECT rp.role_id FROM rbac_role_permissions rp
      JOIN rbac_roles r ON r.id = rp.role_id
      JOIN rbac_permissions p ON p.id = rp.permission_id
      WHERE r.\`key\` = ? AND p.\`key\` = 'crm.view'
    `, [role]);
    if (grantExists.length > 0) {
      console.log(`  · skip GRANT ${role}→crm.view (ya concedido)`);
    } else {
      await c.query(`
        INSERT INTO rbac_role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
        WHERE r.\`key\` = ? AND p.\`key\` = 'crm.view'
      `, [role]);
      console.log(`  ✓ GRANT ${role}→crm.view`);
    }
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
    WHERE p.\`key\` = 'crm.view'
  `);
  console.log("\n[DESPUÉS] roles con crm.view:", JSON.stringify(final));
  const rolesWithGrant = final.map(r => r.role);
  console.log(ROLES.every(r => rolesWithGrant.includes(r))
    ? "  ✓ OK — admin y agente tienen crm.view"
    : "  ✗ ERROR — falta algún rol");

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0160 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
