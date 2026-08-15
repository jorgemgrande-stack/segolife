// Aplica 0149_segotokens_universal_spend (SEGOTOKENS UNIVERSAL SPEND &
// MIXED PAYMENTS). Idempotente. Puramente aditiva: 2 tablas nuevas + 1
// columna nullable en commerce_transactions. Ninguna tabla existente pierde
// datos ni cambia semántica. token_wallets/token_ledger NO se tocan.
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function tableExists(c, t) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t]);
  return r[0].n > 0;
}
async function columnExists(c, t, col) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [t, col]);
  return r[0].n > 0;
}

(async () => {
  console.log("SEGOTOKENS UNIVERSAL SPEND & MIXED PAYMENTS (0149)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await tableExists(c, "token_redemption_policies")) {
    console.log("· skip token_redemption_policies (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`token_redemption_policies\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`name\` varchar(256) NOT NULL,
        \`description\` text,
        \`active\` boolean NOT NULL DEFAULT true,
        \`community_id\` int DEFAULT NULL,
        \`venue_id\` int DEFAULT NULL,
        \`event_id\` int DEFAULT NULL,
        \`tokens_per_unit\` int NOT NULL DEFAULT 1,
        \`value_cents_per_unit\` int NOT NULL,
        \`min_token_spend\` int DEFAULT NULL,
        \`max_token_spend\` int DEFAULT NULL,
        \`max_percentage\` int DEFAULT NULL,
        \`allow_full_token_payment\` boolean NOT NULL DEFAULT false,
        \`starts_at\` timestamp NULL DEFAULT NULL,
        \`ends_at\` timestamp NULL DEFAULT NULL,
        \`priority\` int NOT NULL DEFAULT 0,
        \`created_by_user_id\` int DEFAULT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`token_redemption_policies_active_idx\` (\`active\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✓ CREATE TABLE token_redemption_policies");
  }

  if (await tableExists(c, "token_spend_reservations")) {
    console.log("· skip token_spend_reservations (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`token_spend_reservations\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL,
        \`wallet_id\` int NOT NULL,
        \`policy_id\` int DEFAULT NULL,
        \`venue_id\` int DEFAULT NULL,
        \`event_id\` int DEFAULT NULL,
        \`community_id\` int DEFAULT NULL,
        \`reference_type\` varchar(64) NOT NULL,
        \`reference_id\` int DEFAULT NULL,
        \`gross_amount_cents\` int NOT NULL,
        \`tokens_reserved\` int NOT NULL,
        \`promotional_value_cents\` int NOT NULL,
        \`money_due_cents\` int NOT NULL,
        \`status\` enum('reserved','captured','released','expired','reversed') NOT NULL DEFAULT 'reserved',
        \`idempotency_key\` varchar(191) NOT NULL,
        \`ledger_id\` int DEFAULT NULL,
        \`reversal_ledger_id\` int DEFAULT NULL,
        \`expires_at\` timestamp NOT NULL,
        \`created_by_user_id\` int DEFAULT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`captured_at\` timestamp NULL DEFAULT NULL,
        \`released_at\` timestamp NULL DEFAULT NULL,
        \`reversed_at\` timestamp NULL DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`token_spend_reservations_idempotency_key_unique\` (\`idempotency_key\`),
        KEY \`token_spend_reservations_user_id_idx\` (\`user_id\`),
        KEY \`token_spend_reservations_status_idx\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✓ CREATE TABLE token_spend_reservations");
  }

  if (await columnExists(c, "commerce_transactions", "token_reservation_id")) {
    console.log("· skip commerce_transactions.token_reservation_id (ya existe)");
  } else {
    await c.query(`ALTER TABLE \`commerce_transactions\` ADD COLUMN \`token_reservation_id\` int DEFAULT NULL AFTER \`loyalty_ledger_id\``);
    console.log("✓ ADD COLUMN commerce_transactions.token_reservation_id");
  }

  const tag = "0149_segotokens_universal_spend";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [cols1] = await c.query(`SHOW COLUMNS FROM token_redemption_policies`);
  const [cols2] = await c.query(`SHOW COLUMNS FROM token_spend_reservations`);
  console.log(`\n[POST] token_redemption_policies: ${cols1.length} cols · token_spend_reservations: ${cols2.length} cols`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
