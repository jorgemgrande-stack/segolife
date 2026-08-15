-- SEGOLIFE — VENUE & PARTNER APP (spec §10/§11/§42). Generada a mano —
-- drizzle-kit generate sigue detenido en el mismo drift preexistente
-- documentado desde 0139-0146.
--
-- Puramente aditiva: tabla nueva, ninguna existente se modifica.
-- event_attendance NO se toca (eventId sigue NOT NULL, sin cambios) —
-- venue_visits es un hecho canónico SEPARADO para "Student estuvo en un
-- venue sin ningún evento vigente", mutuamente excluyente con
-- event_attendance por construcción en el código, no por constraint de BD.

CREATE TABLE `venue_visits` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `venue_id` int NOT NULL,
  `event_attendance_id` int DEFAULT NULL,
  `occurred_at` timestamp NOT NULL,
  `operational_date` varchar(10) NOT NULL,
  `source` varchar(32) NOT NULL,
  `operator_user_id` int DEFAULT NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `venue_visits_idempotency_key_unique` (`idempotency_key`),
  KEY `venue_visits_user_id_idx` (`user_id`),
  KEY `venue_visits_venue_id_idx` (`venue_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
