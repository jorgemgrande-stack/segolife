-- ─── Añadir 'controler' al ENUM role de users ────────────────────────────────
ALTER TABLE `users`
  MODIFY COLUMN `role` enum('user','admin','monitor','agente','adminrest','controler')
  NOT NULL DEFAULT 'user';
--> statement-breakpoint

-- ─── Nuevo permiso: Centro de Control Diario ─────────────────────────────────
INSERT IGNORE INTO `rbac_permissions` (`key`, `module`, `action`, `description`) VALUES
  ('accounting.daily_control', 'accounting', 'daily_control', 'Acceso al Centro de Control Diario');
--> statement-breakpoint

-- ─── Nuevo rol: controler ─────────────────────────────────────────────────────
INSERT IGNORE INTO `rbac_roles` (`key`, `name`, `description`, `is_legacy`, `is_active`, `sort_order`) VALUES
  ('controler', 'Controler', 'Acceso exclusivo al Centro de Control Diario de contabilidad', true, true, 20);
--> statement-breakpoint

-- ─── Permiso accounting.daily_control → controler ────────────────────────────
INSERT IGNORE INTO `rbac_role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id FROM `rbac_roles` r
  JOIN `rbac_permissions` p ON p.`key` = 'accounting.daily_control'
WHERE r.`key` = 'controler';
--> statement-breakpoint

-- ─── Permiso accounting.daily_control → admin (todos los permisos) ───────────
INSERT IGNORE INTO `rbac_role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id FROM `rbac_roles` r
  JOIN `rbac_permissions` p ON p.`key` = 'accounting.daily_control'
WHERE r.`key` = 'admin';
