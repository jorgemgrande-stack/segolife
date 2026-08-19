// MG-03B — Profile Photo Activity — aplica la migración 0157_student_photo_events.
//
// Crea la tabla student_photo_events (mínima, mismo patrón que
// student_login_events). Idempotente. Run: railway run --service MySQL node scripts/apply-student-photo-events.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0157_student_photo_events";

(async () => {
  console.log("=".repeat(70));
  console.log("MG-03B — Profile Photo Activity — student_photo_events");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  const [tables] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student_photo_events'`
  );
  if (tables[0].n > 0) {
    console.log("  · skip student_photo_events (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`student_photo_events\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`user_id\` int NOT NULL,
        \`occurred_at\` timestamp NOT NULL DEFAULT (now()),
        \`action\` enum('added','updated','removed') NOT NULL,
        CONSTRAINT \`student_photo_events_id\` PRIMARY KEY(\`id\`)
      )
    `);
    await c.query("ALTER TABLE `student_photo_events` ADD INDEX `student_photo_events_user_id_idx` (`user_id`)");
    console.log("  ✓ CREATE TABLE student_photo_events + index");
  }

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
