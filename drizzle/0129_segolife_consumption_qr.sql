CREATE TABLE `qr_batches` (
  `id` int AUTO_INCREMENT NOT NULL,
  `venue_id` int NOT NULL,
  `product_id` int,
  `amount_cents` int,
  `quantity` int NOT NULL,
  `expires_at` timestamp,
  `created_by_user_id` int,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `qr_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consumption_qr_codes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `code_hash` varchar(64) NOT NULL,
  `venue_id` int NOT NULL,
  `product_id` int,
  `amount_cents` int,
  `quantity` int NOT NULL DEFAULT 1,
  `batch_id` int,
  `issued_at` timestamp NOT NULL DEFAULT (now()),
  `expires_at` timestamp,
  `status` enum('issued','redeemed','expired','cancelled') NOT NULL DEFAULT 'issued',
  `redeemed_at` timestamp,
  `redeemed_by_user_id` int,
  `ledger_id` int,
  `source_type` varchar(64) NOT NULL DEFAULT 'manual',
  `source_reference` varchar(128),
  `issued_by_user_id` int,
  `terminal_id` varchar(64),
  `cancelled_at` timestamp,
  `cancelled_by_user_id` int,
  `cancel_reason` varchar(256),
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `consumption_qr_codes_id` PRIMARY KEY(`id`),
  CONSTRAINT `consumption_qr_codes_code_hash_unique` UNIQUE(`code_hash`)
);
--> statement-breakpoint
CREATE TABLE `qr_redemption_attempts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `qr_id` int,
  `token_fingerprint` varchar(64),
  `user_id` int,
  `result` enum('success','already_redeemed','expired','cancelled','invalid_token','not_found','venue_inactive','product_inactive','community_not_authorized','outside_schedule','no_rule','rate_limited','error') NOT NULL,
  `ip_address` varchar(64),
  `user_agent` varchar(256),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `qr_redemption_attempts_id` PRIMARY KEY(`id`)
);
