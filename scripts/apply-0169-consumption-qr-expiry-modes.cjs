// F63 (QR de consumición 2.0) — añade expiry_mode/event_id/
// expiry_duration_minutes/assigned_user_id/assigned_at a
// consumption_qr_codes. Puramente aditivo: todo QR ya emitido recibe
// expiry_mode='from_issue' (su comportamiento real de siempre) y conserva
// exactamente su expires_at ya calculado — nunca se recalcula nada
// retroactivamente. Sin nuevos permisos RBAC.
//
// Idempotente (comprueba columna por columna antes de cada ADD COLUMN).
// Run: railway ssh -- node scripts/apply-0169-consumption-qr-expiry-modes.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0169_consumption_qr_expiry_modes";

async function columnExists(c, table, column) {
  const [rows] = await c.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [table, column]
  );
  return rows[0].n > 0;
}

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0169 — QR de consumición 2.0: modos de caducidad + asignación");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  const columns = [
    { table: "consumption_qr_codes", name: "expiry_mode", ddl: "ALTER TABLE `consumption_qr_codes` ADD COLUMN `expiry_mode` ENUM('from_issue','from_event','from_assignment','custom','none') NOT NULL DEFAULT 'from_issue' AFTER `expires_at`" },
    { table: "consumption_qr_codes", name: "event_id", ddl: "ALTER TABLE `consumption_qr_codes` ADD COLUMN `event_id` INT NULL AFTER `expiry_mode`" },
    { table: "consumption_qr_codes", name: "expiry_duration_minutes", ddl: "ALTER TABLE `consumption_qr_codes` ADD COLUMN `expiry_duration_minutes` INT NULL AFTER `event_id`" },
    { table: "consumption_qr_codes", name: "assigned_user_id", ddl: "ALTER TABLE `consumption_qr_codes` ADD COLUMN `assigned_user_id` INT NULL AFTER `expiry_duration_minutes`" },
    { table: "consumption_qr_codes", name: "assigned_at", ddl: "ALTER TABLE `consumption_qr_codes` ADD COLUMN `assigned_at` TIMESTAMP NULL AFTER `assigned_user_id`" },
    { table: "qr_batches", name: "expiry_mode", ddl: "ALTER TABLE `qr_batches` ADD COLUMN `expiry_mode` ENUM('from_issue','from_event','from_assignment','custom','none') NOT NULL DEFAULT 'from_issue' AFTER `expires_at`" },
    { table: "qr_batches", name: "event_id", ddl: "ALTER TABLE `qr_batches` ADD COLUMN `event_id` INT NULL AFTER `expiry_mode`" },
    { table: "qr_batches", name: "expiry_duration_minutes", ddl: "ALTER TABLE `qr_batches` ADD COLUMN `expiry_duration_minutes` INT NULL AFTER `event_id`" },
  ];

  for (const col of columns) {
    if (await columnExists(c, col.table, col.name)) {
      console.log(`skip ${col.table}.${col.name} (ya existe)`);
    } else {
      await c.query(col.ddl);
      console.log(`✓ ADD COLUMN ${col.table}.${col.name}`);
    }
  }

  // Amplía el ENUM de qr_redemption_attempts.result con 'not_your_qr' (F63).
  // MODIFY COLUMN sobre un ENUM es idempotente en sí mismo (repetirlo con la
  // misma lista de valores no falla ni duplica), pero igualmente se
  // comprueba antes para no reescribir la columna en cada re-ejecución.
  const [resultColumn] = await c.query(
    "SELECT COLUMN_TYPE AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'qr_redemption_attempts' AND column_name = 'result'"
  );
  if (resultColumn[0] && String(resultColumn[0].t).includes("not_your_qr")) {
    console.log("skip enum qr_redemption_attempts.result (ya incluye not_your_qr)");
  } else {
    await c.query(
      "ALTER TABLE `qr_redemption_attempts` MODIFY COLUMN `result` ENUM('success','already_redeemed','expired','cancelled','invalid_token','not_found','venue_inactive','product_inactive','community_not_authorized','outside_schedule','no_rule','rate_limited','error','not_your_qr') NOT NULL"
    );
    console.log("✓ ALTER enum qr_redemption_attempts.result (+ not_your_qr)");
  }

  // Índice para resolver "mis QR asignados" / auditoría por estudiante sin escanear toda la tabla.
  const [idx] = await c.query(
    "SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'consumption_qr_codes' AND index_name = 'consumption_qr_codes_assigned_user_id_idx'"
  );
  if (idx[0].n > 0) {
    console.log("skip índice assigned_user_id (ya existe)");
  } else {
    await c.query("CREATE INDEX `consumption_qr_codes_assigned_user_id_idx` ON `consumption_qr_codes` (`assigned_user_id`)");
    console.log("✓ CREATE INDEX consumption_qr_codes_assigned_user_id_idx");
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [tracked] = await c.query("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?", [TAG]);
  if (tracked[0].n > 0) {
    console.log(`  skip ${TAG} (ya registrada)`);
  } else {
    await c.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  const [check] = await c.query("SHOW COLUMNS FROM `consumption_qr_codes`");
  console.log("\n[DESPUÉS] columnas de consumption_qr_codes:", JSON.stringify(check.map(r => r.Field)));

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0169 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
