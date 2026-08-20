-- FIX-06 — Admin Events Operational Controls. Migración aditiva, no
-- destructiva. Generada a mano — mismo motivo que 0157/0158
-- (`drizzle-kit generate` se detiene en un prompt interactivo por drift
-- preexistente del journal).
--
-- is_hidden: visibilidad LOCAL de Segolife, dimensión propia y distinta de
-- `status` (lifecycle admin-curado) y `source_publication_status` (lo que
-- dice el proveedor externo, p.ej. Fourvenues). Ver comentario de schema.ts.

ALTER TABLE `events` ADD COLUMN `is_hidden` boolean NOT NULL DEFAULT false AFTER `source_publication_status`;
