// Aplica 0147_venue_visits (VENUE & PARTNER APP). Idempotente. Puramente
// aditiva: tabla nueva, ninguna existente se modifica.
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function tableExists(c, t) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t]);
  return r[0].n > 0;
}

(async () => {
  console.log("VENUE & PARTNER APP — venue_visits (0147)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await tableExists(c, "venue_visits")) {
    console.log("· skip venue_visits (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`venue_visits\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`venue_id\` int NOT NULL,
        \`event_attendance_id\` int DEFAULT NULL,
        \`occurred_at\` timestamp NOT NULL,
        \`operational_date\` varchar(10) NOT NULL,
        \`source\` varchar(32) NOT NULL,
        \`operator_user_id\` int DEFAULT NULL,
        \`idempotency_key\` varchar(191) NOT NULL,
        \`metadata\` json DEFAULT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`venue_visits_idempotency_key_unique\` (\`idempotency_key\`),
        KEY \`venue_visits_user_id_idx\` (\`user_id\`),
        KEY \`venue_visits_venue_id_idx\` (\`venue_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✓ CREATE TABLE venue_visits");
  }

  const tag = "0147_venue_visits";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [cols] = await c.query(`SHOW COLUMNS FROM venue_visits`);
  console.log(`\n[POST] venue_visits: ${cols.length} cols`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
