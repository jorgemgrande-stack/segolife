// Aplica 0151_commerce_core_door_sales (COMMERCE CORE, SALES, POS, ORDERS &
// EVENT OPERATIONS). Idempotente. Puramente aditiva: 8 columnas nuevas en 4
// tablas existentes + 1 tabla nueva (commerce_refunds). Ninguna tabla
// existente pierde datos ni cambia semántica de los valores ya existentes
// (el ensanche de commerce_transactions.status es aditivo).
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function tableExists(c, t) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t]);
  return r[0].n > 0;
}
async function columnExists(c, t, col) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [t, col]);
  return r[0].n > 0;
}

(async () => {
  console.log("COMMERCE CORE, SALES, POS, ORDERS & EVENT OPERATIONS (0151)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await columnExists(c, "event_ticket_types", "is_door_entry")) {
    console.log("· skip event_ticket_types.is_door_entry (ya existe)");
  } else {
    await c.query(`ALTER TABLE \`event_ticket_types\` ADD COLUMN \`is_door_entry\` boolean NOT NULL DEFAULT false AFTER \`status\``);
    console.log("✓ ADD COLUMN event_ticket_types.is_door_entry");
  }

  const ticketOrderCols = [
    ["channel", "ALTER TABLE `ticket_orders` ADD COLUMN `channel` enum('online','door') DEFAULT NULL AFTER `idempotency_key`"],
    ["operator_user_id", "ALTER TABLE `ticket_orders` ADD COLUMN `operator_user_id` int DEFAULT NULL AFTER `channel`"],
    ["payment_method", "ALTER TABLE `ticket_orders` ADD COLUMN `payment_method` varchar(32) DEFAULT NULL AFTER `operator_user_id`"],
    ["token_reservation_id", "ALTER TABLE `ticket_orders` ADD COLUMN `token_reservation_id` int DEFAULT NULL AFTER `payment_method`"],
  ];
  for (const [col, sql] of ticketOrderCols) {
    if (await columnExists(c, "ticket_orders", col)) { console.log(`· skip ticket_orders.${col} (ya existe)`); continue; }
    await c.query(sql);
    console.log(`✓ ADD COLUMN ticket_orders.${col}`);
  }

  // Enum de status — MODIFY es idempotente en sí (aplicar dos veces el mismo
  // enum no rompe nada), pero comprobamos igualmente para el log limpio.
  const [[statusCol]] = await c.query(`SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='commerce_transactions' AND COLUMN_NAME='status'`);
  if (statusCol && statusCol.t.includes("partially_refunded")) {
    console.log("· skip commerce_transactions.status enum (ya incluye partially_refunded)");
  } else {
    await c.query(`ALTER TABLE \`commerce_transactions\` MODIFY COLUMN \`status\` enum('pending','confirmed','cancelled','refunded','partially_refunded','reconciliation_required') NOT NULL DEFAULT 'pending'`);
    console.log("✓ MODIFY commerce_transactions.status (+ partially_refunded)");
  }

  if (await columnExists(c, "commerce_transactions", "operator_user_id")) {
    console.log("· skip commerce_transactions.operator_user_id (ya existe)");
  } else {
    await c.query(`ALTER TABLE \`commerce_transactions\` ADD COLUMN \`operator_user_id\` int DEFAULT NULL AFTER \`token_reservation_id\``);
    console.log("✓ ADD COLUMN commerce_transactions.operator_user_id");
  }
  if (await columnExists(c, "commerce_transactions", "refunded_amount_cents")) {
    console.log("· skip commerce_transactions.refunded_amount_cents (ya existe)");
  } else {
    await c.query(`ALTER TABLE \`commerce_transactions\` ADD COLUMN \`refunded_amount_cents\` int NOT NULL DEFAULT 0 AFTER \`operator_user_id\``);
    console.log("✓ ADD COLUMN commerce_transactions.refunded_amount_cents");
  }

  if (await columnExists(c, "commerce_transaction_items", "refunded_quantity")) {
    console.log("· skip commerce_transaction_items.refunded_quantity (ya existe)");
  } else {
    await c.query(`ALTER TABLE \`commerce_transaction_items\` ADD COLUMN \`refunded_quantity\` int NOT NULL DEFAULT 0 AFTER \`total_amount_cents\``);
    console.log("✓ ADD COLUMN commerce_transaction_items.refunded_quantity");
  }

  if (await tableExists(c, "commerce_refunds")) {
    console.log("· skip commerce_refunds (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`commerce_refunds\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`source_type\` enum('commerce_transaction','ticket_order') NOT NULL,
        \`source_id\` int NOT NULL,
        \`venue_id\` int DEFAULT NULL,
        \`event_id\` int DEFAULT NULL,
        \`user_id\` int DEFAULT NULL,
        \`amount_cents\` int NOT NULL,
        \`tokens_restored\` int NOT NULL DEFAULT 0,
        \`money_refund_status\` enum('completed','provider_unavailable') NOT NULL,
        \`reason\` varchar(500) NOT NULL,
        \`partial\` boolean NOT NULL DEFAULT false,
        \`refunded_by_user_id\` int NOT NULL,
        \`idempotency_key\` varchar(191) DEFAULT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`commerce_refunds_idempotency_key_unique\` (\`idempotency_key\`),
        KEY \`commerce_refunds_source_idx\` (\`source_type\`, \`source_id\`),
        KEY \`commerce_refunds_created_at_idx\` (\`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✓ CREATE TABLE commerce_refunds");
  }

  const tag = "0151_commerce_core_door_sales";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [[doorTypesCount]] = await c.query(`SELECT COUNT(*) AS n FROM event_ticket_types WHERE is_door_entry = 1`);
  const [[refundsCount]] = await c.query(`SELECT COUNT(*) AS n FROM commerce_refunds`);
  console.log(`\n[POST] tipos de entrada de puerta configurados: ${doorTypesCount.n} (debe ser 0 tras un deploy limpio)`);
  console.log(`[POST] commerce_refunds total: ${refundsCount.n} (debe ser 0 tras un deploy limpio)`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
