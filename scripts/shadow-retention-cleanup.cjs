// SEGOLIFE — LOYALTY SHADOW MODE — retención (spec §13).
// Mecanismo PREPARADO, NO automático — nadie lo ejecuta salvo un humano que
// decida explícitamente aplicar la política de retención configurada en
// system_settings.loyalty_shadow_retention_days (default 90). Esta fase NO
// programa ningún cron para este script.
//
// Por defecto es un DRY RUN (solo cuenta cuántas filas se borrarían). Pasa
// --execute para borrar de verdad.
//
// Run: railway ssh --service segolife -- node scripts/shadow-retention-cleanup.cjs [--execute]

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const EXECUTE = process.argv.includes("--execute");

(async () => {
  const c = await mysql.createConnection({ uri: DB_URL });
  const [[setting]] = await c.query(`SELECT value FROM system_settings WHERE \`key\` = 'loyalty_shadow_retention_days'`);
  const days = Number(setting?.value ?? 90);
  console.log(`Retención configurada: ${days} días`);

  const [[count]] = await c.query(
    `SELECT COUNT(*) AS n FROM loyalty_shadow_evaluations WHERE evaluated_at < (NOW() - INTERVAL ? DAY)`,
    [days]
  );
  console.log(`Filas que superan la retención: ${count.n}`);

  if (!EXECUTE) {
    console.log("DRY RUN (por defecto) — ninguna fila borrada. Pasa --execute para borrar de verdad.");
  } else {
    const [result] = await c.execute(
      `DELETE FROM loyalty_shadow_evaluations WHERE evaluated_at < (NOW() - INTERVAL ? DAY)`,
      [days]
    );
    console.log(`✓ Borradas ${result.affectedRows} filas.`);
  }

  await c.end();
})().catch(e => { console.error("ERR", e); process.exit(1); });
