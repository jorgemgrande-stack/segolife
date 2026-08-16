// Aplica 0154_venue_products_image_url. Idempotente. Puramente aditiva: 1
// columna nullable en venue_products (imagen del producto, Fase 12.5).
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function columnExists(c, table, column) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
  return r[0].n > 0;
}

(async () => {
  console.log("VENUE PRODUCTS IMAGE URL (0154)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await columnExists(c, "venue_products", "image_url")) {
    console.log("· skip venue_products.image_url (ya existe)");
  } else {
    await c.query("ALTER TABLE `venue_products` ADD COLUMN `image_url` varchar(512) AFTER `is_active`");
    console.log("✓ ALTER TABLE venue_products ADD COLUMN image_url");
  }

  const tag = "0154_venue_products_image_url";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
