// Bottom sheets + Share — crea `community_proposal_shares`. Sin nuevos
// permisos RBAC — protectedProcedure (cualquier Student autenticado) igual
// que likes/comments.
//
// Aditiva, idempotente (SHOW TABLES antes de cada CREATE).
// Run: railway ssh (contenedor /app) node scripts/apply-0168-community-proposal-shares.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0168_community_proposal_shares";

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0168 — Bottom sheets + Share: community_proposal_shares");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  const [sharesTables] = await c.query("SHOW TABLES LIKE 'community_proposal_shares'");
  if (sharesTables.length > 0) {
    console.log("skip CREATE TABLE community_proposal_shares (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`community_proposal_shares\` (
        \`id\`           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`proposal_id\`  INT NOT NULL,
        \`user_id\`      INT NOT NULL,
        \`method\`       ENUM('native','copy_link','whatsapp','telegram','email') NOT NULL,
        \`created_at\`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX \`community_proposal_shares_proposal_id_idx\` (\`proposal_id\`),
        INDEX \`community_proposal_shares_user_id_idx\` (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE community_proposal_shares");
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [tracked] = await c.query("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?", [TAG]);
  if (tracked[0].n > 0) {
    console.log(`  skip ${TAG} (ya registrada)`);
  } else {
    await c.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  const [finalTables] = await c.query("SHOW TABLES LIKE 'community_proposal_shares'");
  console.log("\n[DESPUÉS] tablas:", JSON.stringify(finalTables.map(r => Object.values(r)[0])));

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0168 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
