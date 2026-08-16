-- SEGOLIFE — PRE-16.1: PRESENTIAL SEGOTOKENS PAYMENTS (Venue TPV + Door
-- Ticketing). Generada a mano — drizzle-kit generate sigue detenido en el
-- drift preexistente documentado desde 0139 (ver 0151).
--
-- Tabla nueva ÚNICA (mínima, aditiva): token_payment_requests. Envuelve una
-- fila de token_spend_reservations (ya existente, Fase 7) con el estado de
-- autorización del Student — nunca duplica venue/student/operador/montos,
-- todos se leen vía token_reservation_id. No se toca ninguna tabla existente
-- ni el ciclo de vida propio de token_spend_reservations.

CREATE TABLE `token_payment_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `token_reservation_id` int NOT NULL,
  `status` enum('pending','confirmed','rejected','expired','cancelled','settled') NOT NULL DEFAULT 'pending',
  `idempotency_key` varchar(191) NOT NULL,
  `order_context_type` enum('pos','door') NOT NULL,
  `settled_order_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `responded_at` timestamp NULL DEFAULT NULL,
  `settled_at` timestamp NULL DEFAULT NULL,
  `cancelled_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_payment_requests_idempotency_key_unique` (`idempotency_key`),
  KEY `token_payment_requests_reservation_idx` (`token_reservation_id`),
  KEY `token_payment_requests_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
