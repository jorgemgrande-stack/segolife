// SEGOLIFE — Benefits Marketplace & SegoTokens Redemption — migración de
// schema (spec §6/§67). Puramente aditiva sobre `benefit_definitions`: 7
// columnas nuevas, todas NULL por defecto salvo `is_marketplace_enabled`
// (nace en false para TODA definición ya existente — ningún Benefit
// automático se vuelve comprable con SegoTokens por accidente). No toca
// `user_benefits` (el origen "token_purchase" reutiliza su columna
// sourceType existente, sin cambio de schema) ni ninguna tabla de
// Fourvenues/Native Ticketing/Community/Loyalty. Ver drizzle/0144_
// benefits_marketplace_tokens.sql para el DDL documentado.
//
// Idempotente — se puede ejecutar varias veces sin efecto adicional.
//
// Run: railway ssh --service segolife -- node scripts/apply-benefits-marketplace-schema.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0144_benefits_marketplace_tokens";
const TABLE = "benefit_definitions";
const COLUMNS = [
  { name: "token_cost", ddl: "int DEFAULT NULL", after: "terms_es" },
  { name: "is_marketplace_enabled", ddl: "boolean NOT NULL DEFAULT false", after: "token_cost" },
  { name: "marketplace_inventory_total", ddl: "int DEFAULT NULL", after: "is_marketplace_enabled" },
  { name: "per_student_purchase_limit", ddl: "int DEFAULT NULL", after: "marketplace_inventory_total" },
  { name: "purchase_window_start", ddl: "timestamp NULL DEFAULT NULL", after: "per_student_purchase_limit" },
  { name: "purchase_window_end", ddl: "timestamp NULL DEFAULT NULL", after: "purchase_window_start" },
  { name: "redemption_validity_days", ddl: "int DEFAULT NULL", after: "purchase_window_end" },
];

async function colExists(c, table, col) {
  const [r] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return r[0].n > 0;
}

(async () => {
  console.log("=".repeat(72));
  console.log("SEGOLIFE — BENEFITS MARKETPLACE — migración de schema (aditiva)");
  console.log("=".repeat(72));

  const c = await mysql.createConnection({ uri: DB_URL });

  console.log(`\n[1/2] ${TABLE} — 7 columnas nuevas`);
  for (const col of COLUMNS) {
    if (await colExists(c, TABLE, col.name)) {
      console.log(`  · skip ${TABLE}.${col.name} (ya existe)`);
      continue;
    }
    await c.query(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`${col.name}\` ${col.ddl} AFTER \`${col.after}\``);
    console.log(`  ✓ ADD ${TABLE}.${col.name}`);
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
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?)`,
    [TABLE, COLUMNS.map(c2 => c2.name)]
  );
  console.table(cols);
  const [[marketplaceCount]] = await c.query(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE is_marketplace_enabled = true`);
  console.log(`Definiciones con is_marketplace_enabled=true tras la migración: ${marketplaceCount.n} (debe ser 0 — ninguna decisión comercial tomada todavía)`);

  await c.end();
  console.log("=".repeat(72));
  console.log("FIN — migración Benefits Marketplace aplicada");
  console.log("=".repeat(72));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
