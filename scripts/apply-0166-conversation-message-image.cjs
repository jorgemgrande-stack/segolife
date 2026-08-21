// Aplica 0166_conversation_message_image (COM-01 — imagen adjunta en el
// chat Admin→Student). Idempotente. Puramente aditiva: 1 columna nullable
// en conversation_messages. Ninguna tabla existente cambia de estructura,
// ningún dato se pierde. Mensajes existentes siguen funcionando (columna
// NULL = mensaje sin imagen, sin cambios de comportamiento).
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function columnExists(c, table, column) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
  return r[0].n > 0;
}

(async () => {
  console.log("CONVERSATION MESSAGE IMAGE (0166)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await columnExists(c, "conversation_messages", "image_storage_key")) {
    console.log("· skip conversation_messages.image_storage_key (ya existe)");
  } else {
    await c.query("ALTER TABLE `conversation_messages` ADD COLUMN `image_storage_key` varchar(512) NULL AFTER `body`");
    console.log("✓ ALTER TABLE conversation_messages ADD COLUMN image_storage_key");
  }

  const tag = "0166_conversation_message_image";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [[count]] = await c.query(`SELECT COUNT(*) AS n FROM conversation_messages WHERE image_storage_key IS NOT NULL`);
  console.log(`\n[POST] mensajes con image_storage_key: ${count.n} (debe ser 0 tras un deploy limpio, antes de que ningún Admin adjunte una imagen)`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
