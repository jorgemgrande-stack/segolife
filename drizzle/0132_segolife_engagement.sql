CREATE TABLE `notifications` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `community_id` int,
  `type` varchar(64) NOT NULL,
  `category` enum('events','rewards','benefits','promotions','account') NOT NULL,
  `audience_type` enum('transactional','marketing') NOT NULL,
  `title_en` varchar(256) NOT NULL,
  `title_es` varchar(256) NOT NULL,
  `body_en` text NOT NULL,
  `body_es` text NOT NULL,
  `deep_link` varchar(512),
  `image_url` varchar(512),
  `status` enum('active','archived') NOT NULL DEFAULT 'active',
  `priority` enum('low','normal','high') NOT NULL DEFAULT 'normal',
  `template_key` varchar(128),
  `template_version` int,
  `source_type` varchar(64),
  `source_id` int,
  `campaign_id` int,
  `idempotency_key` varchar(191),
  `read_at` timestamp,
  `clicked_at` timestamp,
  `expires_at` timestamp,
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
  CONSTRAINT `notifications_idempotency_key_unique` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `notification_id` int NOT NULL,
  `channel` enum('in_app','email','push','whatsapp') NOT NULL,
  `provider` varchar(32),
  `status` enum('pending','sent','delivered','failed','skipped','cancelled') NOT NULL DEFAULT 'pending',
  `attempt_count` int NOT NULL DEFAULT 0,
  `max_attempts` int NOT NULL DEFAULT 3,
  `scheduled_at` timestamp NOT NULL,
  `sent_at` timestamp,
  `delivered_at` timestamp,
  `failed_at` timestamp,
  `last_error` varchar(512),
  `external_message_id` varchar(191),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `notification_deliveries_id` PRIMARY KEY(`id`),
  CONSTRAINT `notification_deliveries_notification_channel_unique` UNIQUE(`notification_id`,`channel`)
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `category` enum('events','rewards','benefits','promotions','account') NOT NULL,
  `channel` enum('in_app','email','push','whatsapp') NOT NULL,
  `enabled` boolean NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `notification_preferences_id` PRIMARY KEY(`id`),
  CONSTRAINT `notification_preferences_unique` UNIQUE(`user_id`,`category`,`channel`)
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `endpoint` varchar(512) NOT NULL,
  `keys_p256dh` varchar(256),
  `keys_auth` varchar(256),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `revoked_at` timestamp,
  CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`),
  CONSTRAINT `push_subscriptions_endpoint_unique` UNIQUE(`endpoint`)
);
--> statement-breakpoint
CREATE TABLE `engagement_campaigns` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(256) NOT NULL,
  `type` enum('manual','scheduled','triggered') NOT NULL,
  `status` enum('draft','scheduled','running','completed','cancelled') NOT NULL DEFAULT 'draft',
  `community_id` int,
  `audience_definition` json NOT NULL,
  `trigger_event_type` varchar(64),
  `scheduled_at` timestamp,
  `audience_snapshot_at` timestamp,
  `started_at` timestamp,
  `completed_at` timestamp,
  `cancelled_at` timestamp,
  `cancelled_by_user_id` int,
  `created_by_user_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `engagement_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `engagement_campaign_audiences` (
  `id` int AUTO_INCREMENT NOT NULL,
  `campaign_id` int NOT NULL,
  `user_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `engagement_campaign_audiences_id` PRIMARY KEY(`id`),
  CONSTRAINT `engagement_campaign_audiences_unique` UNIQUE(`campaign_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `engagement_campaign_messages` (
  `id` int AUTO_INCREMENT NOT NULL,
  `campaign_id` int NOT NULL,
  `channel` enum('in_app','email','push','whatsapp') NOT NULL,
  `category` enum('events','rewards','benefits','promotions','account') NOT NULL,
  `title_en` varchar(256) NOT NULL,
  `title_es` varchar(256) NOT NULL,
  `body_en` text NOT NULL,
  `body_es` text NOT NULL,
  `deep_link` varchar(512),
  `image_url` varchar(512),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `engagement_campaign_messages_id` PRIMARY KEY(`id`),
  CONSTRAINT `engagement_campaign_messages_campaign_channel_unique` UNIQUE(`campaign_id`,`channel`)
);
