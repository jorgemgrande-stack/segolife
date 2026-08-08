CREATE TABLE `sales_channels` (
  `id` int AUTO_INCREMENT NOT NULL,
  `event_id` int NOT NULL,
  `channel_type` enum('fourvenues','weezevent','segolife_native','manual','partner') NOT NULL,
  `sales_mode` enum('external_redirect','external_checkout','native') NOT NULL,
  `external_url` varchar(1024),
  `integration_type` enum('venue_integration','event_integration'),
  `integration_id` int,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `is_primary` boolean NOT NULL DEFAULT false,
  `sort_order` int NOT NULL DEFAULT 0,
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `sales_channels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `event_ticket_types` (
  `id` int AUTO_INCREMENT NOT NULL,
  `event_id` int NOT NULL,
  `name` varchar(256) NOT NULL,
  `description` text,
  `price_cents` int NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `capacity` int,
  `sales_start` timestamp,
  `sales_end` timestamp,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `event_ticket_types_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ticket_orders` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int,
  `event_id` int NOT NULL,
  `sales_channel_id` int,
  `provider` varchar(32),
  `external_order_id` varchar(128),
  `external_payment_id` varchar(128),
  `status` enum('pending','paid','cancelled','refunded','failed') NOT NULL DEFAULT 'pending',
  `subtotal_cents` int NOT NULL DEFAULT 0,
  `fees_cents` int NOT NULL DEFAULT 0,
  `total_cents` int NOT NULL DEFAULT 0,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `buyer_name` varchar(256),
  `buyer_email` varchar(320),
  `buyer_phone` varchar(32),
  `purchased_at` timestamp,
  `idempotency_key` varchar(191),
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `ticket_orders_id` PRIMARY KEY(`id`),
  CONSTRAINT `ticket_orders_idempotency_key_unique` UNIQUE(`idempotency_key`),
  CONSTRAINT `ticket_orders_provider_external_unique` UNIQUE(`provider`,`external_order_id`)
);
--> statement-breakpoint
CREATE TABLE `ticket_order_items` (
  `id` int AUTO_INCREMENT NOT NULL,
  `order_id` int NOT NULL,
  `ticket_type_id` int,
  `quantity` int NOT NULL,
  `unit_price_cents` int NOT NULL,
  `total_price_cents` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `ticket_order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `event_tickets` (
  `id` int AUTO_INCREMENT NOT NULL,
  `event_id` int NOT NULL,
  `ticket_type_id` int,
  `order_id` int,
  `user_id` int,
  `sales_channel` enum('native','external') NOT NULL,
  `provider` varchar(32),
  `external_ticket_id` varchar(128),
  `external_participant_id` varchar(128),
  `status` enum('issued','cancelled','refunded','used') NOT NULL DEFAULT 'issued',
  `qr_token` varchar(64),
  `qr_token_hash` varchar(64),
  `issued_at` timestamp,
  `cancelled_at` timestamp,
  `refunded_at` timestamp,
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `event_tickets_id` PRIMARY KEY(`id`),
  CONSTRAINT `event_tickets_provider_external_unique` UNIQUE(`provider`,`external_ticket_id`)
);
--> statement-breakpoint
CREATE TABLE `event_attendance` (
  `id` int AUTO_INCREMENT NOT NULL,
  `event_id` int NOT NULL,
  `ticket_id` int,
  `user_id` int NOT NULL,
  `venue_id` int,
  `provider` varchar(32) NOT NULL,
  `integration_type` enum('venue_integration','event_integration'),
  `integration_id` int,
  `external_attendance_id` varchar(128),
  `occurred_at` timestamp NOT NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `tokens_ledger_id` int,
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `event_attendance_id` PRIMARY KEY(`id`),
  CONSTRAINT `event_attendance_idempotency_key_unique` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `integration_providers` (
  `id` int AUTO_INCREMENT NOT NULL,
  `key` varchar(32) NOT NULL,
  `name` varchar(128) NOT NULL,
  `capabilities` json NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `integration_providers_id` PRIMARY KEY(`id`),
  CONSTRAINT `integration_providers_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `venue_integrations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `venue_id` int NOT NULL,
  `provider_id` int NOT NULL,
  `external_account_id` varchar(128),
  `external_venue_id` varchar(128),
  `environment` enum('sandbox','production') NOT NULL DEFAULT 'sandbox',
  `enabled` boolean NOT NULL DEFAULT false,
  `status` enum('not_configured','configured','connected','error','disabled') NOT NULL DEFAULT 'not_configured',
  `capabilities` json,
  `credentials_encrypted` text,
  `credentials_last4` varchar(8),
  `sync_enabled` boolean NOT NULL DEFAULT false,
  `sync_interval_minutes` int,
  `last_sync_at` timestamp,
  `last_success_at` timestamp,
  `last_error_at` timestamp,
  `last_error_message` varchar(512),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `venue_integrations_id` PRIMARY KEY(`id`),
  CONSTRAINT `venue_integrations_venue_provider_unique` UNIQUE(`venue_id`,`provider_id`)
);
--> statement-breakpoint
CREATE TABLE `event_integrations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `event_id` int NOT NULL,
  `provider_id` int NOT NULL,
  `external_event_id` varchar(128),
  `environment` enum('sandbox','production') NOT NULL DEFAULT 'sandbox',
  `enabled` boolean NOT NULL DEFAULT false,
  `status` enum('not_configured','configured','connected','error','disabled') NOT NULL DEFAULT 'not_configured',
  `capabilities` json,
  `credentials_encrypted` text,
  `credentials_last4` varchar(8),
  `sync_enabled` boolean NOT NULL DEFAULT false,
  `sync_interval_minutes` int,
  `last_sync_at` timestamp,
  `last_success_at` timestamp,
  `last_error_at` timestamp,
  `last_error_message` varchar(512),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `event_integrations_id` PRIMARY KEY(`id`),
  CONSTRAINT `event_integrations_event_provider_unique` UNIQUE(`event_id`,`provider_id`)
);
--> statement-breakpoint
CREATE TABLE `external_entity_mappings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `provider` varchar(32) NOT NULL,
  `integration_type` enum('venue_integration','event_integration') NOT NULL,
  `integration_id` int NOT NULL,
  `external_type` varchar(32) NOT NULL,
  `external_id` varchar(128) NOT NULL,
  `internal_type` varchar(32) NOT NULL,
  `internal_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `external_entity_mappings_id` PRIMARY KEY(`id`),
  CONSTRAINT `external_entity_mappings_unique` UNIQUE(`provider`,`external_type`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `integration_sync_runs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `integration_type` enum('venue_integration','event_integration') NOT NULL,
  `integration_id` int NOT NULL,
  `sync_type` enum('full','incremental') NOT NULL,
  `status` enum('running','success','partial','failed') NOT NULL DEFAULT 'running',
  `fetched_count` int NOT NULL DEFAULT 0,
  `created_count` int NOT NULL DEFAULT 0,
  `updated_count` int NOT NULL DEFAULT 0,
  `unresolved_count` int NOT NULL DEFAULT 0,
  `failed_count` int NOT NULL DEFAULT 0,
  `error_message` varchar(512),
  `started_at` timestamp NOT NULL DEFAULT (now()),
  `finished_at` timestamp,
  CONSTRAINT `integration_sync_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integration_sync_state` (
  `id` int AUTO_INCREMENT NOT NULL,
  `integration_type` enum('venue_integration','event_integration') NOT NULL,
  `integration_id` int NOT NULL,
  `cursor` varchar(256),
  `updated_since` timestamp,
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `integration_sync_state_id` PRIMARY KEY(`id`),
  CONSTRAINT `integration_sync_state_unique` UNIQUE(`integration_type`,`integration_id`)
);
--> statement-breakpoint
CREATE TABLE `external_identity_mappings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `provider` varchar(32) NOT NULL,
  `external_customer_id` varchar(128),
  `buyer_email` varchar(320),
  `buyer_phone` varchar(32),
  `participant_email` varchar(320),
  `participant_phone` varchar(32),
  `name` varchar(256),
  `user_id` int NOT NULL,
  `resolution_method` enum('previous_mapping','participant_email','participant_phone','buyer_email','manual') NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `external_identity_mappings_id` PRIMARY KEY(`id`),
  CONSTRAINT `external_identity_mappings_provider_customer_unique` UNIQUE(`provider`,`external_customer_id`)
);
--> statement-breakpoint
CREATE TABLE `unresolved_operations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `operation_type` enum('attendance','commerce','order') NOT NULL,
  `provider` varchar(32) NOT NULL,
  `integration_type` enum('venue_integration','event_integration'),
  `integration_id` int,
  `reference_type` varchar(32),
  `reference_id` int,
  `external_reference_id` varchar(128),
  `event_id` int,
  `venue_id` int,
  `occurred_at` timestamp,
  `identity_hint_email` varchar(320),
  `identity_hint_phone` varchar(32),
  `identity_hint_name` varchar(256),
  `amount_cents` int,
  `status` enum('unresolved','linked','ignored','conflict') NOT NULL DEFAULT 'unresolved',
  `linked_user_id` int,
  `linked_by_user_id` int,
  `linked_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `unresolved_operations_id` PRIMARY KEY(`id`),
  CONSTRAINT `unresolved_operations_external_reference_unique` UNIQUE(`provider`,`operation_type`,`external_reference_id`)
);
--> statement-breakpoint
CREATE TABLE `commerce_transactions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int,
  `venue_id` int NOT NULL,
  `event_id` int,
  `provider` varchar(32) NOT NULL,
  `integration_type` enum('venue_integration','event_integration'),
  `integration_id` int,
  `sales_channel_id` int,
  `external_transaction_id` varchar(128),
  `status` enum('pending','confirmed','cancelled','refunded','reconciliation_required') NOT NULL DEFAULT 'pending',
  `subtotal_cents` int NOT NULL DEFAULT 0,
  `fees_cents` int NOT NULL DEFAULT 0,
  `total_cents` int NOT NULL DEFAULT 0,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `payment_method` varchar(32),
  `occurred_at` timestamp NOT NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `loyalty_processed_at` timestamp,
  `loyalty_ledger_id` int,
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commerce_transactions_id` PRIMARY KEY(`id`),
  CONSTRAINT `commerce_transactions_idempotency_key_unique` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `commerce_transaction_items` (
  `id` int AUTO_INCREMENT NOT NULL,
  `transaction_id` int NOT NULL,
  `venue_product_id` int,
  `external_product_id` varchar(128),
  `description` varchar(256) NOT NULL,
  `quantity` int NOT NULL DEFAULT 1,
  `unit_amount_cents` int NOT NULL,
  `total_amount_cents` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `commerce_transaction_items_id` PRIMARY KEY(`id`)
);
