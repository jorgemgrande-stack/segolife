// SEGOLIFE — Communication Center, Brevo Transactional Email &
// Omnichannel Orchestration — migración de schema (spec §19-21). Puramente
// aditiva: notification_deliveries.opened_at/clicked_at (el webhook de
// Brevo los necesita) + tabla nueva email_suppressions (supresión técnica,
// aislada, distinta de notification_preferences). Ver
// drizzle/0145_communication_center_delivery_tracking.sql para el DDL
// documentado.
//
// Idempotente — se puede ejecutar varias veces sin efecto adicional.
//
// Run: railway ssh --service segolife -- node scripts/apply-communication-center-delivery-tracking.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0145_communication_center_delivery_tracking";

async function colExists(c, table, col) {
  const [r] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return r[0].n > 0;
}

async function tableExists(c, table) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
  return r[0].n > 0;
}

(async () => {
  console.log("=".repeat(72));
  console.log("SEGOLIFE — COMMUNICATION CENTER — migración de schema (aditiva)");
  console.log("=".repeat(72));

  const c = await mysql.createConnection({ uri: DB_URL });

  console.log("\n[1/2] notification_deliveries — opened_at / clicked_at");
  if (await colExists(c, "notification_deliveries", "opened_at")) {
    console.log("  · skip notification_deliveries.opened_at (ya existe)");
  } else {
    await c.query(`ALTER TABLE \`notification_deliveries\` ADD COLUMN \`opened_at\` timestamp NULL DEFAULT NULL AFTER \`external_message_id\``);
    console.log("  ✓ ADD notification_deliveries.opened_at");
  }
  if (await colExists(c, "notification_deliveries", "clicked_at")) {
    console.log("  · skip notification_deliveries.clicked_at (ya existe)");
  } else {
    await c.query(`ALTER TABLE \`notification_deliveries\` ADD COLUMN \`clicked_at\` timestamp NULL DEFAULT NULL AFTER \`opened_at\``);
    console.log("  ✓ ADD notification_deliveries.clicked_at");
  }

  console.log("\n[2/2] Tabla email_suppressions");
  if (await tableExists(c, "email_suppressions")) {
    console.log("  · skip CREATE TABLE (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`email_suppressions\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`email\` varchar(320) NOT NULL,
        \`reason\` enum('hard_bounce','blocked','spam','manual') NOT NULL,
        \`source\` varchar(64) NOT NULL,
        \`notes\` varchar(512) DEFAULT NULL,
        \`suppressed_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`email_suppressions_email_unique\` (\`email\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("  ✓ CREATE TABLE email_suppressions");
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [exists] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [TAG]);
  if (exists[0].n > 0) {
    console.log(`  · skip ${TAG} (ya registrada)`);
  } else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  console.log("\n[VERIFICACIÓN]");
  const [cols] = await c.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_deliveries' AND COLUMN_NAME IN ('opened_at','clicked_at')`
  );
  console.table(cols);
  const [[suppressionCount]] = await c.query(`SELECT COUNT(*) AS n FROM email_suppressions`);
  console.log(`email_suppressions filas: ${suppressionCount.n} (debe ser 0 — tabla recién creada)`);

  await c.end();
  console.log("=".repeat(72));
  console.log("FIN — migración Communication Center aplicada");
  console.log("=".repeat(72));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
