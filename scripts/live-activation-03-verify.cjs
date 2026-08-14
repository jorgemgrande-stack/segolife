// SEGOLIFE — SEGOTOKENS LIVE ACTIVATION — verificación final (spec §42, solo lectura).
// Run: railway ssh --service segolife -- node scripts/live-activation-03-verify.cjs
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

(async () => {
  const c = await mysql.createConnection(DB_URL);
  console.log("=".repeat(72));
  console.log("SEGOLIFE — SEGOTOKENS LIVE ACTIVATION — 03: verificación final (spec §42)");
  console.log("=".repeat(72));

  console.log("\n[CORTE GLOBAL]");
  const [[cutoff]] = await c.query(`SELECT value FROM system_settings WHERE \`key\` = 'loyalty_global_cutoff_at'`);
  console.log({ loyaltyGlobalCutoffAt: cutoff?.value ?? null });

  console.log("\n[VENUES]");
  const [vi] = await c.query(`
    SELECT vi.venue_id, v.name AS venue_name, vi.loyalty_enabled, vi.sync_enabled, vi.status
    FROM venue_integrations vi JOIN venues v ON v.id = vi.venue_id ORDER BY vi.id
  `);
  console.table(vi);
  const allEnabled = vi.every(v => v.loyalty_enabled === 1);
  console.log(`Todos los venues loyalty_enabled=1: ${allEnabled}`);

  console.log("\n[SHADOW]");
  const [[shadow]] = await c.query(`SELECT enabled FROM feature_flags WHERE \`key\` = 'loyalty_shadow_enabled'`);
  console.log({ shadowEnabled: !!shadow?.enabled });

  console.log("\n[TOKEN LEDGER — filas con rule_id (candidatas a reward LIVE real)]");
  const [ruleRows] = await c.query(`
    SELECT tl.id, tl.user_id, tl.amount, tl.created_at, tr.name AS rule_name, tr.origin
    FROM token_ledger tl JOIN token_rules tr ON tr.id = tl.rule_id
    ORDER BY tl.id
  `);
  console.table(ruleRows);

  console.log("\n[HISTÓRICO — 0 esperado: filas con rule_id creadas ANTES del corte global]");
  if (cutoff?.value) {
    const [[preCutoff]] = await c.query(
      `SELECT COUNT(*) AS n FROM token_ledger WHERE rule_id IS NOT NULL AND created_at < ?`,
      [cutoff.value]
    );
    console.log({ ledgerRowsWithRuleBeforeCutoff: preCutoff.n });
  }

  console.log("\n[DUPLICADOS — 0 esperado: mismo idempotency_key repetido]");
  const [dupes] = await c.query(`
    SELECT idempotency_key, COUNT(*) AS n FROM token_ledger
    WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING COUNT(*) > 1
  `);
  console.table(dupes);
  console.log(`Duplicados encontrados: ${dupes.length}`);

  console.log("\n[HUÉRFANOS — ledger sin wallet correspondiente]");
  const [[orphans]] = await c.query(`
    SELECT COUNT(*) AS n FROM token_ledger tl
    LEFT JOIN token_wallets tw ON tw.user_id = tl.user_id
    WHERE tw.id IS NULL
  `);
  console.log({ ledgerRowsWithoutWallet: orphans.n });

  console.log("\n[RECONCILIACIÓN — balance de wallet vs suma real de ledger, por usuario con actividad]");
  const [recon] = await c.query(`
    SELECT tw.user_id, tw.balance AS wallet_balance,
           COALESCE(SUM(CASE WHEN tl.direction='credit' THEN tl.amount ELSE -tl.amount END), 0) AS ledger_sum
    FROM token_wallets tw LEFT JOIN token_ledger tl ON tl.user_id = tw.user_id
    GROUP BY tw.user_id, tw.balance
    HAVING wallet_balance <> ledger_sum
  `);
  console.table(recon);
  console.log(`Wallets desincronizadas: ${recon.length} (0 esperado)`);

  console.log("\n[VOLUMEN DE TRÁFICO REAL DESDE LA ACTIVACIÓN]");
  const [[ordersSince]] = await c.query(`SELECT COUNT(*) AS n FROM ticket_orders WHERE purchased_at >= ?`, [cutoff?.value ?? "2100-01-01"]);
  const [[attendanceSince]] = await c.query(`SELECT COUNT(*) AS n FROM event_attendance WHERE occurred_at >= ?`, [cutoff?.value ?? "2100-01-01"]);
  console.log({ ordersSinceCutoff: ordersSince.n, attendanceSinceCutoff: attendanceSince.n });

  await c.end();
  console.log("\n" + "=".repeat(72));
  console.log("FIN VERIFICACIÓN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
