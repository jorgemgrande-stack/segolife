CREATE TABLE `token_wallets` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `balance` int NOT NULL DEFAULT 0,
  `lifetime_earned` int NOT NULL DEFAULT 0,
  `lifetime_spent` int NOT NULL DEFAULT 0,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `token_wallets_id` PRIMARY KEY(`id`),
  CONSTRAINT `token_wallets_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `token_ledger` (
  `id` int AUTO_INCREMENT NOT NULL,
  `wallet_id` int NOT NULL,
  `user_id` int NOT NULL,
  `direction` enum('credit','debit') NOT NULL,
  `amount` int NOT NULL,
  `balance_after` int NOT NULL,
  `reason` varchar(256) NOT NULL,
  `source_type` varchar(64) NOT NULL,
  `source_id` int,
  `venue_id` int,
  `event_id` int,
  `rule_id` int,
  `campaign_id` int,
  `idempotency_key` varchar(191),
  `metadata` json,
  `created_by_user_id` int,
  `reversed_ledger_id` int,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `token_ledger_id` PRIMARY KEY(`id`),
  CONSTRAINT `token_ledger_idempotency_key_unique` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `venue_products` (
  `id` int AUTO_INCREMENT NOT NULL,
  `venue_id` int NOT NULL,
  `name` varchar(256) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `category` varchar(64),
  `price` decimal(10,2),
  `is_active` boolean NOT NULL DEFAULT true,
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `venue_products_id` PRIMARY KEY(`id`),
  CONSTRAINT `venue_products_venue_slug_unique` UNIQUE(`venue_id`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `token_rules` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(256) NOT NULL,
  `description` text,
  `direction` enum('earn','spend') NOT NULL,
  `origin` enum('attendance','event','ticket','purchase','consumption','product','manual','recurrence','campaign') NOT NULL,
  `scope` enum('global','community','venue','event','product') NOT NULL DEFAULT 'global',
  `scope_community_id` int,
  `scope_venue_id` int,
  `scope_event_id` int,
  `scope_product_id` int,
  `calc_method` enum('fixed','per_euro','percentage','multiplier') NOT NULL DEFAULT 'fixed',
  `fixed_amount` int,
  `rate` decimal(10,4),
  `multiplier` decimal(6,2),
  `min_spend` decimal(10,2),
  `max_tokens` int,
  `daily_limit` int,
  `monthly_limit` int,
  `recurrence_window` enum('day','week','month'),
  `recurrence_threshold` int,
  `recurrence_mode` enum('visit_count','distinct_venues'),
  `starts_at` timestamp,
  `ends_at` timestamp,
  `active` boolean NOT NULL DEFAULT true,
  `priority` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `token_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `token_campaigns` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(256) NOT NULL,
  `description` text,
  `multiplier` decimal(6,2),
  `bonus_tokens` int,
  `starts_at` timestamp,
  `ends_at` timestamp,
  `active` boolean NOT NULL DEFAULT true,
  `priority` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `token_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campaign_communities` (
  `id` int AUTO_INCREMENT NOT NULL,
  `campaign_id` int NOT NULL,
  `community_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `campaign_communities_id` PRIMARY KEY(`id`),
  CONSTRAINT `campaign_communities_unique` UNIQUE(`campaign_id`,`community_id`)
);
--> statement-breakpoint
CREATE TABLE `campaign_venues` (
  `id` int AUTO_INCREMENT NOT NULL,
  `campaign_id` int NOT NULL,
  `venue_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `campaign_venues_id` PRIMARY KEY(`id`),
  CONSTRAINT `campaign_venues_unique` UNIQUE(`campaign_id`,`venue_id`)
);
--> statement-breakpoint
CREATE TABLE `campaign_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `campaign_id` int NOT NULL,
  `event_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `campaign_events_id` PRIMARY KEY(`id`),
  CONSTRAINT `campaign_events_unique` UNIQUE(`campaign_id`,`event_id`)
);
--> statement-breakpoint
CREATE TABLE `venue_token_schedules` (
  `id` int AUTO_INCREMENT NOT NULL,
  `venue_id` int NOT NULL,
  `operation_type` enum('earn','spend') NOT NULL,
  `day_of_week` int NOT NULL,
  `start_time` varchar(5) NOT NULL,
  `end_time` varchar(5) NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `timezone` varchar(64) NOT NULL DEFAULT 'Europe/Madrid',
  `valid_from` varchar(10),
  `valid_to` varchar(10),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `venue_token_schedules_id` PRIMARY KEY(`id`)
);
