-- MG-04 — Community Proposals 2.0. Migración aditiva, no destructiva.
-- Generada a mano — mismo motivo que 0141/0157 (`drizzle-kit generate` se
-- detiene en un prompt interactivo por drift preexistente del journal).
--
-- cover_image_url: URL pública ya subida vía storagePut() (nunca la imagen
-- en sí). urgency: preferencia/urgencia del Student, 3 niveles simples,
-- NUNCA la prioridad administrativa interna (concepto distinto, tabla
-- distinta — community_proposals.urgencyType no se toca).

ALTER TABLE `community_student_proposals` ADD COLUMN `cover_image_url` varchar(512);
ALTER TABLE `community_student_proposals` ADD COLUMN `urgency` enum('no_rush','soon','urgent');
