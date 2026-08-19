-- MG-03B — Profile Photo Activity. Migración aditiva, no destructiva.
-- Generada a mano — mismo motivo que 0141_student_360_indexes_and_audit_tables.sql
-- (`drizzle-kit generate` se detiene en un prompt interactivo por drift
-- preexistente del journal, no relacionado con este cambio).
--
-- Tabla nueva mínima, mismo patrón exacto que student_login_events: solo
-- registra la ACCIÓN (added/updated/removed), nunca la imagen/URL/path de
-- storage — describe el hecho, no almacena una copia de la foto. Empieza a
-- registrar desde esta fase, nunca se fabrica histórico retroactivo.

CREATE TABLE `student_photo_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `occurred_at` timestamp NOT NULL DEFAULT (now()),
  `action` enum('added','updated','removed') NOT NULL,
  CONSTRAINT `student_photo_events_id` PRIMARY KEY(`id`)
);
ALTER TABLE `student_photo_events` ADD INDEX `student_photo_events_user_id_idx` (`user_id`);
