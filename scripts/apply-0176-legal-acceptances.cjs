// SEGOLIFE — FASE LEGAL (2026-08-23): crea `legal_acceptances` — trazabilidad
// de qué documento legal (terms/privacy) y qué versión aceptó cada usuario
// al registrarse, y cuándo. Nunca un booleano plano: el objetivo es poder
// demostrar exactamente qué texto aceptó un usuario si hace falta.
//
// Aditiva, idempotente (SHOW TABLES antes del CREATE).
// Run: railway ssh -- node scripts/apply-0176-legal-acceptances.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0176_legal_acceptances";

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0176 — Legal & Consent Layer: legal_acceptances");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  const [existing] = await c.query("SHOW TABLES LIKE 'legal_acceptances'");
  if (existing.length > 0) {
    console.log("skip CREATE TABLE legal_acceptances (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`legal_acceptances\` (
        \`id\`                INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`user_id\`           INT NOT NULL,
        \`document_type\`     VARCHAR(64) NOT NULL,
        \`document_version\`  VARCHAR(64) NOT NULL,
        \`accepted_at\`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX \`legal_acceptances_user_id_idx\` (\`user_id\`),
        INDEX \`legal_acceptances_user_doc_idx\` (\`user_id\`, \`document_type\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE legal_acceptances");
  }

  const [tracked] = await c.query("SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1", [TAG]);
  if (tracked.length === 0) {
    await c.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`✓ INSERT ${TAG} en __drizzle_migrations`);
  } else {
    console.log(`skip INSERT ${TAG} (ya registrado)`);
  }

  const [verify] = await c.query("SHOW TABLES LIKE 'legal_%'");
  console.log("\nTablas legal_* presentes:", verify.map(r => Object.values(r)[0]).join(", "));

  await c.end();
  console.log("\n✓ Migración 0176 completa.");
})().catch(err => { console.error("✗ FALLÓ:", err); process.exit(1); });
