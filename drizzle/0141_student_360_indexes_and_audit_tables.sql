-- STUDENT 360 (docs/students/student-360-audit-and-architecture.md) — migración
-- aditiva, no destructiva. Generada a mano porque `drizzle-kit generate` se
-- detiene en un prompt interactivo de reconciliación por drift preexistente
-- del journal (no relacionado con este cambio: la tabla
-- admin_notification_dismissals y probablemente otras ya existen en local vía
-- `drizzle-kit push` sin haber sido nunca registradas en drizzle/meta/_journal.json
-- — drift heredado, fuera de alcance de esta tarea, NO se toca aquí).
--
-- Contenido: 4 índices no-únicos sobre user_id (ticket_orders, event_tickets,
-- event_attendance, commerce_transactions) — ninguna de las 4 tenía índice
-- sobre esa columna, confirmado por auditoría; necesarios para que las nuevas
-- consultas "todo lo de este estudiante" no hagan table scan. Más 2 tablas
-- nuevas: student_login_events (histórico mínimo de login, sin IP/user-agent/
-- fingerprint, empieza a registrar desde esta fase, nunca retroactivo) y
-- student_admin_actions (audit trail mínimo — SegoTokens y Benefits ya tienen
-- el suyo propio vía token_ledger/user_benefits, esta tabla solo cubre el
-- hueco real: cambios de student_profiles.status).
--
-- NO aplicada a producción hasta autorización explícita de cierre.

ALTER TABLE `ticket_orders` ADD INDEX `ticket_orders_user_id_idx` (`user_id`);
ALTER TABLE `event_tickets` ADD INDEX `event_tickets_user_id_idx` (`user_id`);
ALTER TABLE `event_attendance` ADD INDEX `event_attendance_user_id_idx` (`user_id`);
ALTER TABLE `commerce_transactions` ADD INDEX `commerce_transactions_user_id_idx` (`user_id`);

CREATE TABLE `student_login_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `occurred_at` timestamp NOT NULL DEFAULT (now()),
  `method` varchar(32) NOT NULL DEFAULT 'password',
  CONSTRAINT `student_login_events_id` PRIMARY KEY(`id`)
);
ALTER TABLE `student_login_events` ADD INDEX `student_login_events_user_id_idx` (`user_id`);

CREATE TABLE `student_admin_actions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `student_profile_id` int NOT NULL,
  `actor_user_id` int NOT NULL,
  `action` varchar(64) NOT NULL,
  `before_value` varchar(256),
  `after_value` varchar(256),
  `reason` varchar(512),
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `student_admin_actions_id` PRIMARY KEY(`id`)
);
ALTER TABLE `student_admin_actions` ADD INDEX `student_admin_actions_student_profile_id_idx` (`student_profile_id`);
