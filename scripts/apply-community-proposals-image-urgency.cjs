// MG-04 — Community Proposals 2.0 — aplica la migración
// 0158_community_student_proposals_image_urgency.
//
// Añade community_student_proposals.cover_image_url / .urgency. Idempotente.
// Run vía railway ssh (mysql-*.railway.internal no resuelve desde fuera de
// la red privada de Railway) — mismo criterio que apply-student-photo-events.cjs.

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0158_community_student_proposals_image_urgency";

async function addColumnIfMissing(c, table, column, ddl) {
  const [cols] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (cols[0].n > 0) {
    console.log(`  · skip ${table}.${column} (ya existe)`);
  } else {
    await c.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
    console.log(`  ✓ ADD ${table}.${column}`);
  }
}

(async () => {
  console.log("=".repeat(70));
  console.log("MG-04 — Community Proposals 2.0 — cover_image_url / urgency");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  await addColumnIfMissing(c, "community_student_proposals", "cover_image_url", "`cover_image_url` varchar(512)");
  await addColumnIfMissing(c, "community_student_proposals", "urgency", "`urgency` enum('no_rush','soon','urgent')");

  console.log("\n[TRACKING] __drizzle_migrations");
  const [exists] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [TAG]);
  if (exists[0].n > 0) {
    console.log(`  · skip ${TAG} (ya registrada)`);
  } else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración aplicada");
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
