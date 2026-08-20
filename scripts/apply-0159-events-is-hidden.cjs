// Aplica 0159_events_is_hidden (SEGOLIFE FIX-06 — Admin Events Operational
// Controls). Idempotente. Puramente aditiva: 1 columna NOT NULL DEFAULT
// false en events — todo evento existente queda "no oculto" (comportamiento
// idéntico al actual, ningún evento desaparece de discovery por esta
// migración). Ejecutar vía `railway ssh` dentro de /app (mysql-*.railway.
// internal no resuelve desde fuera de la red privada de Railway) — mismo
// criterio que apply-0157-event-source-publication-status.cjs.
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function columnExists(c, table, column) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
  return r[0].n > 0;
}

(async () => {
  console.log("FIX-06 — Admin Events Operational Controls — is_hidden (0159)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await columnExists(c, "events", "is_hidden")) {
    console.log("· skip events.is_hidden (ya existe)");
  } else {
    await c.query("ALTER TABLE `events` ADD COLUMN `is_hidden` boolean NOT NULL DEFAULT false AFTER `source_publication_status`");
    console.log("✓ ALTER TABLE events ADD COLUMN is_hidden");
  }

  const tag = "0159_events_is_hidden";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [[total]] = await c.query(`SELECT COUNT(*) AS n FROM events`);
  const [[hidden]] = await c.query(`SELECT COUNT(*) AS n FROM events WHERE is_hidden = true`);
  console.log(`\n[POST] events totales: ${total.n} · ocultos: ${hidden.n} (debe ser 0 hasta que un admin oculte alguno de verdad)`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
