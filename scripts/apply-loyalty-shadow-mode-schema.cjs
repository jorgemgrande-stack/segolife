// SEGOLIFE — LOYALTY SHADOW MODE — migración de schema (spec §11/§49-50).
// Puramente ADITIVA: 1 tabla nueva (loyalty_shadow_evaluations, aislada,
// nunca relacionada con token_ledger/token_wallets/user_benefits), 1
// feature flag nuevo (loyalty_shadow_enabled, kill switch INDEPENDIENTE de
// loyalty_enabled/LIVE_MODE_ENABLED — spec §50), 2 system_settings nuevos
// (shadow_started_at informativo, shadow_retention_days preparado pero sin
// borrado automático esta fase — spec §13). Ninguna migración toca
// token_ledger/token_wallets/user_benefits/Fourvenues business tables.
// Idempotente. Run: railway ssh --service segolife -- node scripts/apply-loyalty-shadow-mode-schema.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "1001_loyalty_shadow_mode_schema";

async function tableExists(c, table) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
  return r[0].n > 0;
}

(async () => {
  console.log("=".repeat(72));
  console.log("SEGOLIFE — LOYALTY SHADOW MODE — migración de schema (aditiva)");
  console.log("=".repeat(72));

  const c = await mysql.createConnection({ uri: DB_URL });

  console.log("\n[1/3] Tabla loyalty_shadow_evaluations");
  if (await tableExists(c, "loyalty_shadow_evaluations")) {
    console.log("  · skip CREATE TABLE (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`loyalty_shadow_evaluations\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`provider\` varchar(32) NOT NULL,
        \`external_operation_id\` varchar(191) NOT NULL,
        \`trigger\` enum('EVENT_PURCHASE','EVENT_ATTENDANCE','EVENT_REFUND','EVENT_CANCEL','PENDING_TO_PAID') NOT NULL,
        \`operation_state\` varchar(32) DEFAULT NULL,
        \`user_id\` int DEFAULT NULL,
        \`venue_id\` int DEFAULT NULL,
        \`event_id\` int DEFAULT NULL,
        \`community_id\` int DEFAULT NULL,
        \`rule_id\` int DEFAULT NULL,
        \`rule_policy_version\` timestamp NULL DEFAULT NULL,
        \`campaign_id\` int DEFAULT NULL,
        \`campaign_policy_version\` timestamp NULL DEFAULT NULL,
        \`eligible\` boolean NOT NULL,
        \`decision\` enum('GRANTED','DENIED','SIMULATED_REVERSAL') NOT NULL,
        \`denial_reason\` varchar(32) DEFAULT NULL,
        \`base_tokens\` int DEFAULT NULL,
        \`recurrence_tokens\` int DEFAULT NULL,
        \`campaign_tokens\` int DEFAULT NULL,
        \`cap_applied\` boolean NOT NULL DEFAULT false,
        \`final_tokens\` int DEFAULT NULL,
        \`is_reversal\` boolean NOT NULL DEFAULT false,
        \`original_shadow_evaluation_id\` int DEFAULT NULL,
        \`evaluated_at\` timestamp NOT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`loyalty_shadow_evaluations_operation_trigger_unique\` (\`provider\`, \`external_operation_id\`, \`trigger\`),
        KEY \`loyalty_shadow_evaluations_user_id_idx\` (\`user_id\`),
        KEY \`loyalty_shadow_evaluations_venue_id_idx\` (\`venue_id\`),
        KEY \`loyalty_shadow_evaluations_evaluated_at_idx\` (\`evaluated_at\`),
        KEY \`loyalty_shadow_evaluations_trigger_idx\` (\`trigger\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("  ✓ CREATE TABLE loyalty_shadow_evaluations");
  }

  console.log("\n[1b/3] Tabla loyalty_shadow_errors (observabilidad de fallos, spec §42)");
  if (await tableExists(c, "loyalty_shadow_errors")) {
    console.log("  · skip CREATE TABLE (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`loyalty_shadow_errors\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`provider\` varchar(32) DEFAULT NULL,
        \`external_operation_id\` varchar(191) DEFAULT NULL,
        \`trigger\` varchar(32) DEFAULT NULL,
        \`error_message\` varchar(512) NOT NULL,
        \`occurred_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`loyalty_shadow_errors_occurred_at_idx\` (\`occurred_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("  ✓ CREATE TABLE loyalty_shadow_errors");
  }

  console.log("\n[2/3] feature_flags.loyalty_shadow_enabled (kill switch independiente, default OFF)");
  const [[flagExists]] = await c.query(`SELECT COUNT(*) AS n FROM feature_flags WHERE \`key\` = 'loyalty_shadow_enabled'`);
  if (flagExists.n > 0) {
    console.log("  · skip INSERT (ya existe)");
  } else {
    await c.execute(
      `INSERT INTO feature_flags (\`key\`, name, description, module, enabled, default_enabled, risk_level)
       VALUES (?, ?, ?, 'loyalty', 0, 0, 'medium')`,
      [
        "loyalty_shadow_enabled",
        "Loyalty Shadow Mode",
        "Observa tráfico real (compras/asistencias/refunds/cancelaciones/pending→paid) y calcula qué SegoTokens habría concedido el Reward Engine, SIN escribir en token_ledger/token_wallets/user_benefits. Independiente de venue_integrations.loyalty_enabled y de LIVE_MODE_ENABLED — activarlo NUNCA activa loyalty real.",
      ]
    );
    console.log("  ✓ INSERT feature_flags.loyalty_shadow_enabled (enabled=0)");
  }

  console.log("\n[3/3] system_settings — loyalty_shadow_started_at / loyalty_shadow_retention_days");
  const settingsToInsert = [
    ["loyalty_shadow_started_at", null, "string", "loyalty", "Inicio de observación Shadow", "Fecha ISO de la primera activación de Loyalty Shadow Mode — puramente informativo para el admin UI, nunca gatea qué se observa (eso ya lo garantiza la idempotencia de loyalty_shadow_evaluations sobre operaciones ya sincronizadas)."],
    ["loyalty_shadow_retention_days", "90", "number", "loyalty", "Retención de observaciones Shadow (días)", "Ventana de retención configurable para loyalty_shadow_evaluations. Mecanismo preparado (ver scripts/shadow-retention-cleanup.cjs) — NINGÚN borrado automático se ejecuta todavía en esta fase sin una política explícita posterior."],
  ];
  for (const [key, value, valueType, category, label, description] of settingsToInsert) {
    const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM system_settings WHERE \`key\` = ?`, [key]);
    if (exists.n > 0) { console.log(`  · skip ${key} (ya existe)`); continue; }
    await c.execute(
      `INSERT INTO system_settings (\`key\`, value, value_type, category, label, description, is_sensitive, is_public)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
      [key, value, valueType, category, label, description]
    );
    console.log(`  ✓ INSERT system_settings.${key} (${value === null ? "NULL" : value})`);
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [TAG]);
  if (exists.n > 0) { console.log(`  · skip ${TAG} (ya registrada)`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  console.log("\n[VERIFICACIÓN]");
  const [[count]] = await c.query(`SELECT COUNT(*) AS n FROM loyalty_shadow_evaluations`);
  console.log("loyalty_shadow_evaluations filas:", count.n, "(debe ser 0 — tabla recién creada)");
  const [[errCount]] = await c.query(`SELECT COUNT(*) AS n FROM loyalty_shadow_errors`);
  console.log("loyalty_shadow_errors filas:", errCount.n, "(debe ser 0 — tabla recién creada)");
  const [flags] = await c.query(`SELECT \`key\`, enabled FROM feature_flags WHERE \`key\` = 'loyalty_shadow_enabled'`);
  console.log("feature_flags:", JSON.stringify(flags));
  const [settings] = await c.query(`SELECT \`key\`, value FROM system_settings WHERE \`key\` LIKE 'loyalty_shadow%'`);
  console.log("system_settings:", JSON.stringify(settings));

  await c.end();
  console.log("=".repeat(72));
  console.log("FIN — migración Loyalty Shadow Mode aplicada");
  console.log("=".repeat(72));
})().catch(e => { console.error("ERR", e); process.exit(1); });
