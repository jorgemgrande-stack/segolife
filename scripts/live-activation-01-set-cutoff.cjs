// SEGOLIFE — SEGOTOKENS LIVE ACTIVATION — establece LIVE_ACTIVATED_AT (spec §3).
// IDEMPOTENTE: si system_settings.loyalty_global_cutoff_at ya tiene un valor, NO lo
// toca (nunca mueve un corte ya establecido) — solo lo informa y termina sin cambios.
// Run: railway ssh --service segolife -- node scripts/live-activation-01-set-cutoff.cjs
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

(async () => {
  const c = await mysql.createConnection(DB_URL);
  console.log("=".repeat(72));
  console.log("SEGOLIFE — SEGOTOKENS LIVE ACTIVATION — 01: establecer corte global");
  console.log("=".repeat(72));

  const [[existing]] = await c.query(`SELECT value FROM system_settings WHERE \`key\` = 'loyalty_global_cutoff_at'`);
  if (existing === undefined) {
    console.error("ABORTADO: la fila system_settings.loyalty_global_cutoff_at no existe (esperada desde Loyalty Production Hardening) — no se crea aquí, revisar drift de schema.");
    process.exit(1);
  }
  if (existing.value && existing.value.trim()) {
    console.log(`YA ESTABLECIDO — no se toca (idempotente): ${existing.value}`);
    await c.end();
    return;
  }

  const cutoffIso = new Date().toISOString();
  const [result] = await c.execute(
    `UPDATE system_settings SET value = ? WHERE \`key\` = 'loyalty_global_cutoff_at' AND (value IS NULL OR value = '')`,
    [cutoffIso]
  );
  if (result.affectedRows !== 1) {
    console.error(`ABORTADO: UPDATE afectó ${result.affectedRows} filas (esperado 1) — posible carrera con otro proceso, revisar antes de reintentar.`);
    process.exit(1);
  }
  console.log(`✓ LIVE_ACTIVATED_AT establecido: ${cutoffIso}`);

  const [[verify]] = await c.query(`SELECT value FROM system_settings WHERE \`key\` = 'loyalty_global_cutoff_at'`);
  console.log("Verificación post-write:", verify.value);

  await c.end();
  console.log("=".repeat(72));
  console.log("FIN — corte establecido. Ningún venue tiene loyalty_enabled=1 todavía (siguiente paso).");
})().catch(e => { console.error("ERR", e); process.exit(1); });
