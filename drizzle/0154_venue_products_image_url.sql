-- SEGOLIFE FASE 12.5 (continuación) — imágenes de producto del Venue Bar POS
-- Puramente aditiva: 1 columna nullable en venue_products, mismo patrón que
-- venues.image_url (URL plana, sin FK a media_files). `pnpm drizzle-kit
-- generate` no pudo usarse (drift preexistente del journal, no relacionado
-- con este cambio, detectado al generar — pide desambiguar un rename de
-- admin_notification_dismissals que nunca se tocó aquí); migración escrita
-- a mano siguiendo el mismo patrón que el resto de migraciones aditivas de
-- esta serie.

ALTER TABLE `venue_products` ADD COLUMN `image_url` varchar(512) AFTER `is_active`;
