// SEGOLIFE — LOYALTY SHADOW MODE — pre-flight audit (solo lectura).
// Run: railway ssh --service segolife -- node scripts/shadow-preflight-audit.cjs
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function tableExists(c, name) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [name]);
  return r[0].n > 0;
}

(async () => {
  const c = await mysql.createConnection(DB_URL);
  console.log("=".repeat(72));
  console.log("SEGOLIFE — LOYALTY SHADOW MODE — pre-flight audit");
  console.log("=".repeat(72));

  console.log("\n[VENUE INTEGRATIONS]");
  const [vi] = await c.query(`SELECT venue_id, provider_id, environment, enabled, status, sync_enabled, loyalty_enabled, loyalty_cutoff_override_at, last_success_at FROM venue_integrations`);
  console.table(vi);

  console.log("\n[INTEGRATION PROVIDERS]");
  if (await tableExists(c, "integration_providers")) {
    const [providers] = await c.query(`SELECT * FROM integration_providers`);
    console.table(providers);
  }

  console.log("\n[FEATURE FLAGS — todas]");
  if (await tableExists(c, "feature_flags")) {
    const [flags] = await c.query(`SELECT \`key\`, enabled, module FROM feature_flags ORDER BY module, \`key\``);
    console.table(flags);
  } else {
    console.log("  tabla feature_flags no existe con ese nombre");
  }

  console.log("\n[SYSTEM SETTINGS — loyalty*]");
  if (await tableExists(c, "system_settings")) {
    const [settings] = await c.query(`SELECT \`key\`, value, value_type FROM system_settings WHERE \`key\` LIKE '%loyalty%' OR \`key\` LIKE '%live%' OR \`key\` LIKE '%shadow%'`);
    console.table(settings);
  }

  console.log("\n[TOKEN LEDGER]");
  const [[tl]] = await c.query(`SELECT COUNT(*) AS n, MAX(id) AS maxId FROM token_ledger`);
  console.log(tl);

  console.log("\n[TOKEN WALLETS]");
  const [wallets] = await c.query(`SELECT user_id, balance, lifetime_earned, lifetime_spent FROM token_wallets`);
  console.table(wallets);

  console.log("\n[USER BENEFITS]");
  const [[ub]] = await c.query(`SELECT COUNT(*) AS n, MAX(id) AS maxId FROM user_benefits`);
  console.log(ub);

  console.log("\n[HISTORICAL CLAIMS]");
  const [[claims]] = await c.query(`SELECT COUNT(*) AS n FROM student_admin_actions WHERE action IN ('historical_identity_claimed')`);
  console.log(claims);
  const [[linked]] = await c.query(`SELECT COUNT(*) AS n FROM unresolved_operations WHERE status='linked'`);
  console.log({ unresolvedOperationsLinked: linked.n });

  console.log("\n[TOKEN RULES]");
  const [rules] = await c.query(`SELECT id, name, direction, origin, scope, active, priority, starts_at, ends_at FROM token_rules ORDER BY priority DESC LIMIT 50`);
  console.table(rules);

  console.log("\n[TOKEN CAMPAIGNS]");
  const [campaigns] = await c.query(`SELECT id, name, multiplier, bonus_tokens, max_total_tokens, starts_at, ends_at FROM token_campaigns LIMIT 50`);
  console.table(campaigns);

  console.log("\n[TABLAS POSIBLES DE SHADOW YA EXISTENTES]");
  for (const t of ["loyalty_shadow_evaluations", "shadow_evaluations", "reward_simulations", "loyalty_simulations"]) {
    console.log(`  ${t}: ${await tableExists(c, t) ? "EXISTE" : "no existe"}`);
  }

  console.log("\n[UNRESOLVED OPERATIONS por venue/status]");
  const [uo] = await c.query(`SELECT venue_id, status, COUNT(*) AS n FROM unresolved_operations GROUP BY venue_id, status ORDER BY venue_id, status`);
  console.table(uo);

  console.log("\n[VOLUMEN RECIENTE — últimas 72h, tickets/orders/attendance]");
  const [[recentOrders]] = await c.query(`SELECT COUNT(*) AS n FROM ticket_orders WHERE purchased_at >= (NOW() - INTERVAL 72 HOUR)`);
  console.log({ recentOrders72h: recentOrders.n });
  const [[recentAttendance]] = await c.query(`SELECT COUNT(*) AS n FROM event_attendance WHERE occurred_at >= (NOW() - INTERVAL 72 HOUR)`);
  console.log({ recentAttendance72h: recentAttendance.n });
  const [[recentUnresolved]] = await c.query(`SELECT COUNT(*) AS n FROM unresolved_operations WHERE occurred_at >= (NOW() - INTERVAL 72 HOUR)`);
  console.log({ recentUnresolved72h: recentUnresolved.n });
  const [[recentTickets]] = await c.query(`SELECT COUNT(*) AS n FROM event_tickets WHERE created_at >= (NOW() - INTERVAL 72 HOUR)`);
  console.log({ recentTicketsCreated72h: recentTickets.n });

  await c.end();
  console.log("\n" + "=".repeat(72));
  console.log("FIN AUDIT");
})().catch(e => { console.error("ERR", e); process.exit(1); });
