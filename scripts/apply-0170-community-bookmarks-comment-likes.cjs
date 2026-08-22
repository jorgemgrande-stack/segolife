// F68 (Community Engagement avanzado) — crea community_proposal_bookmarks
// (guardar propuesta para más tarde) y community_comment_likes (reacción
// sobre un comentario concreto, distinta del like de la propuesta). Sin
// nuevos permisos RBAC — protectedProcedure igual que likes/comments/shares.
//
// Aditiva, idempotente (SHOW TABLES antes de cada CREATE).
// Run: railway ssh -- node scripts/apply-0170-community-bookmarks-comment-likes.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0170_community_bookmarks_comment_likes";

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0170 — F68: community_proposal_bookmarks + community_comment_likes");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  const [bookmarksTables] = await c.query("SHOW TABLES LIKE 'community_proposal_bookmarks'");
  if (bookmarksTables.length > 0) {
    console.log("skip CREATE TABLE community_proposal_bookmarks (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`community_proposal_bookmarks\` (
        \`id\`           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`proposal_id\`  INT NOT NULL,
        \`user_id\`      INT NOT NULL,
        \`created_at\`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`community_proposal_bookmarks_unique\` (\`proposal_id\`, \`user_id\`),
        INDEX \`community_proposal_bookmarks_user_id_idx\` (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE community_proposal_bookmarks");
  }

  const [commentLikesTables] = await c.query("SHOW TABLES LIKE 'community_comment_likes'");
  if (commentLikesTables.length > 0) {
    console.log("skip CREATE TABLE community_comment_likes (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`community_comment_likes\` (
        \`id\`           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`comment_id\`   INT NOT NULL,
        \`user_id\`      INT NOT NULL,
        \`created_at\`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`community_comment_likes_unique\` (\`comment_id\`, \`user_id\`),
        INDEX \`community_comment_likes_user_id_idx\` (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE community_comment_likes");
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [tracked] = await c.query("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?", [TAG]);
  if (tracked[0].n > 0) {
    console.log(`  skip ${TAG} (ya registrada)`);
  } else {
    await c.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  const [finalTables] = await c.query("SHOW TABLES LIKE 'community_%'");
  console.log("\n[DESPUÉS] tablas community_*:", JSON.stringify(finalTables.map(r => Object.values(r)[0])));

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0170 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
