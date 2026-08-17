-- PRE-16.16B: `hr.view` es el permission key que server/routers/hr.ts:45
-- (hrViewProc = permissionProcedure("hr.view", ["admin"])) usa para
-- proteger TODO el lado admin del módulo de Personal/RRHH (9 de sus 10
-- sub-routers: empleados, nóminas, remesas, fiscal, ajustes, bonus,
-- aprobación de vacaciones, fichajes admin). Nunca se insertó en
-- rbac_permissions (ni en 0070_rbac_permissions.sql ni en ningún seed
-- posterior) — confirmado en producción: el admin real (jorgemgrande@gmail.com)
-- ya tiene fila en rbac_user_roles («admin»), por lo que
-- checkRbacOrLegacy resuelve por permisos RBAC reales (nunca lanza,
-- así que el fallback a legacy ["admin"] no se activa nunca) y, al no
-- existir la clave "hr.view" en el catálogo, el resultado es
-- permission-denied incluso para el admin real. Efecto: /admin/personal/*
-- es hoy inaccesible en producción. Fix mínimo, mismo patrón exacto que
-- 0070_rbac_permissions.sql — solo INSERT IGNORE, aditivo, idempotente.

INSERT IGNORE INTO `rbac_permissions` (`key`, `module`, `action`, `description`) VALUES
  ('hr.view', 'hr', 'view', 'Ver y gestionar el módulo de Personal / RRHH');
--> statement-breakpoint

INSERT IGNORE INTO `rbac_role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id FROM `rbac_roles` r, `rbac_permissions` p
WHERE r.`key` = 'admin' AND p.`key` = 'hr.view';
