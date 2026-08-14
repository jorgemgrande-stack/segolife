// Índices para SEGOLIFE — HISTORICAL STUDENT CLAIM (spec §26-27) — puramente
// aditivo, sin tocar datos ni semántica. Justificación real:
//
// - unresolved_operations no tenía NINGÚN índice sobre identity_hint_email
//   ni identity_hint_phone (confirmado por auditoría de esta fase) — el
//   nuevo lookup acotado por contacto (findHistoricalGroupForContact, usado
//   en el hook de registro y en el autoservicio del estudiante) necesita
//   estas dos columnas indexadas para ser O(log n) en vez de full scan sobre
//   decenas de miles de filas en cada alta/visita al perfil.
// - unresolved_operations tampoco tenía índice sobre linked_user_id — nuevo
//   punto de acceso caliente: Student 360 (getHistoricalOverviewForStudent/
//   getHistoricalTimelineForStudent) filtra por esta columna.
// - users.phone no tenía NINGÚN índice — classifyMatch() ya lo consulta hoy
//   (SELECT ... WHERE phone = ?) sin índice; preventivo, mismo patrón que el
//   resto de índices "Tier 2" del Command Center.
//
// Idempotente. Run: railway ssh --service segolife -- node scripts/apply-historical-claim-indexes.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "1000_historical_claim_indexes";

async function idxExists(c, t, idx) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, [t, idx]);
  return r[0].n > 0;
}
async function createIdx(c, t, name, cols) {
  if (await idxExists(c, t, name)) { console.log(`  · skip ${t}.${name} (ya existe)`); return; }
  await c.query(`CREATE INDEX \`${name}\` ON \`${t}\` ${cols}`);
  console.log(`  ✓ CREATE INDEX ${t}.${name}`);
}

const INDEXES = [
  ["unresolved_operations", "idx_unresolved_operations_provider_email", "(`provider`, `identity_hint_email`)"],
  ["unresolved_operations", "idx_unresolved_operations_provider_phone", "(`provider`, `identity_hint_phone`)"],
  ["unresolved_operations", "idx_unresolved_operations_linked_user_id", "(`linked_user_id`)"],
  ["users", "idx_users_phone", "(`phone`)"],
];

(async () => {
  console.log("=".repeat(72));
  console.log("SEGOLIFE HISTORICAL STUDENT CLAIM — migración de índices (aditiva, solo performance)");
  console.log("=".repeat(72));

  const c = await mysql.createConnection({ uri: DB_URL });

  for (const [table, name, cols] of INDEXES) {
    try {
      await createIdx(c, table, name, cols);
    } catch (err) {
      console.error(`  ✗ ERROR en ${table}.${name}: ${err.message}`);
      console.error("  DETENIÉNDOME para esta instrucción — no se elimina ni se fuerza nada.");
      await c.end();
      process.exit(1);
    }
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [TAG]);
  if (exists.n > 0) { console.log(`  · skip ${TAG} (ya registrada)`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  console.log("\n[VERIFICACIÓN] Índices creados por tabla:");
  const tables = [...new Set(INDEXES.map(i => i[0]))];
  for (const t of tables) {
    const [rows] = await c.query(`SHOW INDEX FROM \`${t}\``);
    const names = [...new Set(rows.map(r => r.Key_name))];
    console.log(`  ${t}: ${names.join(", ")}`);
  }

  await c.end();
  console.log("=".repeat(72));
  console.log("FIN — migración de índices aplicada");
  console.log("=".repeat(72));
})().catch(e => { console.error("ERR", e); process.exit(1); });
