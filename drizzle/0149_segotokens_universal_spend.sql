-- SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND & MIXED PAYMENTS (Fase 7). Generada
-- a mano — drizzle-kit generate sigue detenido en el drift preexistente
-- documentado desde 0139.
--
-- Puramente aditiva: 2 tablas nuevas + 1 columna nullable en
-- commerce_transactions. Ninguna tabla existente cambia semántica.
-- token_wallets/token_ledger NO se tocan — el motor nuevo reutiliza
-- postLedgerMovementInTx sin ningún cambio de esquema en el ledger.

CREATE TABLE `token_redemption_policies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(256) NOT NULL,
  `description` text,
  `active` boolean NOT NULL DEFAULT true,
  `community_id` int DEFAULT NULL,
  `venue_id` int DEFAULT NULL,
  `event_id` int DEFAULT NULL,
  `tokens_per_unit` int NOT NULL DEFAULT 1,
  `value_cents_per_unit` int NOT NULL,
  `min_token_spend` int DEFAULT NULL,
  `max_token_spend` int DEFAULT NULL,
  `max_percentage` int DEFAULT NULL,
  `allow_full_token_payment` boolean NOT NULL DEFAULT false,
  `starts_at` timestamp NULL DEFAULT NULL,
  `ends_at` timestamp NULL DEFAULT NULL,
  `priority` int NOT NULL DEFAULT 0,
  `created_by_user_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `token_redemption_policies_active_idx` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `token_spend_reservations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `wallet_id` int NOT NULL,
  `policy_id` int DEFAULT NULL,
  `venue_id` int DEFAULT NULL,
  `event_id` int DEFAULT NULL,
  `community_id` int DEFAULT NULL,
  `reference_type` varchar(64) NOT NULL,
  `reference_id` int DEFAULT NULL,
  `gross_amount_cents` int NOT NULL,
  `tokens_reserved` int NOT NULL,
  `promotional_value_cents` int NOT NULL,
  `money_due_cents` int NOT NULL,
  `status` enum('reserved','captured','released','expired','reversed') NOT NULL DEFAULT 'reserved',
  `idempotency_key` varchar(191) NOT NULL,
  `ledger_id` int DEFAULT NULL,
  `reversal_ledger_id` int DEFAULT NULL,
  `expires_at` timestamp NOT NULL,
  `created_by_user_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `captured_at` timestamp NULL DEFAULT NULL,
  `released_at` timestamp NULL DEFAULT NULL,
  `reversed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_spend_reservations_idempotency_key_unique` (`idempotency_key`),
  KEY `token_spend_reservations_user_id_idx` (`user_id`),
  KEY `token_spend_reservations_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

ALTER TABLE `commerce_transactions`
  ADD COLUMN `token_reservation_id` int DEFAULT NULL AFTER `loyalty_ledger_id`;
