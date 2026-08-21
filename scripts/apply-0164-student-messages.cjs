// COM-01 — Bidirectional Student Communication Center: infraestructura
// canónica de conversación Admin↔Student. Crea `conversations` +
// `conversation_messages`, añade 'messages' a notifications.category y
// notification_preferences.category, y siembra los permisos RBAC
// student_messages.view/manage (concedidos a "admin" únicamente — nunca
// venue_admin, ver server/segolife/rbac/venueAdminPolicy.ts).
//
// Aditiva, idempotente (SHOW COLUMNS/SHOW TABLES antes de cada cambio).
// Run: railway ssh (contenedor /app) node scripts/apply-0164-student-messages.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0164_student_messages";

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0164 — COM-01: conversations + conversation_messages");
  console.log("=".repeat(70));

  const c = await mysql.createConnection(DB_URL);

  // ── conversations ─────────────────────────────────────────────────────────
  const [convTables] = await c.query("SHOW TABLES LIKE 'conversations'");
  if (convTables.length > 0) {
    console.log("skip CREATE TABLE conversations (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`conversations\` (
        \`id\`                     INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`student_user_id\`        INT NOT NULL,
        \`type\`                   VARCHAR(32) NOT NULL DEFAULT 'general',
        \`context_type\`           VARCHAR(64) NULL,
        \`context_id\`             INT NULL,
        \`subject\`                VARCHAR(256) NOT NULL,
        \`status\`                 ENUM('open','closed') NOT NULL DEFAULT 'open',
        \`waiting_for\`            ENUM('student','admin','none') NOT NULL DEFAULT 'student',
        \`created_by_user_id\`     INT NOT NULL,
        \`last_message_at\`        TIMESTAMP(3) NULL,
        \`last_message_preview\`   VARCHAR(160) NULL,
        \`closed_at\`              TIMESTAMP NULL,
        \`closed_by_user_id\`      INT NULL,
        \`student_last_read_at\`   TIMESTAMP(3) NULL,
        \`admin_last_read_at\`     TIMESTAMP(3) NULL,
        \`created_at\`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`conversations_student_user_id_idx\` (\`student_user_id\`),
        INDEX \`conversations_status_idx\` (\`status\`),
        INDEX \`conversations_waiting_for_idx\` (\`waiting_for\`),
        INDEX \`conversations_last_message_at_idx\` (\`last_message_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE conversations");
  }

  // ── conversation_messages ─────────────────────────────────────────────────
  const [msgTables] = await c.query("SHOW TABLES LIKE 'conversation_messages'");
  if (msgTables.length > 0) {
    console.log("skip CREATE TABLE conversation_messages (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`conversation_messages\` (
        \`id\`               INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`conversation_id\`  INT NOT NULL,
        \`sender_user_id\`   INT NOT NULL,
        \`sender_role\`      ENUM('student','admin') NOT NULL,
        \`visibility\`       ENUM('public','internal') NOT NULL DEFAULT 'public',
        \`body\`             TEXT NOT NULL,
        \`created_at\`       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`conversation_messages_conversation_id_idx\` (\`conversation_id\`),
        INDEX \`conversation_messages_created_at_idx\` (\`created_at\`),
        CONSTRAINT \`fk_conversation_messages_conversation\`
          FOREIGN KEY (\`conversation_id\`) REFERENCES \`conversations\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ CREATE TABLE conversation_messages");
  }

  // ── Precisión de milisegundos en columnas comparadas entre sí ─────────────
  // TIMESTAMP por defecto (1 segundo) empataría lastMessageAt con
  // studentLastReadAt/adminLastReadAt en un intercambio rápido real (marcar
  // leído y responder en el mismo segundo), dejando una conversación recién
  // respondida marcada como ya leída — bug real encontrado en tests. Cubre
  // tanto una tabla recién creada arriba (ya en TIMESTAMP(3)) como una ya
  // existente de una ejecución previa de este mismo script sin este fix.
  const PRECISION_COLUMNS = [
    ["conversations", "last_message_at", "TIMESTAMP(3) NULL"],
    ["conversations", "student_last_read_at", "TIMESTAMP(3) NULL"],
    ["conversations", "admin_last_read_at", "TIMESTAMP(3) NULL"],
    ["conversation_messages", "created_at", "TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)"],
  ];
  for (const [tbl, col, ddl] of PRECISION_COLUMNS) {
    const [colRows] = await c.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tbl, col]
    );
    const colType = colRows[0]?.COLUMN_TYPE ?? "";
    if (colType.includes("(3)")) {
      console.log(`skip ALTER ${tbl}.${col} (ya tiene precisión de milisegundos)`);
    } else {
      await c.query(`ALTER TABLE \`${tbl}\` MODIFY COLUMN \`${col}\` ${ddl}`);
      console.log(`✓ ALTER ${tbl}.${col} → precisión de milisegundos`);
    }
  }

  // ── notifications.category / notification_preferences.category += 'messages' ──
  for (const tbl of ["notifications", "notification_preferences"]) {
    const [colRows] = await c.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'category'`,
      [tbl]
    );
    const colType = colRows[0]?.COLUMN_TYPE ?? "";
    if (colType.includes("'messages'")) {
      console.log(`skip ALTER ${tbl}.category (ya incluye 'messages')`);
    } else {
      await c.query(`
        ALTER TABLE \`${tbl}\`
        MODIFY COLUMN \`category\` ENUM('events','rewards','benefits','promotions','account','messages') NOT NULL
      `);
      console.log(`✓ ALTER ${tbl}.category += 'messages'`);
    }
  }

  // ── RBAC: student_messages.view / student_messages.manage → admin ────────
  const PERMS = [
    ["student_messages.view", "student_messages", "view", "Ver conversaciones y mensajes bidireccionales con estudiantes"],
    ["student_messages.manage", "student_messages", "manage", "Iniciar conversaciones, responder, cerrar y reabrir mensajes con estudiantes"],
  ];
  for (const [key, module, action, description] of PERMS) {
    const [existing] = await c.query("SELECT id FROM rbac_permissions WHERE `key` = ?", [key]);
    if (existing.length > 0) {
      console.log(`  · skip INSERT rbac_permissions (${key} ya existe)`);
    } else {
      await c.query(
        "INSERT INTO rbac_permissions (`key`, module, action, description) VALUES (?, ?, ?, ?)",
        [key, module, action, description]
      );
      console.log(`  ✓ INSERT rbac_permissions ${key}`);
    }

    const [grantExists] = await c.query(`
      SELECT rp.role_id FROM rbac_role_permissions rp
      JOIN rbac_roles r ON r.id = rp.role_id
      JOIN rbac_permissions p ON p.id = rp.permission_id
      WHERE r.\`key\` = 'admin' AND p.\`key\` = ?
    `, [key]);
    if (grantExists.length > 0) {
      console.log(`  · skip GRANT admin→${key} (ya concedido)`);
    } else {
      await c.query(`
        INSERT INTO rbac_role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
        WHERE r.\`key\` = 'admin' AND p.\`key\` = ?
      `, [key]);
      console.log(`  ✓ GRANT admin→${key}`);
    }
  }

  // ── Tracking __drizzle_migrations ─────────────────────────────────────────
  console.log("\n[TRACKING] __drizzle_migrations");
  const [tracked] = await c.query("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?", [TAG]);
  if (tracked[0].n > 0) {
    console.log(`  skip ${TAG} (ya registrada)`);
  } else {
    await c.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  // ── Post-verificación ─────────────────────────────────────────────────────
  const [finalTables] = await c.query("SHOW TABLES LIKE 'conversation%'");
  const [finalPerms] = await c.query("SELECT `key` FROM rbac_permissions WHERE `key` LIKE 'student_messages.%'");
  console.log("\n[DESPUÉS] tablas:", JSON.stringify(finalTables.map(r => Object.values(r)[0])));
  console.log("[DESPUÉS] permisos:", JSON.stringify(finalPerms.map(r => r.key)));

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0164 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
