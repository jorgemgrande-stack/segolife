// SEGOLIFE — SEGOTOKENS ECONOMY & REWARD POLICY — configuración de datos
// (NO schema: token_rules/token_campaigns/system_settings ya tienen todas
// las columnas necesarias desde Loyalty Production Hardening). Puramente
// datos de política — reglas activas, pero LIVE_MODE_ENABLED sigue en
// `false` en código (rewardEngine.ts), así que activar estas reglas NUNCA
// concede un SegoToken real: solo hace que Shadow (ya ON) empiece a
// evaluarlas. Idempotente — no sobrescribe caps que un admin ya haya
// personalizado manualmente.
//
// Run: railway ssh --service segolife -- node scripts/apply-segotokens-economy-policy.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const DAILY = 100, WEEKLY = 250, MONTHLY = 750;

async function ruleExists(c, name) {
  const [r] = await c.query(`SELECT id, daily_limit, weekly_limit, monthly_limit FROM token_rules WHERE name = ?`, [name]);
  return r[0] ?? null;
}

async function insertRule(c, fields) {
  const cols = Object.keys(fields);
  const placeholders = cols.map(() => "?").join(", ");
  const colNames = cols.map(c => `\`${c}\``).join(", ");
  await c.execute(`INSERT INTO token_rules (${colNames}, created_at, updated_at) VALUES (${placeholders}, NOW(), NOW())`, cols.map(k => fields[k]));
  console.log(`  ✓ INSERT token_rules "${fields.name}"`);
}

(async () => {
  console.log("=".repeat(72));
  console.log("SEGOLIFE — SEGOTOKENS ECONOMY & REWARD POLICY — configuración de datos");
  console.log("=".repeat(72));

  const c = await mysql.createConnection(DB_URL);

  console.log("\n[1/6] Caps en 'Asistencia a evento' (attendance, 15 tokens, ya existente)");
  const attendance = await ruleExists(c, "Asistencia a evento");
  if (!attendance) {
    console.log("  ✗ ABORTADO: no se encontró la regla 'Asistencia a evento' — estado inesperado, revisar manualmente.");
  } else if (attendance.daily_limit != null || attendance.weekly_limit != null || attendance.monthly_limit != null) {
    console.log(`  · skip (ya tiene caps personalizados: daily=${attendance.daily_limit}, weekly=${attendance.weekly_limit}, monthly=${attendance.monthly_limit})`);
  } else {
    await c.execute(`UPDATE token_rules SET daily_limit=?, weekly_limit=?, monthly_limit=? WHERE id=?`, [DAILY, WEEKLY, MONTHLY, attendance.id]);
    console.log(`  ✓ UPDATE token_rules id=${attendance.id} caps=${DAILY}/${WEEKLY}/${MONTHLY}`);
  }

  console.log("\n[2/6] Regla nueva: 'Compra de entrada' (origin=ticket, 1 token/€ pagado real)");
  const purchase = await ruleExists(c, "Compra de entrada");
  if (purchase) {
    console.log("  · skip (ya existe)");
  } else {
    await insertRule(c, {
      name: "Compra de entrada",
      description: "1 SegoToken por cada 1€ realmente pagado (importe real del pedido, no precio nominal de entrada) — spec SegoTokens Economy §3.B.",
      direction: "earn", origin: "ticket", scope: "global",
      calc_method: "per_euro", rate: "1.0000",
      daily_limit: DAILY, weekly_limit: WEEKLY, monthly_limit: MONTHLY,
      active: 1, priority: 0,
    });
  }

  console.log("\n[3/6] Reglas de recurrencia (3ª/5ª/10ª acción en el mes — visit_count, ventana mensual)");
  const recurrenceTiers = [
    ["Recurrencia — 3ª acción del mes", 3, 10],
    ["Recurrencia — 5ª acción del mes", 5, 20],
    ["Recurrencia — 10ª acción del mes", 10, 50],
  ];
  for (const [name, threshold, bonus] of recurrenceTiers) {
    const existing = await ruleExists(c, name);
    if (existing) { console.log(`  · skip "${name}" (ya existe)`); continue; }
    await insertRule(c, {
      name,
      description: `Bonus por ${threshold}ª operación de earn (cualquier origin) del mes en curso — spec SegoTokens Economy §4.`,
      direction: "earn", origin: "recurrence", scope: "global",
      calc_method: "fixed", fixed_amount: bonus,
      recurrence_window: "month", recurrence_threshold: threshold, recurrence_mode: "visit_count",
      active: 1, priority: 0,
    });
  }

  console.log("\n[4/6] Regla de descubrimiento cross-venue (2º venue distinto, de por vida, una sola vez)");
  const crossVenueName = "Recurrencia — descubre otro venue";
  const crossVenue = await ruleExists(c, crossVenueName);
  if (crossVenue) {
    console.log("  · skip (ya existe)");
  } else {
    await insertRule(c, {
      name: crossVenueName,
      description: "Bonus único, de por vida, al generar una operación de earn en el 2º venue distinto (cross-venue discovery) — spec SegoTokens Economy §5.",
      direction: "earn", origin: "recurrence", scope: "global",
      calc_method: "fixed", fixed_amount: 10,
      recurrence_window: "lifetime", recurrence_threshold: 2, recurrence_mode: "distinct_venues",
      active: 1, priority: 0,
    });
  }

  console.log("\n[5/6] 'Consumo en venue' (ya existente, per_euro 0.5) — SIN CAMBIOS, solo verificación");
  const consumption = await ruleExists(c, "Consumo en venue");
  console.log(consumption ? `  · confirmado: id=${consumption.id}, sin caps (fuera de alcance explícito de esta fase)` : "  ✗ no encontrada — inesperado");

  console.log("\n[6/6] system_settings.estimated_token_value_cents (ANALÍTICO, nunca altera cuántos tokens recibe un Student)");
  const [[existingSetting]] = await c.query(`SELECT COUNT(*) AS n FROM system_settings WHERE \`key\` = 'estimated_token_value_cents'`);
  if (existingSetting.n > 0) {
    console.log("  · skip (ya existe)");
  } else {
    await c.execute(
      `INSERT INTO system_settings (\`key\`, value, value_type, category, label, description, is_sensitive, is_public)
       VALUES (?, '2', 'number', 'loyalty', 'Valor promocional estimado por SegoToken (céntimos)', ?, 0, 0)`,
      ["estimated_token_value_cents", "ESTIMATED PROMOTIONAL VALUE, solo para analítica (coste promocional estimado / ratio reward-revenue). SegoTokens NUNCA son dinero, saldo bancario, retirables ni convertibles a efectivo — este valor nunca altera cuántos tokens recibe un Student, solo cómo se reporta su coste estimado al admin."]
    );
    console.log("  ✓ INSERT system_settings.estimated_token_value_cents (2 → €0.02)");
  }

  console.log("\n[VERIFICACIÓN]");
  const [allRules] = await c.query(`SELECT id, name, origin, calc_method, fixed_amount, rate, daily_limit, weekly_limit, monthly_limit, recurrence_window, recurrence_threshold, recurrence_mode, active FROM token_rules ORDER BY id`);
  console.table(allRules);
  const [settingRow] = await c.query(`SELECT \`key\`, value FROM system_settings WHERE \`key\` = 'estimated_token_value_cents'`);
  console.log("estimated_token_value_cents:", JSON.stringify(settingRow));

  await c.end();
  console.log("=".repeat(72));
  console.log("FIN — política de economía SegoTokens configurada. LIVE_MODE_ENABLED sigue en false en código — 0 tokens reales.");
  console.log("=".repeat(72));
})().catch(e => { console.error("ERR", e); process.exit(1); });
