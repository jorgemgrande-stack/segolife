/**
 * import-seed.mjs
 * Imports all catalog and configuration data from /data/seed.json into the database.
 * Run: node scripts/import-seed.mjs
 *
 * ⚠️  WARNING: This script TRUNCATES the target tables before inserting.
 *     Only run on a fresh/empty database.
 *
 * ⚠️⚠️  data/seed.json is the REAL catalog of Náyade Experiences (a real,
 *     unrelated business) — categories, experiences, room types, spa
 *     treatments, restaurants, static_pages, and email_templates whose
 *     body_html contains the real contact address
 *     reservas@nayadeexperiences.es. Running this against a Segolife
 *     database inserts that real third-party content and contact address.
 *     This is NOT the Segolife seed — for Segolife data use `pnpm db:seed`
 *     instead. Requires explicit CONFIRM_LEGACY_NAYADE_SEED=yes to run.
 */
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
config();

if (process.env.CONFIRM_LEGACY_NAYADE_SEED !== "yes") {
  console.error(
    "❌ Este script siembra el catálogo REAL de Náyade Experiences (un negocio real ajeno a Segolife), " +
    "incluyendo su email de contacto real en plantillas de email. No es el seed de Segolife " +
    "— usa 'pnpm db:seed' para eso. Si de verdad quieres ejecutar este script heredado, " +
    "vuelve a lanzarlo con CONFIRM_LEGACY_NAYADE_SEED=yes."
  );
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, "../data/seed.json");

if (!fs.existsSync(seedPath)) {
  console.error("❌ data/seed.json not found. Run export-seed.mjs first.");
  process.exit(1);
}

const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
const pool = mysql.createPool(process.env.DATABASE_URL);

/**
 * Insert rows into a table, skipping on duplicate key.
 */
async function insertTable(conn, tableName, rows) {
  if (!rows || rows.length === 0) {
    console.log(`  ⏭  ${tableName}: empty, skipping`);
    return;
  }
  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => "?").join(", ");
  const colList = cols.map((c) => `\`${c}\``).join(", ");
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const values = cols.map((c) => {
      const v = row[c];
      // Convert objects/arrays back to JSON strings
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        return JSON.stringify(v);
      }
      return v;
    });
    try {
      await conn.execute(
        `INSERT IGNORE INTO \`${tableName}\` (${colList}) VALUES (${placeholders})`,
        values
      );
      inserted++;
    } catch (err) {
      // Log but continue
      console.warn(`    ⚠  Row skipped in ${tableName}: ${err.message.slice(0, 80)}`);
      skipped++;
    }
  }
  console.log(`  ✅ ${tableName}: ${inserted} inserted, ${skipped} skipped`);
}

async function main() {
  console.log("🌱 Importing seed data into database...");
  console.log(`📅 Seed exported at: ${seed._meta?.exportedAt ?? "unknown"}`);
  console.log("");

  const conn = await pool.getConnection();

  try {
    await conn.execute("SET FOREIGN_KEY_CHECKS = 0");

    // Import in dependency order (parent tables first)
    const importOrder = [
      "categories",
      "locations",
      "suppliers",
      "platforms",
      "monitors",
      "expense_categories",
      "cash_registers",
      "document_counters",
      "coupon_email_config",
      "discount_codes",
      "experiences",
      "experience_variants",
      "product_time_slots",
      "packs",
      "pack_cross_sells",
      "lego_packs",
      "lego_pack_lines",
      "room_types",
      "room_rates",
      "room_rate_seasons",
      "spa_categories",
      "spa_treatments",
      "spa_resources",
      "restaurants",
      "menu_items",
      "restaurant_shifts",
      "restaurant_staff",
      "site_settings",
      "static_pages",
      "page_blocks",
      "slideshow_items",
      "gallery_items",
      "home_module_items",
      "ticketing_products",
      "email_templates",
      "media_files",
      "reviews",
      "platform_products",
    ];

    for (const table of importOrder) {
      if (seed[table]) {
        await insertTable(conn, table, seed[table]);
      }
    }

    await conn.execute("SET FOREIGN_KEY_CHECKS = 1");
  } finally {
    conn.release();
  }

  await pool.end();
  console.log("\n🎉 Seed import complete!");
  console.log("\nNext steps:");
  console.log("  1. pnpm drizzle-kit generate  (if schema changes exist)");
  console.log("  2. pnpm dev  (start the development server)");
}

main().catch((err) => {
  console.error("❌ Import failed:", err);
  process.exit(1);
});
