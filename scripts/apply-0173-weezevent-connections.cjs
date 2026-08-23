// Cierre F71 — refactor de arquitectura Weezevent (2026-08-23): UNA conexión
// (api_key + access_token) reutilizable, MUCHOS event_integrations que la
// referencian — antes cada event_integration guardaba sus propias
// credenciales, obligando a repetir API Key/Access Token por cada evento.
//
// - CREATE TABLE weezevent_connections
// - ALTER TABLE event_integrations ADD connection_id, external_event_name
// - UNIQUE(provider_id, external_event_id) — no vincular el mismo evento
//   externo dos veces
//
// SEGURIDAD (spec punto 15 del cierre): antes de nada, re-comprueba que
// sigue habiendo 0 integraciones Weezevent reales en producción. Si
// apareciera alguna (creada mientras se preparaba este refactor), el script
// NO la destruye — crea una conexión a partir de sus credenciales existentes
// y migra su connection_id, preservando el vínculo.
//
// Aditiva/migratoria, idempotente (SHOW TABLES / information_schema antes de
// cada cambio).
// Run: railway ssh -- node scripts/apply-0173-weezevent-connections.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0173_weezevent_connections";

async function columnExists(c, table, column) {
  const [rows] = await c.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [table, column]
  );
  return rows[0].n > 0;
}

async function indexExists(c, table, indexName) {
  const [rows] = await c.query(
    "SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?",
    [table, indexName]
  );
  return rows[0].n > 0;
}

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0173 — Weezevent: cuenta/conexión reutilizable + event mappings");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  // ── 1. weezevent_connections ────────────────────────────────────────────
  const [weezeventConnTables] = await c.query("SHOW TABLES LIKE 'weezevent_connections'");
  if (weezeventConnTables.length > 0) {
    console.log("skip CREATE TABLE weezevent_connections (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`weezevent_connections\` (
        \`id\`                          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`status\`                      ENUM('not_configured','connected','error') NOT NULL DEFAULT 'not_configured',
        \`credentials_encrypted\`       TEXT NULL,
        \`credentials_last4\`           VARCHAR(8) NULL,
        \`last_tested_at\`              TIMESTAMP NULL,
        \`last_error_message\`          VARCHAR(512) NULL,
        \`events_accessible_count\`     INT NULL,
        \`discovered_events_cache\`     JSON NULL,
        \`discovered_events_cached_at\` TIMESTAMP NULL,
        \`created_at\`                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\`                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE weezevent_connections");
  }

  // ── 2. Re-comprobación de seguridad (spec punto 15) ─────────────────────
  const [[provider]] = await c.query("SELECT id FROM integration_providers WHERE `key` = 'weezevent'");
  let existingWeezeventRows = [];
  if (provider) {
    const [rows] = await c.query(
      "SELECT id, credentials_encrypted, credentials_last4 FROM event_integrations WHERE provider_id = ?",
      [provider.id]
    );
    existingWeezeventRows = rows;
  }
  console.log(`\n[SEGURIDAD] event_integrations reales para weezevent ahora mismo: ${existingWeezeventRows.length}`);
  let migratedConnectionId = null;
  if (existingWeezeventRows.length > 0) {
    console.log("  ⚠ Se encontraron filas reales — NO se destruyen. Migrando sus credenciales a una conexión...");
    const withCreds = existingWeezeventRows.find(r => r.credentials_encrypted);
    const [insertResult] = await c.execute(
      `INSERT INTO weezevent_connections (status, credentials_encrypted, credentials_last4)
       VALUES (?, ?, ?)`,
      ["not_configured", withCreds ? withCreds.credentials_encrypted : null, withCreds ? withCreds.credentials_last4 : null]
    );
    migratedConnectionId = insertResult.insertId;
    console.log(`  ✓ Conexión creada a partir de credenciales existentes — id=${migratedConnectionId}`);
  } else {
    console.log("  ✓ Confirmado: 0 filas — nada que migrar, refactor limpio.");
  }

  // ── 3. event_integrations.connection_id ─────────────────────────────────
  if (await columnExists(c, "event_integrations", "connection_id")) {
    console.log("\nskip ALTER event_integrations ADD connection_id (ya existe)");
  } else {
    if (existingWeezeventRows.length > 0) {
      // Nullable primero, backfill, luego NOT NULL — nunca NOT NULL directo con filas ya existentes.
      await c.query("ALTER TABLE `event_integrations` ADD COLUMN `connection_id` INT NULL AFTER `provider_id`");
      await c.execute("UPDATE event_integrations SET connection_id = ? WHERE provider_id = ?", [migratedConnectionId, provider.id]);
      await c.query("ALTER TABLE `event_integrations` MODIFY COLUMN `connection_id` INT NOT NULL");
      console.log("✓ ALTER event_integrations ADD connection_id (con backfill real)");
    } else {
      // Tabla vacía — NOT NULL directo, sin necesidad de backfill.
      await c.query("ALTER TABLE `event_integrations` ADD COLUMN `connection_id` INT NOT NULL AFTER `provider_id`");
      console.log("✓ ALTER event_integrations ADD connection_id (tabla vacía, NOT NULL directo)");
    }
  }

  if (await columnExists(c, "event_integrations", "external_event_name")) {
    console.log("skip ALTER event_integrations ADD external_event_name (ya existe)");
  } else {
    await c.query("ALTER TABLE `event_integrations` ADD COLUMN `external_event_name` VARCHAR(256) NULL AFTER `external_event_id`");
    console.log("✓ ALTER event_integrations ADD external_event_name");
  }

  if (await indexExists(c, "event_integrations", "event_integrations_provider_external_unique")) {
    console.log("skip UNIQUE INDEX event_integrations_provider_external_unique (ya existe)");
  } else {
    await c.query(
      "ALTER TABLE `event_integrations` ADD UNIQUE INDEX `event_integrations_provider_external_unique` (`provider_id`, `external_event_id`)"
    );
    console.log("✓ ADD UNIQUE INDEX event_integrations_provider_external_unique");
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
  const [connCount] = await c.query("SELECT COUNT(*) AS n FROM weezevent_connections");
  console.log("[DESPUÉS] filas weezevent_connections:", connCount[0].n);

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0173 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
