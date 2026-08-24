// Community — ubicación libre en propuestas (2026-08-24): el estudiante ya
// podía elegir un venue oficial o "Sin venue" al proponer una idea; ahora
// también puede escribir un sitio que no está en el catálogo de venues (su
// casa, un parque, un restaurante nuevo) como texto libre — no hay ninguna
// integración de geocodificación/mapas activamente configurada en SEGOLIFE
// hoy, así que es texto plano, mismo formato que venues.address.
//
// Añade `custom_location_text` a AMBAS tablas (community_student_proposals
// Y community_proposals — la conversión de idea a propuesta formal copia el
// campo tal cual, igual que ya hace con venueId).
//
// Aditiva, idempotente (comprueba la columna antes de cada ALTER).
// Run: railway ssh -- node scripts/apply-0178-community-custom-location.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0178_community_custom_location";
const TABLES = ["community_proposals", "community_student_proposals"];

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0178 — Community: ubicación libre (custom_location_text)");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  for (const table of TABLES) {
    const [[col]] = await c.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'custom_location_text'",
      [table]
    );
    if (col) {
      console.log(`skip ADD COLUMN ${table}.custom_location_text (ya existe)`);
    } else {
      await c.query(`ALTER TABLE \`${table}\` ADD COLUMN \`custom_location_text\` VARCHAR(256) NULL`);
      console.log(`✓ ADD COLUMN ${table}.custom_location_text`);
    }
  }

  const [tracked] = await c.query("SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1", [TAG]);
  if (tracked.length === 0) {
    await c.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`✓ INSERT ${TAG} en __drizzle_migrations`);
  } else {
    console.log(`skip INSERT ${TAG} (ya registrado)`);
  }

  const [verify] = await c.query(
    "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'custom_location_text'"
  );
  console.log("\nColumnas verificadas:", JSON.stringify(verify));

  await c.end();
  console.log("\n✓ Migración 0178 completa.");
})().catch(err => { console.error("✗ FALLÓ:", err); process.exit(1); });
