// Aplica 0153_segotokens_economy_control_center (SEGOTOKENS ECONOMY CONTROL
// CENTER). Idempotente. Puramente aditiva: 1 tabla nueva. Ninguna tabla
// existente (token_rules/token_campaigns/token_redemption_policies/
// referral_campaigns) cambia de estructura.
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function tableExists(c, t) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t]);
  return r[0].n > 0;
}

(async () => {
  console.log("SEGOTOKENS ECONOMY CONTROL CENTER (0153)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await tableExists(c, "economy_config_changes")) {
    console.log("· skip economy_config_changes (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`economy_config_changes\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`entity_type\` enum('token_rule','redemption_policy','campaign','referral_campaign') NOT NULL,
        \`entity_id\` int NOT NULL,
        \`field_name\` varchar(64) NOT NULL,
        \`old_value\` varchar(256),
        \`new_value\` varchar(256),
        \`reason\` varchar(500),
        \`actor_user_id\` int NOT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`economy_config_changes_entity_idx\` (\`entity_type\`, \`entity_id\`),
        KEY \`economy_config_changes_created_at_idx\` (\`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✓ CREATE TABLE economy_config_changes");
  }

  const tag = "0153_segotokens_economy_control_center";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [[changes]] = await c.query(`SELECT COUNT(*) AS n FROM economy_config_changes`);
  console.log(`\n[POST] economy_config_changes: ${changes.n} (debe ser 0 tras un deploy limpio)`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
