// SEGOLIFE — SEGOTOKENS LIVE ACTIVATION — pre-flight de re-verificación (solo lectura).
// Confirma que el estado de producción no ha cambiado desde la auditoría inicial de esta
// fase antes de tocar nada. Run: railway ssh --service segolife -- node scripts/live-activation-00-preflight.cjs
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

(async () => {
  const c = await mysql.createConnection(DB_URL);
  console.log("=".repeat(72));
  console.log("SEGOLIFE — SEGOTOKENS LIVE ACTIVATION — pre-flight re-verificación");
  console.log("=".repeat(72));

  console.log("\n[VENUE INTEGRATIONS — venue_id/nombre real, NUNCA fiarse de memoria]");
  const [vi] = await c.query(`
    SELECT vi.id AS integration_id, vi.venue_id, v.name AS venue_name, vi.enabled, vi.status,
           vi.sync_enabled, vi.loyalty_enabled, vi.loyalty_cutoff_override_at
    FROM venue_integrations vi JOIN venues v ON v.id = vi.venue_id
    ORDER BY vi.id
  `);
  console.table(vi);

  console.log("\n[CORTE GLOBAL DE LOYALTY]");
  const [cutoff] = await c.query(`SELECT \`key\`, value FROM system_settings WHERE \`key\` = 'loyalty_global_cutoff_at'`);
  console.log(cutoff.length ? cutoff[0] : "NO CONFIGURADO (NULL) — esperado antes de activar");

  console.log("\n[TOKEN RULES ACTIVAS]");
  const [rules] = await c.query(`
    SELECT id, name, direction, origin, scope, active, calc_method, fixed_amount, rate,
           daily_limit, weekly_limit, monthly_limit, lifetime_limit, recurrence_threshold, recurrence_mode
    FROM token_rules WHERE active = 1 ORDER BY id
  `);
  console.table(rules);
  console.log(`Total reglas activas: ${rules.length} (esperado: 7, según SegoTokens Economy)`);

  console.log("\n[TOKEN CAMPAIGNS ACTIVAS]");
  const [campaigns] = await c.query(`SELECT id, name, active, max_total_tokens, starts_at, ends_at FROM token_campaigns WHERE active = 1`);
  console.table(campaigns);

  console.log("\n[SHADOW MODE — feature_flags, no system_settings]");
  const [shadowFlag] = await c.query(`SELECT \`key\`, enabled, module FROM feature_flags WHERE \`key\` = 'loyalty_shadow_enabled'`);
  console.log(shadowFlag.length ? shadowFlag[0] : "flag no encontrado");
  const [[shadowCount]] = await c.query(`SELECT COUNT(*) AS n FROM loyalty_shadow_evaluations`);
  const [[shadowErrCount]] = await c.query(`SELECT COUNT(*) AS n FROM loyalty_shadow_errors`);
  console.log({ shadowEvaluations: shadowCount.n, shadowErrors: shadowErrCount.n });

  console.log("\n[TOKEN LEDGER — estado actual, todas las filas]");
  const [ledgerRows] = await c.query(`SELECT id, user_id, direction, amount, reason, source_type, source_id, venue_id, rule_id, created_at FROM token_ledger ORDER BY id`);
  console.table(ledgerRows);
  console.log(`Total: ${ledgerRows.length} filas. Con rule_id NO NULL (candidatas a reward de regla real): ${ledgerRows.filter(r => r.rule_id != null).length}.`);

  console.log("\n[VOLUMEN RECIENTE — últimas 72h]");
  const [[recentOrders]] = await c.query(`SELECT COUNT(*) AS n FROM ticket_orders WHERE purchased_at >= (NOW() - INTERVAL 72 HOUR)`);
  const [[recentAttendance]] = await c.query(`SELECT COUNT(*) AS n FROM event_attendance WHERE occurred_at >= (NOW() - INTERVAL 72 HOUR)`);
  console.log({ recentOrders72h: recentOrders.n, recentAttendance72h: recentAttendance.n });

  console.log("\n[HORA ACTUAL DEL SERVIDOR DE BD — referencia para el corte que se va a fijar]");
  const [[now]] = await c.query(`SELECT NOW() AS dbNow, UTC_TIMESTAMP() AS dbNowUtc`);
  console.log(now);

  await c.end();
  console.log("\n" + "=".repeat(72));
  console.log("FIN PRE-FLIGHT");
})().catch(e => { console.error("ERR", e); process.exit(1); });
