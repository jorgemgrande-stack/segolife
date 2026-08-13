// Aplica la migración de LOYALTY PRODUCTION HARDENING — todas las columnas
// nuevas quedan NULL (estado NEUTRO, spec §20: "ninguna migración debe
// activar comportamiento nuevo sobre los Students existentes por sí sola").
// Idempotente — se puede ejecutar varias veces sin efecto adicional.
//
// Run: railway ssh --service segolife -- node scripts/apply-loyalty-production-hardening.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0999_loyalty_production_hardening";

async function colExists(c, table, col) {
  const [r] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return r[0].n > 0;
}

async function addColumn(c, table, col, ddl) {
  if (await colExists(c, table, col)) { console.log(`  · skip ${table}.${col} (ya existe)`); return; }
  await c.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${ddl}`);
  console.log(`  ✓ ADD COLUMN ${table}.${col}`);
}

async function getEnumValues(c, table, col) {
  const [r] = await c.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  if (!r[0]) return [];
  const m = r[0].COLUMN_TYPE.match(/^enum\((.+)\)$/i);
  if (!m) return [];
  return m[1].split(",").map(s => s.replace(/^'|'$/g, ""));
}

async function ensureEnumValue(c, table, col, newValue, notNullDefault) {
  const current = await getEnumValues(c, table, col);
  console.log(`  [ANTES] ${table}.${col} enum: ${current.join(", ")}`);
  if (current.includes(newValue)) { console.log(`  · skip ALTER (ya contiene '${newValue}')`); return; }
  const next = [...current, newValue];
  const literal = next.map(v => `'${v}'`).join(",");
  const nullability = notNullDefault ? `NOT NULL DEFAULT '${notNullDefault}'` : "NULL";
  await c.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${col}\` enum(${literal}) ${nullability}`);
  console.log(`  ✓ ALTER ${table}.${col} — añadido '${newValue}'`);
}

(async () => {
  console.log("=".repeat(72));
  console.log("SEGOLIFE — LOYALTY PRODUCTION HARDENING — migración de schema");
  console.log("=".repeat(72));

  const c = await mysql.createConnection({ uri: DB_URL });

  console.log("\n[1/5] venue_integrations.loyalty_cutoff_override_at");
  await addColumn(c, "venue_integrations", "loyalty_cutoff_override_at", "timestamp NULL DEFAULT NULL");

  console.log("\n[2/5] token_rules — columnas nuevas (weekly_limit, lifetime_limit, scope_ticket_type_id)");
  await addColumn(c, "token_rules", "weekly_limit", "int NULL DEFAULT NULL");
  await addColumn(c, "token_rules", "lifetime_limit", "int NULL DEFAULT NULL");
  await addColumn(c, "token_rules", "scope_ticket_type_id", "int NULL DEFAULT NULL");

  console.log("\n[3/5] token_rules.scope += 'ticket_type'");
  await ensureEnumValue(c, "token_rules", "scope", "ticket_type", "global");

  console.log("\n[4/5] token_rules.recurrence_window += 'lifetime'");
  // recurrence_window es NULLABLE (sin default) — nunca se le fuerza NOT NULL.
  const currentWindow = await getEnumValues(c, "token_rules", "recurrence_window");
  console.log(`  [ANTES] token_rules.recurrence_window enum: ${currentWindow.join(", ")}`);
  if (currentWindow.includes("lifetime")) {
    console.log("  · skip ALTER (ya contiene 'lifetime')");
  } else {
    const next = [...currentWindow, "lifetime"];
    const literal = next.map(v => `'${v}'`).join(",");
    await c.query(`ALTER TABLE \`token_rules\` MODIFY COLUMN \`recurrence_window\` enum(${literal}) NULL DEFAULT NULL`);
    console.log("  ✓ ALTER token_rules.recurrence_window — añadido 'lifetime'");
  }

  console.log("\n[5/5] token_campaigns.max_total_tokens");
  await addColumn(c, "token_campaigns", "max_total_tokens", "int NULL DEFAULT NULL");

  console.log("\n[system_settings] loyalty_global_cutoff_at (fila NEUTRA — value=NULL)");
  const [[existingSetting]] = await c.query(`SELECT COUNT(*) AS n FROM system_settings WHERE \`key\` = 'loyalty_global_cutoff_at'`);
  if (existingSetting.n > 0) {
    console.log("  · skip INSERT (ya existe)");
  } else {
    await c.execute(
      `INSERT INTO system_settings (\`key\`, value, value_type, category, label, description, is_sensitive, is_public)
       VALUES (?, NULL, 'string', 'loyalty', 'Corte global de loyalty (Fourvenues)', ?, 0, 0)`,
      ["loyalty_global_cutoff_at", "Fecha ISO a partir de la cual las operaciones Fourvenues son elegibles para SegoTokens/Benefits. Vacío = sin corte (ninguna operación histórica se excluye por fecha). Un override por venue puede sobrescribir este valor — ver venue_integrations.loyalty_cutoff_override_at."]
    );
    console.log("  ✓ INSERT system_settings.loyalty_global_cutoff_at (NULL)");
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [TAG]);
  if (exists.n > 0) { console.log(`  · skip ${TAG} (ya registrada)`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  console.log("\n" + "=".repeat(72));
  console.log("[VERIFICACIÓN POST — todas las columnas nuevas deben estar NULL para las filas existentes]");
  const [[viCheck]] = await c.query(`SELECT COUNT(*) as total, SUM(loyalty_cutoff_override_at IS NULL) as null_count FROM venue_integrations`);
  console.log("venue_integrations.loyalty_cutoff_override_at:", JSON.stringify(viCheck));
  const [[trCheck]] = await c.query(`SELECT COUNT(*) as total, SUM(weekly_limit IS NULL) as weekly_null, SUM(lifetime_limit IS NULL) as lifetime_null, SUM(scope_ticket_type_id IS NULL) as ticket_type_null FROM token_rules`);
  console.log("token_rules nuevas columnas:", JSON.stringify(trCheck));
  const [[tcCheck]] = await c.query(`SELECT COUNT(*) as total, SUM(max_total_tokens IS NULL) as null_count FROM token_campaigns`);
  console.log("token_campaigns.max_total_tokens:", JSON.stringify(tcCheck));
  const [[settingCheck]] = await c.query(`SELECT \`value\` FROM system_settings WHERE \`key\`='loyalty_global_cutoff_at'`);
  console.log("system_settings.loyalty_global_cutoff_at value:", JSON.stringify(settingCheck?.value ?? null));

  await c.end();
  console.log("=".repeat(72));
  console.log("FIN — migración loyalty production hardening aplicada");
  console.log("=".repeat(72));
})().catch(e => { console.error("ERR", e); process.exit(1); });
