-- SEGOLIFE — COMMERCE CORE, SALES, POS, ORDERS & EVENT OPERATIONS (Fase 9).
-- Generada a mano — drizzle-kit generate sigue detenido en el drift
-- preexistente documentado desde 0139.
--
-- Puramente aditiva y deliberadamente MÍNIMA (spec §89/§90, auditoría
-- previa): NO se crean tablas orders/order_items genéricas — event_tickets
-- Ya es un modelo de pedido maduro (máquina de estados, aforo con locking
-- real, emisión con QR) y "venta de puerta" se modela reutilizándolo
-- (un event_ticket_type marcado is_door_entry=true, confirmado por staff en
-- vez de por PaymentProvider). Solo 8 columnas nuevas en 4 tablas existentes
-- + 1 tabla nueva de auditoría de reembolsos (commerce_refunds, genérica
-- para ambos dominios). Ninguna tabla existente cambia semántica ni pierde
-- datos; el ensanche del enum de status es aditivo (nunca se quita ningún
-- valor ya usado en producción).

ALTER TABLE `event_ticket_types`
  ADD COLUMN `is_door_entry` boolean NOT NULL DEFAULT false AFTER `status`;
--> statement-breakpoint

ALTER TABLE `ticket_orders`
  ADD COLUMN `channel` enum('online','door') DEFAULT NULL AFTER `idempotency_key`,
  ADD COLUMN `operator_user_id` int DEFAULT NULL AFTER `channel`,
  ADD COLUMN `payment_method` varchar(32) DEFAULT NULL AFTER `operator_user_id`,
  ADD COLUMN `token_reservation_id` int DEFAULT NULL AFTER `payment_method`;
--> statement-breakpoint

ALTER TABLE `commerce_transactions`
  MODIFY COLUMN `status` enum('pending','confirmed','cancelled','refunded','partially_refunded','reconciliation_required') NOT NULL DEFAULT 'pending',
  ADD COLUMN `operator_user_id` int DEFAULT NULL AFTER `token_reservation_id`,
  ADD COLUMN `refunded_amount_cents` int NOT NULL DEFAULT 0 AFTER `operator_user_id`;
--> statement-breakpoint

ALTER TABLE `commerce_transaction_items`
  ADD COLUMN `refunded_quantity` int NOT NULL DEFAULT 0 AFTER `total_amount_cents`;
--> statement-breakpoint

CREATE TABLE `commerce_refunds` (
  `id` int NOT NULL AUTO_INCREMENT,
  `source_type` enum('commerce_transaction','ticket_order') NOT NULL,
  `source_id` int NOT NULL,
  `venue_id` int DEFAULT NULL,
  `event_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `amount_cents` int NOT NULL,
  `tokens_restored` int NOT NULL DEFAULT 0,
  `money_refund_status` enum('completed','provider_unavailable') NOT NULL,
  `reason` varchar(500) NOT NULL,
  `partial` boolean NOT NULL DEFAULT false,
  `refunded_by_user_id` int NOT NULL,
  `idempotency_key` varchar(191) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `commerce_refunds_idempotency_key_unique` (`idempotency_key`),
  KEY `commerce_refunds_source_idx` (`source_type`, `source_id`),
  KEY `commerce_refunds_created_at_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
