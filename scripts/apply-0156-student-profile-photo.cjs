// Aplica 0156_student_profile_photo (SEGOLIFE MG-03 — Student Profile
// Photo & Visual Identity). Idempotente. Puramente aditiva: 1 columna
// nullable en users. Ninguna tabla existente cambia de estructura, ningún
// dato se pierde. Students existentes sin foto siguen funcionando (columna
// NULL = avatar de iniciales, sin cambios).
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function columnExists(c, table, column) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
  return r[0].n > 0;
}

(async () => {
  console.log("STUDENT PROFILE PHOTO (0156)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await columnExists(c, "users", "avatarStorageKey")) {
    console.log("· skip users.avatarStorageKey (ya existe)");
  } else {
    await c.query("ALTER TABLE `users` ADD COLUMN `avatarStorageKey` text AFTER `avatarUrl`");
    console.log("✓ ALTER TABLE users ADD COLUMN avatarStorageKey");
  }

  const tag = "0156_student_profile_photo";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [[count]] = await c.query(`SELECT COUNT(*) AS n FROM users WHERE avatarStorageKey IS NOT NULL`);
  console.log(`\n[POST] users con avatarStorageKey: ${count.n} (debe ser 0 tras un deploy limpio, antes de que ningún Student suba una foto)`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
