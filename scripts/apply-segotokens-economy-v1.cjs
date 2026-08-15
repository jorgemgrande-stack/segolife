// SEGOLIFE FASE 10.5 — SEGOTOKENS ECONOMY CONTROL CENTER — activación V1.
// Idempotente: cada paso comprueba el valor ANTES de escribir y solo actúa
// si difiere del V1 objetivo. Registra cada cambio real en
// economy_config_changes (mismo criterio que economyGovernanceService.ts).
// NUNCA reescribe token_ledger — solo cambia la CONFIGURACIÓN futura.
//
// Run: railway ssh --service segolife -- node scripts/apply-segotokens-economy-v1.cjs

const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const SYSTEM_ACTOR_USER_ID = 1; // primer admin real de la plataforma — usado solo como actor de auditoría, nunca como beneficiario económico.

async function findAdminUserId(c) {
  const [rows] = await c.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
  return rows[0]?.id ?? SYSTEM_ACTOR_USER_ID;
}

async function recordChange(c, entityType, entityId, fieldName, oldValue, newValue, actorUserId, reason) {
  await c.execute(
    `INSERT INTO economy_config_changes (entity_type, entity_id, field_name, old_value, new_value, reason, actor_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [entityType, entityId, fieldName, oldValue, newValue, reason, actorUserId]
  );
}

(async () => {
  console.log("=".repeat(72));
  console.log("SEGOTOKENS ECONOMY V1 — activación de valores de producción");
  console.log("=".repeat(72));

  const c = await mysql.createConnection(DB_URL);
  const actorUserId = await findAdminUserId(c);
  const reason = "Activación SEGOLIFE Economy V1 (Fase 10.5)";

  // ── [0/8] Impacto económico ANTES de escribir nada (spec §42/§43) ─────────
  const [[walletStats]] = await c.query(`SELECT COUNT(*) AS wallets, COALESCE(SUM(balance),0) AS totalBalance, COALESCE(MAX(balance),0) AS maxBalance FROM token_wallets`);
  console.log(`\n[IMPACTO] wallets=${walletStats.wallets} totalBalance=${walletStats.totalBalance} ST maxBalance=${walletStats.maxBalance} ST`);
  console.log(`[IMPACTO] poder de gasto promocional a 100 ST=€1: ${(walletStats.totalBalance / 100).toFixed(2)} €`);

  // ── [1/8] Asistencia a evento: fixed 15 -> 100 ────────────────────────────
  const [[attendance]] = await c.query(`SELECT id, fixed_amount FROM token_rules WHERE name = 'Asistencia a evento'`);
  if (attendance && Number(attendance.fixed_amount) !== 100) {
    await c.execute(`UPDATE token_rules SET fixed_amount = 100 WHERE id = ?`, [attendance.id]);
    await recordChange(c, "token_rule", attendance.id, "fixedAmount", String(attendance.fixed_amount), "100", actorUserId, reason);
    console.log(`✓ Asistencia a evento: ${attendance.fixed_amount} → 100 ST`);
  } else console.log(`· Asistencia a evento: sin cambios (${attendance?.fixed_amount ?? "no encontrada"})`);

  // ── [2/8] Consumo en venue: rate 0.5 -> 3 ─────────────────────────────────
  const [[consumption]] = await c.query(`SELECT id, rate FROM token_rules WHERE name = 'Consumo en venue'`);
  if (consumption && Number(consumption.rate) !== 3) {
    await c.execute(`UPDATE token_rules SET rate = '3.0000' WHERE id = ?`, [consumption.id]);
    await recordChange(c, "token_rule", consumption.id, "rate", consumption.rate, "3.0000", actorUserId, reason);
    console.log(`✓ Consumo en venue: ${consumption.rate} → 3.0000 ST/€ (misma fila — nunca una regla duplicada)`);
  } else console.log(`· Consumo en venue: sin cambios (${consumption?.rate ?? "no encontrada"})`);

  // ── [3/8] Compra de entrada: rate 1.0 -> 5 ────────────────────────────────
  const [[ticket]] = await c.query(`SELECT id, rate FROM token_rules WHERE name = 'Compra de entrada'`);
  if (ticket && Number(ticket.rate) !== 5) {
    await c.execute(`UPDATE token_rules SET rate = '5.0000' WHERE id = ?`, [ticket.id]);
    await recordChange(c, "token_rule", ticket.id, "rate", ticket.rate, "5.0000", actorUserId, reason);
    console.log(`✓ Compra de entrada: ${ticket.rate} → 5.0000 ST/€`);
  } else console.log(`· Compra de entrada: sin cambios (${ticket?.rate ?? "no encontrada"})`);

  // ── [4/8] Recurrencia — descubre otro venue: fixed 10 -> 100 ──────────────
  const [[crossVenue]] = await c.query(`SELECT id, fixed_amount FROM token_rules WHERE name = 'Recurrencia — descubre otro venue'`);
  if (crossVenue && Number(crossVenue.fixed_amount) !== 100) {
    await c.execute(`UPDATE token_rules SET fixed_amount = 100 WHERE id = ?`, [crossVenue.id]);
    await recordChange(c, "token_rule", crossVenue.id, "fixedAmount", String(crossVenue.fixed_amount), "100", actorUserId, reason);
    console.log(`✓ Recurrencia — descubre otro venue: ${crossVenue.fixed_amount} → 100 ST`);
  } else console.log(`· Recurrencia — descubre otro venue: sin cambios (${crossVenue?.fixed_amount ?? "no encontrada"})`);

  // ── [5/8] Community — participación: fixed 2 -> 50 (productor real confirmado) ──
  const [[response]] = await c.query(`SELECT id, fixed_amount FROM token_rules WHERE name = 'Participación en COMUNITY'`);
  if (response && Number(response.fixed_amount) !== 50) {
    await c.execute(`UPDATE token_rules SET fixed_amount = 50 WHERE id = ?`, [response.id]);
    await recordChange(c, "token_rule", response.id, "fixedAmount", String(response.fixed_amount), "50", actorUserId, reason);
    console.log(`✓ Participación en COMUNITY: ${response.fixed_amount} → 50 ST`);
  } else console.log(`· Participación en COMUNITY: sin cambios (${response?.fixed_amount ?? "no encontrada"})`);

  // ── [6/8] Community — propuesta aprobada: fixed 10 -> 200 (productor real confirmado) ──
  const [[approved]] = await c.query(`SELECT id, fixed_amount FROM token_rules WHERE name = 'Propuesta de estudiante aprobada en COMUNITY'`);
  if (approved && Number(approved.fixed_amount) !== 200) {
    await c.execute(`UPDATE token_rules SET fixed_amount = 200 WHERE id = ?`, [approved.id]);
    await recordChange(c, "token_rule", approved.id, "fixedAmount", String(approved.fixed_amount), "200", actorUserId, reason);
    console.log(`✓ Propuesta de estudiante aprobada en COMUNITY: ${approved.fixed_amount} → 200 ST`);
  } else console.log(`· Propuesta de estudiante aprobada en COMUNITY: sin cambios (${approved?.fixed_amount ?? "no encontrada"})`);
  console.log(`  (Idea PROPUESTA/enviada: SIN cambios — sin productor real, spec §7 — nunca se finge)`);

  // ── [7/8] Política de canje global: 100 ST = €1 (no existía ninguna) ──────
  const [[globalPolicy]] = await c.query(`SELECT id, tokens_per_unit, value_cents_per_unit FROM token_redemption_policies WHERE community_id IS NULL AND venue_id IS NULL AND event_id IS NULL LIMIT 1`);
  if (!globalPolicy) {
    const [result] = await c.execute(
      `INSERT INTO token_redemption_policies (name, description, active, community_id, venue_id, event_id, tokens_per_unit, value_cents_per_unit, min_token_spend, max_token_spend, max_percentage, allow_full_token_payment, priority, created_by_user_id) VALUES (?, ?, 1, NULL, NULL, NULL, 100, 100, NULL, NULL, 100, 1, 0, ?)`,
      ["SEGOLIFE Economy V1 — Global", "100 ST = €1,00 de valor promocional — política global de canje.", actorUserId]
    );
    await recordChange(c, "redemption_policy", result.insertId, "conversion", null, "100 ST = 100c", actorUserId, reason);
    console.log(`✓ Política de canje global creada: 100 ST = €1,00 (id=${result.insertId})`);
  } else if (Number(globalPolicy.tokens_per_unit) !== 100 || Number(globalPolicy.value_cents_per_unit) !== 100) {
    await c.execute(`UPDATE token_redemption_policies SET tokens_per_unit = 100, value_cents_per_unit = 100 WHERE id = ?`, [globalPolicy.id]);
    await recordChange(c, "redemption_policy", globalPolicy.id, "conversion", `${globalPolicy.tokens_per_unit} ST = ${globalPolicy.value_cents_per_unit}c`, "100 ST = 100c", actorUserId, reason);
    console.log(`✓ Política de canje global actualizada a 100 ST = €1,00`);
  } else console.log(`· Política de canje global: ya en 100 ST = €1,00`);

  // ── [8/8] Campaña de referidos global: +500 quien invita / +250 nuevo Student ──
  const [[activeReferral]] = await c.query(`SELECT id, inviter_reward_tokens, invitee_reward_tokens FROM referral_campaigns WHERE community_id IS NULL AND status = 'active' LIMIT 1`);
  if (!activeReferral) {
    const [result] = await c.execute(
      `INSERT INTO referral_campaigns (name, status, community_id, inviter_reward_tokens, invitee_reward_tokens, conversion_condition, attribution_window_days, priority, created_by_user_id, activated_at, activated_by_user_id) VALUES (?, 'active', NULL, 500, 250, 'profile_completed', 30, 0, ?, NOW(), ?)`,
      ["SEGOLIFE Economy V1 — Invitaciones", actorUserId, actorUserId]
    );
    await recordChange(c, "referral_campaign", result.insertId, "rewards", null, "inviter=500,invitee=250", actorUserId, reason);
    console.log(`✓ Campaña de referidos global creada y activada: +500 / +250 ST (id=${result.insertId})`);
  } else if (Number(activeReferral.inviter_reward_tokens) !== 500 || Number(activeReferral.invitee_reward_tokens) !== 250) {
    await c.execute(`UPDATE referral_campaigns SET inviter_reward_tokens = 500, invitee_reward_tokens = 250 WHERE id = ?`, [activeReferral.id]);
    await recordChange(c, "referral_campaign", activeReferral.id, "rewards", `inviter=${activeReferral.inviter_reward_tokens},invitee=${activeReferral.invitee_reward_tokens}`, "inviter=500,invitee=250", actorUserId, reason);
    console.log(`✓ Campaña de referidos global actualizada a +500 / +250 ST`);
  } else console.log(`· Campaña de referidos global: ya en +500 / +250 ST`);

  console.log("\n[VERIFICACIÓN FINAL]");
  const [rules] = await c.query(`SELECT id, name, fixed_amount, rate FROM token_rules WHERE name IN ('Asistencia a evento','Consumo en venue','Compra de entrada','Recurrencia — descubre otro venue','Participación en COMUNITY','Propuesta de estudiante aprobada en COMUNITY') ORDER BY id`);
  console.table(rules);
  const [[policyCheck]] = await c.query(`SELECT COUNT(*) AS n FROM token_redemption_policies WHERE community_id IS NULL AND venue_id IS NULL AND event_id IS NULL`);
  const [[referralCheck]] = await c.query(`SELECT COUNT(*) AS n FROM referral_campaigns WHERE community_id IS NULL AND status = 'active'`);
  console.log(`Políticas de canje globales: ${policyCheck.n} (debe ser exactamente 1)`);
  console.log(`Campañas de referidos globales activas: ${referralCheck.n} (debe ser exactamente 1)`);

  await c.end();
  console.log("=".repeat(72));
  console.log("FIN — SEGOTOKENS ECONOMY V1 activada. Ningún movimiento de token_ledger fue modificado.");
  console.log("=".repeat(72));
})().catch(e => { console.error("ERR", e); process.exit(1); });
