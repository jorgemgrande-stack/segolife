// Aplica la corrección 0161 — SEC-01 (BUG-B: divergencia de RBAC entre
// administradores). Concede el rol RBAC canónico "admin" a las cuentas
// cuyo campo legacy users.role ya dice "admin" pero cuya asignación RBAC
// real no coincide (o falta), para que TODO admin resuelva el mismo
// conjunto canónico de permisos (Admin Parity Rule, SEC-01 §15) — nunca un
// hack por email en tiempo de ejecución, solo una corrección de datos
// puntual e idempotente.
//
// Root cause confirmado por lectura de solo lectura antes de este fix:
// - herre.casanova@gmail.com: users.role="admin", pero rbac_user_roles
//   solo tenía asignado el rol "venue_admin" (8 permisos operativos de
//   venue), nunca "admin" (90 permisos). checkRbacOrLegacy() es RBAC-first
//   (si el usuario tiene filas reales en rbac_user_roles, se usan SOLO
//   esas, ignorando el campo legacy) — de ahí que Herre no viera Usuarios
//   ni el resto de superficies exclusivas de Admin global pese a que su
//   propio perfil decía "admin".
// - qa.admin@segolife.es: users.role="admin", CERO filas en
//   rbac_user_roles — hoy resuelve permisos correctamente solo porque
//   getUserPermissions() cae al fallback "sin filas RBAC → derivar del
//   campo legacy", un mecanismo implícito y frágil: el mismo bug de Herre
//   se repetiría en cuanto alguien le asignara CUALQUIER rol RBAC parcial
//   sin también concederle "admin" explícitamente. Se corrige aquí por
//   consistencia/prevención, no porque esté rota hoy.
//
// Esta es una corrección ADITIVA, nunca destructiva (SEC-01 §17/§30:
// preferir INSERT IGNORE/upsert seguro, nunca DELETE): se AÑADE el rol
// "admin" a cada cuenta, sin tocar ni eliminar ningún rol existente (p.ej.
// "venue_admin" de Herre). Es seguro que un usuario tenga ambos roles a la
// vez — getUserPermissions() calcula la UNIÓN de los permisos de todos los
// roles asignados, y el bundle de venue_admin (8 permisos) es un
// subconjunto estricto del de admin (90) — no cambia nada tenerlo también,
// y evita cualquier riesgo de romper una asignación de venue/staff que
// dependa de que esa fila siga existiendo.
//
// Idempotente (SELECT-then-INSERT). Run: railway ssh (contenedor /app)
// node scripts/apply-0161-herre-canonical-admin-role.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TARGET_EMAILS = ["herre.casanova@gmail.com", "qa.admin@segolife.es"];
const CANONICAL_ADMIN_ROLE_KEY = "admin";
const TAG = "0161_admin_rbac_parity";

(async () => {
  console.log("=".repeat(70));
  console.log("CORRECCIÓN 0161 — SEC-01 BUG-B: rol RBAC canónico 'admin' (parity)");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  const [roleRows] = await c.query("SELECT id FROM rbac_roles WHERE `key` = ?", [CANONICAL_ADMIN_ROLE_KEY]);
  if (roleRows.length === 0) {
    console.error(`ABORTADO: no existe el rol RBAC "${CANONICAL_ADMIN_ROLE_KEY}" en el catálogo`);
    await c.end();
    process.exit(1);
  }
  const adminRoleId = roleRows[0].id;

  for (const email of TARGET_EMAILS) {
    console.log(`\n--- ${email} ---`);
    const [userRows] = await c.query("SELECT id, email, role FROM users WHERE email = ?", [email]);
    if (userRows.length === 0) {
      console.error(`  ABORTADO para este usuario: no existe ningún usuario con email ${email}`);
      continue;
    }
    const userId = userRows[0].id;
    console.log(`  · usuario encontrado: id=${userId}, users.role="${userRows[0].role}"`);

    const [before] = await c.query(`
      SELECT rr.\`key\` FROM rbac_user_roles ur
      JOIN rbac_roles rr ON rr.id = ur.role_id
      WHERE ur.user_id = ?
    `, [userId]);
    console.log("  · roles ANTES:", JSON.stringify(before.map(r => r.key)));

    const [exists] = await c.query(
      "SELECT 1 FROM rbac_user_roles WHERE user_id = ? AND role_id = ?",
      [userId, adminRoleId]
    );
    if (exists.length > 0) {
      console.log(`  · skip INSERT (ya tenía el rol "${CANONICAL_ADMIN_ROLE_KEY}" asignado)`);
    } else {
      await c.query(
        "INSERT INTO rbac_user_roles (user_id, role_id, created_at) VALUES (?, ?, NOW())",
        [userId, adminRoleId]
      );
      console.log(`  ✓ INSERT rbac_user_roles (user_id=${userId}, role="${CANONICAL_ADMIN_ROLE_KEY}")`);
    }

    const [permsAfter] = await c.query(`
      SELECT DISTINCT p.\`key\` FROM rbac_user_roles ur
      JOIN rbac_role_permissions rrp ON rrp.role_id = ur.role_id
      JOIN rbac_permissions p ON p.id = rrp.permission_id
      WHERE ur.user_id = ?
    `, [userId]);
    console.log(`  · permisos efectivos DESPUÉS: ${permsAfter.length}`);
    console.log(permsAfter.some(p => p.key === "users.view") && permsAfter.some(p => p.key === "users.manage")
      ? "  ✓ OK — resuelve users.view y users.manage"
      : "  ✗ ERROR — sigue sin users.view/users.manage");
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [tracked] = await c.query("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?", [TAG]);
  if (tracked[0].n > 0) {
    console.log(`  · skip ${TAG} (ya registrada)`);
  } else {
    await c.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — corrección 0161 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
