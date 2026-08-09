INSERT IGNORE INTO `system_settings` (`key`, `value`, `value_type`, `category`, `label`, `description`, `is_sensitive`, `is_public`) VALUES
  ('segolife_brand_name', 'SEGOLIFE', 'string', 'branding', 'Nombre de marca SEGOLIFE', 'Nombre de marca mostrado en el panel admin y pantallas del producto SEGOLIFE — separado a propósito de "brand_name" (heredado de Náyade, aún usado por email/facturas legacy).', false, true),
  ('segolife_brand_logo_url', '/icons/segolife-icon.svg', 'string', 'branding', 'Logo SEGOLIFE', 'Logo mostrado en el panel admin y pantallas del producto SEGOLIFE — separado a propósito de "brand_logo_url" (heredado de Náyade).', false, true);
--> statement-breakpoint

-- El mensaje de mantenimiento (MaintenanceNotice.tsx) envuelve TODA la app,
-- incluidas las rutas /ie /uva de Segolife — si algún día se activa el modo
-- mantenimiento con el texto heredado sin editar, un estudiante vería
-- "Náyade Experiences"/"Hotel Náyade" en pantalla completa. Es solo texto
-- operativo pensado para editarse desde /admin/configuracion (no identidad
-- de negocio requerida por código heredado), así que se sustituye por un
-- valor neutro — nunca se toca si un admin ya lo personalizó (WHERE guard).
UPDATE `system_settings`
SET `value` = 'Aviso importante\n\nServicio temporalmente no disponible\n\nEstamos realizando tareas de mantenimiento. Vuelve a intentarlo en unos minutos.\n\nGracias por tu paciencia.'
WHERE `key` = 'site_maintenance_message' AND `value` LIKE '%Náyade%';
