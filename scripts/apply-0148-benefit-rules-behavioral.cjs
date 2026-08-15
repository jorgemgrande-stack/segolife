// Aplica 0148_benefit_rules_behavioral (BEHAVIORAL BENEFITS RULE ENGINE).
// Idempotente. Puramente aditiva: 2 columnas nullable en benefit_rules
// (el motor existente sigue funcionando igual cuando son NULL) + 3 índices
// que faltaban en columnas ya consultadas en caliente. Ninguna tabla
// existente pierde datos ni cambia semántica.
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function columnExists(c, t, col) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [t, col]);
  return r[0].n > 0;
}
async function idxExists(c, t, idx) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, [t, idx]);
  return r[0].n > 0;
}

(async () => {
  console.log("BEHAVIORAL BENEFITS RULE ENGINE — benefit_rules (0148)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await columnExists(c, "benefit_rules", "aggregate_metric")) {
    console.log("· skip aggregate_metric (ya existe)");
  } else {
    await c.query(`ALTER TABLE \`benefit_rules\` ADD COLUMN \`aggregate_metric\` enum('attendance_count','venue_visit_count','distinct_venues','commerce_count','commerce_quantity','spend_cents') AFTER \`recurrence_window\``);
    console.log("✓ ADD COLUMN aggregate_metric");
  }
  if (await columnExists(c, "benefit_rules", "aggregate_threshold")) {
    console.log("· skip aggregate_threshold (ya existe)");
  } else {
    await c.query(`ALTER TABLE \`benefit_rules\` ADD COLUMN \`aggregate_threshold\` int AFTER \`aggregate_metric\``);
    console.log("✓ ADD COLUMN aggregate_threshold");
  }

  const indexes = [
    ["benefit_rules", "benefit_rules_source_type_active_idx", "(`source_type`, `active`)"],
    ["user_benefits", "user_benefits_user_id_idx", "(`user_id`)"],
    ["user_benefits", "user_benefits_benefit_rule_id_idx", "(`benefit_rule_id`)"],
  ];
  for (const [table, name, cols] of indexes) {
    if (await idxExists(c, table, name)) { console.log(`· skip ${name}`); }
    else { await c.query(`CREATE INDEX \`${name}\` ON \`${table}\` ${cols}`); console.log(`✓ CREATE INDEX ${name}`); }
  }

  const tag = "0148_benefit_rules_behavioral";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [cols] = await c.query(`SHOW COLUMNS FROM benefit_rules`);
  console.log(`\n[POST] benefit_rules: ${cols.length} cols`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
