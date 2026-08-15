-- SEGOLIFE FASE 10 — FISCAL, INVOICING, STOCK & VENUE SETTLEMENTS
-- Puramente aditiva: 8 tablas nuevas + columnas nuevas en venue_products y
-- event_ticket_types. Ninguna tabla existente pierde datos ni cambia
-- semántica de valores ya existentes. Ninguna tabla legacy de Náyade
-- (invoices, document_counters, tpv_sales, etc.) se toca.

CREATE TABLE `commercial_entities` (
  `id` int AUTO_INCREMENT NOT NULL,
  `legal_name` varchar(256) NOT NULL,
  `trade_name` varchar(256),
  `tax_id` varchar(32) NOT NULL,
  `country` varchar(2) NOT NULL DEFAULT 'ES',
  `fiscal_address` varchar(512),
  `email` varchar(256),
  `active` boolean NOT NULL DEFAULT true,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `venue_seller_config` (
  `id` int AUTO_INCREMENT NOT NULL,
  `venue_id` int NOT NULL,
  `seller_entity_id` int NOT NULL,
  `collector_entity_id` int,
  `active` boolean NOT NULL DEFAULT true,
  `updated_by_user_id` int,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `venue_seller_config_venue_id_unique` (`venue_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `tax_rates` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(128) NOT NULL,
  `rate_basis_points` int NOT NULL,
  `country` varchar(2) NOT NULL DEFAULT 'ES',
  `active` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `fiscal_transaction_snapshots` (
  `id` int AUTO_INCREMENT NOT NULL,
  `source_type` enum('commerce_transaction','ticket_order') NOT NULL,
  `source_id` int NOT NULL,
  `venue_id` int,
  `event_id` int,
  `seller_entity_id` int,
  `seller_legal_name` varchar(256),
  `seller_tax_id` varchar(32),
  `collector_entity_id` int,
  `buyer_user_id` int,
  `occurred_at` timestamp NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `gross_amount_cents` int NOT NULL,
  `promotional_value_cents` int NOT NULL DEFAULT 0,
  `money_due_cents` int NOT NULL DEFAULT 0,
  `tax_rate_basis_points` int,
  `tax_base_cents` int,
  `tax_amount_cents` int,
  `items_snapshot` json,
  `payment_method` varchar(32),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fiscal_snapshots_source_unique` (`source_type`, `source_id`),
  KEY `fiscal_snapshots_venue_idx` (`venue_id`),
  KEY `fiscal_snapshots_occurred_at_idx` (`occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `billing_profiles` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `legal_name` varchar(256) NOT NULL,
  `tax_id` varchar(32) NOT NULL,
  `address` varchar(512),
  `country` varchar(2) NOT NULL DEFAULT 'ES',
  `email` varchar(256),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `billing_profiles_user_id_unique` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `invoice_series` (
  `id` int AUTO_INCREMENT NOT NULL,
  `seller_entity_id` int NOT NULL,
  `document_type` enum('invoice','credit_note') NOT NULL,
  `code` varchar(16) NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `invoice_series_entity_type_code_unique` (`seller_entity_id`, `document_type`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `fiscal_document_counters` (
  `id` int AUTO_INCREMENT NOT NULL,
  `series_id` int NOT NULL,
  `year` int NOT NULL,
  `current_number` int NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fiscal_document_counters_series_year_unique` (`series_id`, `year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `fiscal_documents` (
  `id` int AUTO_INCREMENT NOT NULL,
  `document_type` enum('invoice','credit_note') NOT NULL,
  `series_id` int NOT NULL,
  `document_number` varchar(32) NOT NULL,
  `seller_entity_id` int NOT NULL,
  `buyer_billing_profile_id` int,
  `buyer_user_id` int,
  `fiscal_snapshot_id` int,
  `original_document_id` int,
  `issue_date` timestamp NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `tax_base_cents` int NOT NULL,
  `tax_amount_cents` int NOT NULL,
  `total_cents` int NOT NULL,
  `pdf_key` varchar(256),
  `reason` varchar(500),
  `issued_by_user_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fiscal_documents_number_unique` (`document_number`),
  KEY `fiscal_documents_snapshot_idx` (`fiscal_snapshot_id`),
  KEY `fiscal_documents_buyer_user_idx` (`buyer_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `fiscal_document_lines` (
  `id` int AUTO_INCREMENT NOT NULL,
  `document_id` int NOT NULL,
  `description` varchar(256) NOT NULL,
  `quantity` int NOT NULL DEFAULT 1,
  `unit_amount_cents` int NOT NULL,
  `total_amount_cents` int NOT NULL,
  `tax_rate_basis_points` int NOT NULL,
  `tax_base_cents` int NOT NULL,
  `tax_amount_cents` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fiscal_document_lines_document_idx` (`document_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `inventory_movements` (
  `id` int AUTO_INCREMENT NOT NULL,
  `venue_product_id` int NOT NULL,
  `venue_id` int NOT NULL,
  `type` enum('opening','purchase','sale','refund','adjustment_in','adjustment_out','waste','transfer_in','transfer_out') NOT NULL,
  `delta_quantity` int NOT NULL,
  `balance_after` int NOT NULL,
  `reference_type` varchar(32),
  `reference_id` int,
  `reason` varchar(500),
  `actor_user_id` int,
  `idempotency_key` varchar(191),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inventory_movements_idempotency_key_unique` (`idempotency_key`),
  KEY `inventory_movements_product_idx` (`venue_product_id`),
  KEY `inventory_movements_venue_idx` (`venue_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `venue_cash_sessions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `venue_id` int NOT NULL,
  `opened_by_user_id` int NOT NULL,
  `opened_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `opening_cash_cents` int NOT NULL DEFAULT 0,
  `closed_by_user_id` int,
  `closed_at` timestamp,
  `expected_cash_cents` int,
  `counted_cash_cents` int,
  `difference_cents` int,
  `status` enum('open','closed') NOT NULL DEFAULT 'open',
  `notes` varchar(500),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `venue_cash_sessions_venue_idx` (`venue_id`),
  KEY `venue_cash_sessions_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `venue_cash_movements` (
  `id` int AUTO_INCREMENT NOT NULL,
  `cash_session_id` int NOT NULL,
  `type` enum('cash_in','cash_out') NOT NULL,
  `amount_cents` int NOT NULL,
  `reason` varchar(500) NOT NULL,
  `actor_user_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `venue_cash_movements_session_idx` (`cash_session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `commercial_agreements` (
  `id` int AUTO_INCREMENT NOT NULL,
  `venue_id` int NOT NULL,
  `event_id` int,
  `commission_model` enum('platform_commission_percent','fixed_fee','venue_net','no_commission') NOT NULL DEFAULT 'no_commission',
  `commission_basis_points` int NOT NULL DEFAULT 0,
  `fixed_fee_cents` int NOT NULL DEFAULT 0,
  `token_funding_model` enum('venue_funded','platform_funded','shared','no_settlement_value') NOT NULL DEFAULT 'no_settlement_value',
  `benefit_funding_model` enum('venue_funded','platform_funded','shared','no_settlement_value') NOT NULL DEFAULT 'no_settlement_value',
  `active` boolean NOT NULL DEFAULT true,
  `created_by_user_id` int,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `commercial_agreements_venue_idx` (`venue_id`),
  KEY `commercial_agreements_event_idx` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `settlements` (
  `id` int AUTO_INCREMENT NOT NULL,
  `venue_id` int NOT NULL,
  `event_id` int,
  `period_start` timestamp NOT NULL,
  `period_end` timestamp NOT NULL,
  `status` enum('draft','calculated','approved','paid','cancelled') NOT NULL DEFAULT 'draft',
  `seller_entity_id` int,
  `collector_entity_id` int,
  `commission_model` varchar(32),
  `commission_basis_points` int NOT NULL DEFAULT 0,
  `fixed_fee_cents` int NOT NULL DEFAULT 0,
  `token_funding_model` varchar(32),
  `benefit_funding_model` varchar(32),
  `gross_sales_cents` int NOT NULL DEFAULT 0,
  `refunds_cents` int NOT NULL DEFAULT 0,
  `net_sales_cents` int NOT NULL DEFAULT 0,
  `commission_cents` int NOT NULL DEFAULT 0,
  `token_subsidy_cents` int NOT NULL DEFAULT 0,
  `benefit_subsidy_cents` int NOT NULL DEFAULT 0,
  `net_payable_to_venue_cents` int NOT NULL DEFAULT 0,
  `calculated_at` timestamp,
  `approved_at` timestamp,
  `approved_by_user_id` int,
  `paid_at` timestamp,
  `paid_by_user_id` int,
  `notes` varchar(500),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `settlements_venue_idx` (`venue_id`),
  KEY `settlements_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `venue_settlement_lines` (
  `id` int AUTO_INCREMENT NOT NULL,
  `settlement_id` int NOT NULL,
  `source_type` enum('commerce_transaction','ticket_order','commerce_refund') NOT NULL,
  `source_id` int NOT NULL,
  `gross_amount_cents` int NOT NULL,
  `commission_cents` int NOT NULL DEFAULT 0,
  `net_cents` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `venue_settlement_lines_settlement_idx` (`settlement_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

ALTER TABLE `venue_products`
  ADD COLUMN `tax_rate_id` int AFTER `metadata`,
  ADD COLUMN `stock_tracked` boolean NOT NULL DEFAULT false AFTER `tax_rate_id`,
  ADD COLUMN `current_stock_cached` int AFTER `stock_tracked`,
  ADD COLUMN `low_stock_threshold` int AFTER `current_stock_cached`,
  ADD COLUMN `allow_negative_stock` boolean NOT NULL DEFAULT false AFTER `low_stock_threshold`;
--> statement-breakpoint

ALTER TABLE `event_ticket_types`
  ADD COLUMN `tax_rate_id` int AFTER `is_door_entry`;
