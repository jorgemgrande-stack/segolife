// SEGOLIFE — Social Layer para Events (2026-08-23): crea `event_likes` +
// `event_comments`. Mismo patrón EXACTO que community_proposal_likes/
// community_proposal_comments (migración 0167) — tablas nuevas y separadas
// de Community, ancladas a events.id interno (nunca a un external_event_id
// de Weezevent/Fourvenues). Sin nuevos permisos RBAC — protectedProcedure
// igual que Community.
//
// Aditiva, idempotente (SHOW TABLES antes de cada CREATE).
// Run: railway ssh -- node scripts/apply-0175-event-likes-comments.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0175_event_likes_comments";

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0175 — Social Layer Events: event_likes + event_comments");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  // ── event_likes ───────────────────────────────────────────────────────────
  const [likesTables] = await c.query("SHOW TABLES LIKE 'event_likes'");
  if (likesTables.length > 0) {
    console.log("skip CREATE TABLE event_likes (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`event_likes\` (
        \`id\`           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`event_id\`     INT NOT NULL,
        \`user_id\`      INT NOT NULL,
        \`created_at\`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`event_likes_unique\` (\`event_id\`, \`user_id\`),
        INDEX \`event_likes_user_id_idx\` (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE event_likes");
  }

  // ── event_comments ────────────────────────────────────────────────────────
  const [commentsTables] = await c.query("SHOW TABLES LIKE 'event_comments'");
  if (commentsTables.length > 0) {
    console.log("skip CREATE TABLE event_comments (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`event_comments\` (
        \`id\`                 INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`event_id\`           INT NOT NULL,
        \`user_id\`            INT NOT NULL,
        \`parent_comment_id\`  INT NULL,
        \`content\`            VARCHAR(1000) NOT NULL,
        \`is_hidden\`          BOOLEAN NOT NULL DEFAULT FALSE,
        \`hidden_by_user_id\`  INT NULL,
        \`hidden_at\`          TIMESTAMP NULL,
        \`created_at\`         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\`         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX \`event_comments_event_id_idx\` (\`event_id\`),
        INDEX \`event_comments_parent_id_idx\` (\`parent_comment_id\`),
        INDEX \`event_comments_user_id_idx\` (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE event_comments");
  }

  // ── Tracking __drizzle_migrations ─────────────────────────────────────────
  console.log("\n[TRACKING] __drizzle_migrations");
  const [tracked] = await c.query("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?", [TAG]);
  if (tracked[0].n > 0) {
    console.log(`  skip ${TAG} (ya registrada)`);
  } else {
    await c.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  // ── Post-verificación ─────────────────────────────────────────────────────
  const [finalTables] = await c.query("SHOW TABLES LIKE 'event_%'");
  console.log("\n[DESPUÉS] tablas event_*:", JSON.stringify(finalTables.map(r => Object.values(r)[0])));

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0175 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
