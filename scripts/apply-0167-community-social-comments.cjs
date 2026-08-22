// COM-02 — Community Social Results: crea `community_proposal_likes` +
// `community_proposal_comments`. Sin nuevos permisos RBAC — reutiliza
// community.view/community.moderate ya existentes (admin) y protectedProcedure
// (cualquier Student autenticado) para el resto.
//
// Aditiva, idempotente (SHOW TABLES antes de cada CREATE).
// Run: railway ssh (contenedor /app) node scripts/apply-0167-community-social-comments.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0167_community_social_comments";

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0167 — COM-02: community_proposal_likes + community_proposal_comments");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  // ── community_proposal_likes ──────────────────────────────────────────────
  const [likesTables] = await c.query("SHOW TABLES LIKE 'community_proposal_likes'");
  if (likesTables.length > 0) {
    console.log("skip CREATE TABLE community_proposal_likes (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`community_proposal_likes\` (
        \`id\`           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`proposal_id\`  INT NOT NULL,
        \`user_id\`      INT NOT NULL,
        \`created_at\`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`community_proposal_likes_unique\` (\`proposal_id\`, \`user_id\`),
        INDEX \`community_proposal_likes_user_id_idx\` (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE community_proposal_likes");
  }

  // ── community_proposal_comments ───────────────────────────────────────────
  const [commentsTables] = await c.query("SHOW TABLES LIKE 'community_proposal_comments'");
  if (commentsTables.length > 0) {
    console.log("skip CREATE TABLE community_proposal_comments (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`community_proposal_comments\` (
        \`id\`                 INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`proposal_id\`        INT NOT NULL,
        \`user_id\`            INT NOT NULL,
        \`parent_comment_id\`  INT NULL,
        \`content\`            VARCHAR(1000) NOT NULL,
        \`is_hidden\`          BOOLEAN NOT NULL DEFAULT FALSE,
        \`hidden_by_user_id\`  INT NULL,
        \`hidden_at\`          TIMESTAMP NULL,
        \`created_at\`         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\`         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX \`community_proposal_comments_proposal_id_idx\` (\`proposal_id\`),
        INDEX \`community_proposal_comments_parent_id_idx\` (\`parent_comment_id\`),
        INDEX \`community_proposal_comments_user_id_idx\` (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE community_proposal_comments");
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
  const [finalTables] = await c.query("SHOW TABLES LIKE 'community_proposal_l%'");
  const [finalTables2] = await c.query("SHOW TABLES LIKE 'community_proposal_c%'");
  console.log("\n[DESPUÉS] tablas:", JSON.stringify([...finalTables, ...finalTables2].map(r => Object.values(r)[0])));

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0167 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
