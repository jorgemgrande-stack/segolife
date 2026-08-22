// F71 (Weezevent) — añade loyalty_enabled + loyalty_cutoff_override_at a
// event_integrations, mismas columnas que venue_integrations ya tiene desde
// Production Scheduler (2026-08-13). Sin esto no existe forma de conceder
// SegoTokens/Benefits por asistencia a un evento Weezevent aunque el sync
// esté activo — mismo gate desacoplado que ya usa Fourvenues.
//
// Aditiva, idempotente (information_schema antes de cada ALTER).
// Run: railway ssh -- node scripts/apply-0171-event-integrations-loyalty-enabled.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0171_event_integrations_loyalty_enabled";

async function columnExists(c, table, column) {
  const [rows] = await c.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [table, column]
  );
  return rows[0].n > 0;
}

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0171 — F71: event_integrations.loyalty_enabled / loyalty_cutoff_override_at");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  if (await columnExists(c, "event_integrations", "loyalty_enabled")) {
    console.log("skip ALTER event_integrations ADD loyalty_enabled (ya existe)");
  } else {
    await c.query(
      "ALTER TABLE `event_integrations` ADD COLUMN `loyalty_enabled` BOOLEAN NOT NULL DEFAULT FALSE AFTER `sync_interval_minutes`"
    );
    console.log("✓ ALTER event_integrations ADD loyalty_enabled");
  }

  if (await columnExists(c, "event_integrations", "loyalty_cutoff_override_at")) {
    console.log("skip ALTER event_integrations ADD loyalty_cutoff_override_at (ya existe)");
  } else {
    await c.query(
      "ALTER TABLE `event_integrations` ADD COLUMN `loyalty_cutoff_override_at` TIMESTAMP NULL AFTER `loyalty_enabled`"
    );
    console.log("✓ ALTER event_integrations ADD loyalty_cutoff_override_at");
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [tracked] = await c.query("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?", [TAG]);
  if (tracked[0].n > 0) {
    console.log(`  skip ${TAG} (ya registrada)`);
  } else {
    await c.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  const [finalCols] = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'event_integrations' ORDER BY ordinal_position"
  );
  console.log("\n[DESPUÉS] columnas event_integrations:", JSON.stringify(finalCols.map(r => r.column_name || r.COLUMN_NAME)));

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0171 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
