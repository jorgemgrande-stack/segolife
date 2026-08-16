// Aplica 0155_presential_token_payment_requests (SEGOLIFE PRE-16.1 —
// Presential SegoTokens Payments). Idempotente. Puramente aditiva: 1 tabla
// nueva. Ninguna tabla existente (token_spend_reservations, etc.) cambia de
// estructura.
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function tableExists(c, t) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t]);
  return r[0].n > 0;
}

(async () => {
  console.log("PRESENTIAL SEGOTOKENS PAYMENTS (0155)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await tableExists(c, "token_payment_requests")) {
    console.log("· skip token_payment_requests (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`token_payment_requests\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`token_reservation_id\` int NOT NULL,
        \`status\` enum('pending','confirmed','rejected','expired','cancelled','settled') NOT NULL DEFAULT 'pending',
        \`idempotency_key\` varchar(191) NOT NULL,
        \`order_context_type\` enum('pos','door') NOT NULL,
        \`settled_order_id\` int DEFAULT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`responded_at\` timestamp NULL DEFAULT NULL,
        \`settled_at\` timestamp NULL DEFAULT NULL,
        \`cancelled_at\` timestamp NULL DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`token_payment_requests_idempotency_key_unique\` (\`idempotency_key\`),
        KEY \`token_payment_requests_reservation_idx\` (\`token_reservation_id\`),
        KEY \`token_payment_requests_status_idx\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✓ CREATE TABLE token_payment_requests");
  }

  const tag = "0155_presential_token_payment_requests";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [[count]] = await c.query(`SELECT COUNT(*) AS n FROM token_payment_requests`);
  console.log(`\n[POST] token_payment_requests: ${count.n} filas (debe ser 0 tras un deploy limpio)`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
