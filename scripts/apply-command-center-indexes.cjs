// Aplica los índices del SEGOLIFE COMMAND CENTER — puramente aditivo, sin
// tocar datos ni semántica. Justificación real (EXPLAIN antes de aplicar,
// ver informe de fase): ticket_orders (19.758 filas) y event_tickets
// (23.758 filas) hacían full table scan ("type":"ALL") en las consultas
// agregadas por periodo/evento que alimentan el dashboard; unresolved_operations
// (45.053 filas) escaneaba 22.121 filas por GROUP BY sin índice dedicado.
// El resto de tablas (event_attendance/token_ledger/consumption_qr_codes/
// commerce_transactions/ticket_payments) tienen 0-3 filas reales hoy — el
// índice es preventivo (mismo patrón de consulta, crecerán) — NO se afirma
// una mejora medible que todavía no existe.
//
// Idempotente. Run: railway ssh --service segolife -- node scripts/apply-command-center-indexes.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0999_command_center_indexes";

async function idxExists(c, t, idx) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, [t, idx]);
  return r[0].n > 0;
}
async function createIdx(c, t, name, cols) {
  if (await idxExists(c, t, name)) { console.log(`  · skip ${t}.${name} (ya existe)`); return; }
  await c.query(`CREATE INDEX \`${name}\` ON \`${t}\` ${cols}`);
  console.log(`  ✓ CREATE INDEX ${t}.${name}`);
}

const INDEXES = [
  // Tier 1 — beneficio real HOY (full table scan confirmado por EXPLAIN sobre datos reales).
  ["ticket_orders", "idx_ticket_orders_status_purchased_at", "(`status`, `purchased_at`)"],
  ["ticket_orders", "idx_ticket_orders_event_id", "(`event_id`)"],
  ["event_tickets", "idx_event_tickets_event_status", "(`event_id`, `status`)"],
  ["event_tickets", "idx_event_tickets_order_id", "(`order_id`)"],
  ["ticket_order_items", "idx_ticket_order_items_order_id", "(`order_id`)"],
  ["ticket_order_items", "idx_ticket_order_items_ticket_type_id", "(`ticket_type_id`)"],
  ["unresolved_operations", "idx_unresolved_operations_status_venue", "(`status`, `venue_id`)"],
  ["unresolved_operations", "idx_unresolved_operations_provider", "(`provider`)"],
  // Compuesto añadido tras el 1er EXPLAIN — la consulta real de Historical Audience filtra
  // por provider Y agrupa por venue_id+status a la vez; los dos índices de arriba, por
  // separado, no cubrían esa combinación exacta (verificado: seguía escaneando 22.121 filas
  // con "Using temporary"). Con este compuesto pasa a "Using index" (covering, sin tocar la fila).
  ["unresolved_operations", "idx_unresolved_operations_provider_venue_status", "(`provider`, `venue_id`, `status`)"],

  // Tier 2 — preventivo, mismo patrón de consulta, tablas con 0-3 filas reales hoy.
  ["event_attendance", "idx_event_attendance_event_id", "(`event_id`)"],
  ["event_attendance", "idx_event_attendance_venue_id", "(`venue_id`)"],
  ["event_attendance", "idx_event_attendance_occurred_at", "(`occurred_at`)"],
  ["token_ledger", "idx_token_ledger_user_id", "(`user_id`)"],
  ["token_ledger", "idx_token_ledger_venue_id", "(`venue_id`)"],
  ["token_ledger", "idx_token_ledger_event_id", "(`event_id`)"],
  ["token_ledger", "idx_token_ledger_rule_id", "(`rule_id`)"],
  ["token_ledger", "idx_token_ledger_created_at", "(`created_at`)"],
  ["consumption_qr_codes", "idx_consumption_qr_codes_venue_id", "(`venue_id`)"],
  ["consumption_qr_codes", "idx_consumption_qr_codes_redeemed_by_user_id", "(`redeemed_by_user_id`)"],
  ["consumption_qr_codes", "idx_consumption_qr_codes_status", "(`status`)"],
  ["consumption_qr_codes", "idx_consumption_qr_codes_redeemed_at", "(`redeemed_at`)"],
  ["commerce_transactions", "idx_commerce_transactions_venue_id", "(`venue_id`)"],
  ["commerce_transactions", "idx_commerce_transactions_status", "(`status`)"],
  ["commerce_transactions", "idx_commerce_transactions_occurred_at", "(`occurred_at`)"],
  ["ticket_payments", "idx_ticket_payments_order_id", "(`order_id`)"],
  ["notifications", "idx_notifications_user_id_read_at", "(`user_id`, `read_at`)"],
  ["notifications", "idx_notifications_created_at", "(`created_at`)"],
];

(async () => {
  console.log("=".repeat(72));
  console.log("SEGOLIFE COMMAND CENTER — migración de índices (aditiva, solo performance)");
  console.log("=".repeat(72));

  const c = await mysql.createConnection({ uri: DB_URL });

  for (const [table, name, cols] of INDEXES) {
    try {
      await createIdx(c, table, name, cols);
    } catch (err) {
      console.error(`  ✗ ERROR en ${table}.${name}: ${err.message}`);
      console.error("  DETENIÉNDOME para esta instrucción — no se elimina ni se fuerza nada.");
      await c.end();
      process.exit(1);
    }
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [TAG]);
  if (exists.n > 0) { console.log(`  · skip ${TAG} (ya registrada)`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  console.log("\n[VERIFICACIÓN] Índices creados por tabla:");
  const tables = [...new Set(INDEXES.map(i => i[0]))];
  for (const t of tables) {
    const [rows] = await c.query(`SHOW INDEX FROM \`${t}\``);
    const names = [...new Set(rows.map(r => r.Key_name))];
    console.log(`  ${t}: ${names.join(", ")}`);
  }

  await c.end();
  console.log("=".repeat(72));
  console.log("FIN — migración de índices aplicada");
  console.log("=".repeat(72));
})().catch(e => { console.error("ERR", e); process.exit(1); });
