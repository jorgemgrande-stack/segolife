// SEGOLIFE — COMMUNITY Production Implementation — conecta Community al
// Reward Engine real (earnTokens/LIVE_LOYALTY_ENABLED), sustituyendo el
// bypass legacy directo a postLedgerMovement() en communityResponseService.ts.
// Idempotente — se puede ejecutar varias veces sin efecto adicional.
//
// Run: railway ssh --service segolife -- node scripts/apply-community-segotokens-rules.cjs
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function getEnumValues(c, table, col) {
  const [r] = await c.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  if (!r[0]) return [];
  const m = r[0].COLUMN_TYPE.match(/^enum\((.+)\)$/i);
  if (!m) return [];
  return m[1].split(",").map(s => s.replace(/^'|'$/g, ""));
}

async function ensureEnumValues(c, table, col, newValues) {
  const current = await getEnumValues(c, table, col);
  console.log(`  [ANTES] ${table}.${col} enum: ${current.join(", ")}`);
  const missing = newValues.filter(v => !current.includes(v));
  if (missing.length === 0) { console.log(`  · skip ALTER (ya contiene ${newValues.join(", ")})`); return; }
  const next = [...current, ...missing];
  const literal = next.map(v => `'${v}'`).join(",");
  await c.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${col}\` enum(${literal}) NOT NULL`);
  console.log(`  ✓ ALTER ${table}.${col} — añadido: ${missing.join(", ")}`);
}

async function ensureRule(c, rule) {
  const [[existing]] = await c.query(`SELECT id FROM token_rules WHERE origin = ? AND scope = 'global'`, [rule.origin]);
  if (existing) { console.log(`  · skip INSERT ${rule.name} (ya existe token_rules.id=${existing.id})`); return; }
  await c.execute(
    `INSERT INTO token_rules (name, direction, origin, scope, calc_method, fixed_amount, daily_limit, active, priority)
     VALUES (?, 'earn', ?, 'global', 'fixed', ?, ?, 1, 0)`,
    [rule.name, rule.origin, rule.fixedAmount, rule.dailyLimit]
  );
  console.log(`  ✓ INSERT token_rules "${rule.name}" (origin=${rule.origin}, ${rule.fixedAmount} tokens${rule.dailyLimit ? `, cap ${rule.dailyLimit}/día` : ""})`);
}

(async () => {
  console.log("=".repeat(72));
  console.log("SEGOLIFE — COMMUNITY → SEGOTOKENS — reglas reales vía Reward Engine");
  console.log("=".repeat(72));

  const c = await mysql.createConnection(DB_URL);

  console.log("\n[1/2] token_rules.origin += 'community_response', 'community_proposal_approved'");
  await ensureEnumValues(c, "token_rules", "origin", ["community_response", "community_proposal_approved"]);

  console.log("\n[2/2] Reglas COMMUNITY_RESPONSE / COMMUNITY_PROPOSAL_APPROVED");
  await ensureRule(c, { name: "Participación en COMUNITY", origin: "community_response", fixedAmount: 2, dailyLimit: 10 });
  await ensureRule(c, { name: "Propuesta de estudiante aprobada en COMUNITY", origin: "community_proposal_approved", fixedAmount: 10, dailyLimit: null });

  console.log("\n[VERIFICACIÓN]");
  const [rules] = await c.query(`SELECT id, name, origin, fixed_amount, daily_limit, active FROM token_rules WHERE origin IN ('community_response','community_proposal_approved')`);
  console.table(rules);

  await c.end();
  console.log("=".repeat(72));
  console.log("FIN — Community conectado al Reward Engine real");
  console.log("=".repeat(72));
})().catch(e => { console.error("ERR", e); process.exit(1); });
