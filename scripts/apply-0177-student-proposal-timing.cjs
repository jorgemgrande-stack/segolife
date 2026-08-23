// Community Student Proposals — timing preciso (2026-08-23): ensancha
// `suggested_date` de DATE a TIMESTAMP (preserva filas existentes con hora
// 00:00) y añade `voting_closes_at` (cuándo deja de poder apoyarse la idea).
// Sustituye los botones vagos "Este finde"/"La semana que viene" +
// urgencia de 3 niveles por día+hora reales y los mismos presets rápidos
// que ya usa Admin al crear una propuesta formal.
//
// IMPORTANTE — TIMESTAMP, nunca DATETIME: drizzle-orm's `timestamp()` (usado
// en schema.ts, sin `{mode:"string"}`) asume semántica de MySQL TIMESTAMP
// (con conversión de zona horaria en el propio servidor MySQL), igual que
// TODAS las demás columnas timestamp de este proyecto (created_at/updated_at
// en cada tabla, accepted_at de legal_acceptances, etc.). Usar DATETIME aquí
// (bug real detectado en QA local de esta fase — verificado empíricamente
// con un E2E real: un preset de "30 min" acababa guardando una hora 2h
// distinta de la esperada) rompe esa asunción: DATETIME no convierte según
// zona horaria de sesión, así que un valor escrito por drizzle (que asume
// TIMESTAMP) y leído por un cliente mysql2 distinto (que interpreta la
// cadena naive de DATETIME como hora local de SU PROPIO proceso) puede
// desincronizarse exactamente por el offset de la zona horaria.
//
// Aditiva/ensanchamiento, idempotente (comprueba el tipo/columna actual
// antes de cada ALTER) — corrige también instalaciones que ya aplicaron
// una versión anterior de este script con DATETIME por error.
// Run: railway ssh -- node scripts/apply-0177-student-proposal-timing.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0177_student_proposal_timing";

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0177 — community_student_proposals: timing preciso");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  // ── suggested_date: DATE (o DATETIME de una aplicación previa buggeada) -> TIMESTAMP ──
  const [[suggestedDateCol]] = await c.query(
    "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_student_proposals' AND COLUMN_NAME = 'suggested_date'"
  );
  if (!suggestedDateCol) {
    console.error("ABORTADO: no se encuentra community_student_proposals.suggested_date");
    process.exit(1);
  }
  if (suggestedDateCol.DATA_TYPE === "date" || suggestedDateCol.DATA_TYPE === "datetime") {
    await c.query("ALTER TABLE `community_student_proposals` MODIFY COLUMN `suggested_date` TIMESTAMP NULL");
    console.log(`✓ ALTER suggested_date ${suggestedDateCol.DATA_TYPE} -> TIMESTAMP`);
  } else {
    console.log(`skip ALTER suggested_date (ya es ${suggestedDateCol.DATA_TYPE})`);
  }

  // ── voting_closes_at (nueva, o corrección si una aplicación previa la creó como DATETIME) ──
  const [[votingClosesCol]] = await c.query(
    "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_student_proposals' AND COLUMN_NAME = 'voting_closes_at'"
  );
  if (!votingClosesCol) {
    await c.query("ALTER TABLE `community_student_proposals` ADD COLUMN `voting_closes_at` TIMESTAMP NULL");
    console.log("✓ ADD COLUMN voting_closes_at (TIMESTAMP)");
  } else if (votingClosesCol.DATA_TYPE === "datetime") {
    await c.query("ALTER TABLE `community_student_proposals` MODIFY COLUMN `voting_closes_at` TIMESTAMP NULL");
    console.log("✓ ALTER voting_closes_at DATETIME -> TIMESTAMP (corrige aplicación previa buggeada)");
  } else {
    console.log(`skip voting_closes_at (ya es ${votingClosesCol.DATA_TYPE})`);
  }

  const [tracked] = await c.query("SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1", [TAG]);
  if (tracked.length === 0) {
    await c.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`✓ INSERT ${TAG} en __drizzle_migrations`);
  } else {
    console.log(`skip INSERT ${TAG} (ya registrado)`);
  }

  const [verify] = await c.query(
    "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_student_proposals' AND COLUMN_NAME IN ('suggested_date','voting_closes_at')"
  );
  console.log("\nColumnas verificadas:", JSON.stringify(verify));

  await c.end();
  console.log("\n✓ Migración 0177 completa.");
})().catch(err => { console.error("✗ FALLÓ:", err); process.exit(1); });
