// Siembra puntual e idempotente de los permisos RBAC de Fase 10 (Fiscal,
// Invoicing, Stock & Venue Settlements) — mismo criterio exacto que
// server/_core/rbacSeed.ts (INSERT IGNORE, seguro de re-ejecutar).
//
// fiscal.* / settlements.* → SOLO rol admin (spec §5/§69/§83/§86, GLOBAL_ADMIN
// exclusivo, nunca venue_admin/staff).
// stock.view / stock.adjust / cash.view / cash.operate → rol admin Y rol
// staff (mismo criterio que commerce.record/attendance.redeem en Fase 8/9).
// stock.manage / cash.manage → SOLO admin (configuración global).
//
// Además, DEFENSIVO: si existe un rol RBAC con key='venue_admin' (algunos
// entornos lo crearon directamente, fuera de este repo, en vez de asignar el
// rol 'staff' a los usuarios Venue Admin) también recibe stock.view/
// stock.adjust/cash.view/cash.operate — no-op seguro si ese rol no existe.
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const PERMS = [
  ["fiscal.view", "fiscal", "view", "Ver entidades fiscales, tipos de IVA, series, facturas y abonos"],
  ["fiscal.manage", "fiscal", "manage", "Configurar entidades fiscales/vendedor por venue, tipos de IVA, series y emitir facturas/abonos"],
  ["stock.view", "stock", "view", "Ver stock, movimientos y productos con control de inventario de un venue"],
  ["stock.adjust", "stock", "adjust", "Registrar merma, ajuste manual o apertura de stock en un venue"],
  ["stock.manage", "stock", "manage", "Configurar qué productos llevan control de stock, umbrales de aviso y política de stock negativo"],
  ["cash.view", "cash", "view", "Ver sesiones de caja, movimientos y cierres de un venue"],
  ["cash.operate", "cash", "operate", "Abrir/cerrar sesión de caja y registrar movimientos de efectivo en un venue"],
  ["cash.manage", "cash", "manage", "Gestión avanzada de caja (reservado para uso futuro)"],
  ["settlements.view", "settlements", "view", "Ver acuerdos comerciales y liquidaciones por venue"],
  ["settlements.manage", "settlements", "manage", "Configurar acuerdos comerciales, calcular/aprobar/marcar pagadas liquidaciones"],
];

const VENUE_SCOPED_KEYS = ["stock.view", "stock.adjust", "cash.view", "cash.operate"];

(async () => {
  const c = await mysql.createConnection({ uri: DB_URL });
  const permissionsAdded = [];
  const grantsEnsured = [];

  for (const [key, module, action, description] of PERMS) {
    const [result] = await c.execute(
      "INSERT IGNORE INTO rbac_permissions (`key`, module, action, description) VALUES (?, ?, ?, ?)",
      [key, module, action, description]
    );
    if (result.affectedRows > 0) permissionsAdded.push(key);
  }

  for (const [key] of PERMS) {
    const [result] = await c.execute(
      `INSERT IGNORE INTO rbac_role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
       WHERE r.\`key\` = 'admin' AND p.\`key\` = ?`,
      [key]
    );
    if (result.affectedRows > 0) grantsEnsured.push(`admin -> ${key}`);
  }

  for (const key of VENUE_SCOPED_KEYS) {
    const [staffResult] = await c.execute(
      `INSERT IGNORE INTO rbac_role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
       WHERE r.\`key\` = 'staff' AND p.\`key\` = ?`,
      [key]
    );
    if (staffResult.affectedRows > 0) grantsEnsured.push(`staff -> ${key}`);

    // Defensivo: solo aplica si existe un rol 'venue_admin' — no-op si no.
    const [venueAdminResult] = await c.execute(
      `INSERT IGNORE INTO rbac_role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
       WHERE r.\`key\` = 'venue_admin' AND p.\`key\` = ?`,
      [key]
    );
    if (venueAdminResult.affectedRows > 0) grantsEnsured.push(`venue_admin -> ${key}`);
  }

  console.log("Permisos nuevos:", permissionsAdded.join(", ") || "ninguno (ya existían)");
  console.log("Grants nuevos:", grantsEnsured.join(", ") || "ninguno (ya existían)");

  const [check] = await c.query(`
    SELECT rr.\`key\` AS role, p.\`key\` AS perm
    FROM rbac_role_permissions rrp
    JOIN rbac_roles rr ON rr.id = rrp.role_id
    JOIN rbac_permissions p ON p.id = rrp.permission_id
    WHERE p.\`key\` LIKE 'fiscal.%' OR p.\`key\` LIKE 'stock.%' OR p.\`key\` LIKE 'cash.%' OR p.\`key\` LIKE 'settlements.%'
    ORDER BY p.\`key\`, rr.\`key\`
  `);
  console.log("[POST] grants reales:", JSON.stringify(check));

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
