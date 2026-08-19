// Aplica 0157_event_source_publication_status (SEGOLIFE FIX-04 — Fourvenues
// Event Lifecycle & Publication Status). Idempotente. Puramente aditiva: 1
// columna nullable en events. Ningún dato existente se reescribe con un
// valor inventado — todo evento existente (nativo o Fourvenues) queda en
// NULL ("unknown") hasta el próximo sync real, que es quien puede confirmar
// el estado real del proveedor (ver eventCatalogSync.ts). Ninguna tabla
// existente cambia de estructura, ningún dato se pierde.
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function columnExists(c, table, column) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
  return r[0].n > 0;
}

(async () => {
  console.log("FOURVENUES EVENT LIFECYCLE — source_publication_status (0157)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await columnExists(c, "events", "source_publication_status")) {
    console.log("· skip events.source_publication_status (ya existe)");
  } else {
    await c.query("ALTER TABLE `events` ADD COLUMN `source_publication_status` ENUM('published','unpublished','unknown') AFTER `source_id`");
    console.log("✓ ALTER TABLE events ADD COLUMN source_publication_status");
  }

  const tag = "0157_event_source_publication_status";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [[total]] = await c.query(`SELECT COUNT(*) AS n FROM events`);
  const [[withStatus]] = await c.query(`SELECT COUNT(*) AS n FROM events WHERE source_publication_status IS NOT NULL`);
  console.log(`\n[POST] events totales: ${total.n} · con source_publication_status ya confirmado: ${withStatus.n} (debe ser 0 hasta el próximo sync real de Fourvenues — nunca se hace backfill inventado aquí)`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
