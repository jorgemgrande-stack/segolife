// LNF-01 — Lost & Found / Objetos perdidos. Crea `lost_found_reports` +
// `lost_found_case_actions` (audit trail), y siembra los permisos RBAC
// lost_found.view / lost_found.process / lost_found.manage:
//   - admin: los 3 (acceso global).
//   - venue_admin / staff: SOLO view + process (nunca manage — esa clave es
//     el marcador de alcance GLOBAL para getVenueStaffAccess; concedérsela
//     a venue_admin le daría acceso a TODOS los venues, no solo el suyo —
//     ver server/segolife/rbac/venueAdminPolicy.ts).
//
// Aditiva, idempotente (SHOW TABLES/information_schema antes de cada cambio).
// Run: railway ssh (contenedor /app) node scripts/apply-0165-lost-found.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0165_lost_found";

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0165 — LNF-01: lost_found_reports + lost_found_case_actions");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  // ── lost_found_reports ────────────────────────────────────────────────────
  const [reportTables] = await c.query("SHOW TABLES LIKE 'lost_found_reports'");
  if (reportTables.length > 0) {
    console.log("skip CREATE TABLE lost_found_reports (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`lost_found_reports\` (
        \`id\`                    INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`student_user_id\`       INT NOT NULL,
        \`venue_id\`              INT NOT NULL,
        \`community_id\`          INT NULL,
        \`lost_date\`             VARCHAR(10) NOT NULL,
        \`approximate_time\`      VARCHAR(5) NULL,
        \`description\`           TEXT NOT NULL,
        \`image_storage_key\`     TEXT NULL,
        \`status\`                ENUM('open','found','closed_not_found') NOT NULL DEFAULT 'open',
        \`conversation_id\`       INT NULL,
        \`resolved_at\`           TIMESTAMP NULL,
        \`resolved_by_user_id\`   INT NULL,
        \`resolution_note\`       TEXT NULL,
        \`created_at\`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`lost_found_reports_student_idx\` (\`student_user_id\`),
        INDEX \`lost_found_reports_venue_idx\` (\`venue_id\`),
        INDEX \`lost_found_reports_status_idx\` (\`status\`),
        INDEX \`lost_found_reports_created_at_idx\` (\`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE lost_found_reports");
  }

  // ── lost_found_case_actions (audit trail) ─────────────────────────────────
  const [actionTables] = await c.query("SHOW TABLES LIKE 'lost_found_case_actions'");
  if (actionTables.length > 0) {
    console.log("skip CREATE TABLE lost_found_case_actions (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`lost_found_case_actions\` (
        \`id\`              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`report_id\`       INT NOT NULL,
        \`actor_user_id\`   INT NOT NULL,
        \`action\`          VARCHAR(64) NOT NULL,
        \`before_value\`    VARCHAR(64) NULL,
        \`after_value\`     VARCHAR(64) NULL,
        \`reason\`          TEXT NULL,
        \`created_at\`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX \`lost_found_case_actions_report_idx\` (\`report_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE lost_found_case_actions");
  }

  // ── RBAC: lost_found.view/.process/.manage → admin (los 3) ────────────────
  const PERMS = [
    ["lost_found.view", "lost_found", "view", "Ver casos de objetos perdidos"],
    ["lost_found.process", "lost_found", "process", "Procesar casos (marcar encontrado/cerrado, reabrir, comunicarse con el Student)"],
    ["lost_found.manage", "lost_found", "manage", "Acceso global a objetos perdidos de cualquier venue (marcador de alcance, exclusivo de admin)"],
  ];
  for (const [key, module, action, description] of PERMS) {
    const [existing] = await c.query("SELECT id FROM rbac_permissions WHERE `key` = ?", [key]);
    if (existing.length > 0) {
      console.log(`  · skip INSERT rbac_permissions (${key} ya existe)`);
    } else {
      await c.query(
        "INSERT INTO rbac_permissions (`key`, module, action, description) VALUES (?, ?, ?, ?)",
        [key, module, action, description]
      );
      console.log(`  ✓ INSERT rbac_permissions ${key}`);
    }

    const [grantExists] = await c.query(`
      SELECT rp.role_id FROM rbac_role_permissions rp
      JOIN rbac_roles r ON r.id = rp.role_id
      JOIN rbac_permissions p ON p.id = rp.permission_id
      WHERE r.\`key\` = 'admin' AND p.\`key\` = ?
    `, [key]);
    if (grantExists.length > 0) {
      console.log(`  · skip GRANT admin→${key} (ya concedido)`);
    } else {
      await c.query(`
        INSERT INTO rbac_role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
        WHERE r.\`key\` = 'admin' AND p.\`key\` = ?
      `, [key]);
      console.log(`  ✓ GRANT admin→${key}`);
    }
  }

  // ── RBAC: lost_found.view/.process → venue_admin + staff (NUNCA .manage) ──
  const VENUE_SCOPED_PERMS = ["lost_found.view", "lost_found.process"];
  for (const roleKey of ["venue_admin", "staff"]) {
    for (const key of VENUE_SCOPED_PERMS) {
      const [grantExists] = await c.query(`
        SELECT rp.role_id FROM rbac_role_permissions rp
        JOIN rbac_roles r ON r.id = rp.role_id
        JOIN rbac_permissions p ON p.id = rp.permission_id
        WHERE r.\`key\` = ? AND p.\`key\` = ?
      `, [roleKey, key]);
      if (grantExists.length > 0) {
        console.log(`  · skip GRANT ${roleKey}→${key} (ya concedido)`);
      } else {
        const [result] = await c.query(`
          INSERT INTO rbac_role_permissions (role_id, permission_id)
          SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
          WHERE r.\`key\` = ? AND p.\`key\` = ?
        `, [roleKey, key]);
        if (result.affectedRows > 0) console.log(`  ✓ GRANT ${roleKey}→${key}`);
        else console.log(`  · skip GRANT ${roleKey}→${key} (rol ${roleKey} no existe todavía en este entorno)`);
      }
    }
  }

  // ── Tracking __drizzle_migrations ─────────────────────────────────────────
  console.log("\n[TRACKING] __drizzle_migrations");
  const [tracked] = await c.query("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?", [TAG]);
  if (tracked[0].n > 0) {
    console.log(`  skip ${TAG} (ya registrada)`);
  } else {
    await c.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  // ── Post-verificación ─────────────────────────────────────────────────────
  const [finalTables] = await c.query("SHOW TABLES LIKE 'lost_found%'");
  const [finalPerms] = await c.query("SELECT `key` FROM rbac_permissions WHERE `key` LIKE 'lost_found.%'");
  const [finalGrants] = await c.query(`
    SELECT r.\`key\` AS role_key, p.\`key\` AS perm_key FROM rbac_role_permissions rp
    JOIN rbac_roles r ON r.id = rp.role_id
    JOIN rbac_permissions p ON p.id = rp.permission_id
    WHERE p.\`key\` LIKE 'lost_found.%'
    ORDER BY r.\`key\`, p.\`key\`
  `);
  console.log("\n[DESPUÉS] tablas:", JSON.stringify(finalTables.map(r => Object.values(r)[0])));
  console.log("[DESPUÉS] permisos:", JSON.stringify(finalPerms.map(r => r.key)));
  console.log("[DESPUÉS] grants:", JSON.stringify(finalGrants.map(r => `${r.role_key}->${r.perm_key}`)));

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0165 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
