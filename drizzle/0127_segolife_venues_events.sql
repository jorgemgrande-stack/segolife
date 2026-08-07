CREATE TABLE `venue_categories` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(64) NOT NULL,
  `slug` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `venue_categories_id` PRIMARY KEY(`id`),
  CONSTRAINT `venue_categories_name_unique` UNIQUE(`name`),
  CONSTRAINT `venue_categories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `venues` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(256) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `description` text,
  `category_id` int,
  `address` varchar(256),
  `city` varchar(128) NOT NULL DEFAULT 'Segovia',
  `phone` varchar(32),
  `email` varchar(256),
  `website` varchar(256),
  `image_url` varchar(512),
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `venues_id` PRIMARY KEY(`id`),
  CONSTRAINT `venues_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `community_venues` (
  `id` int AUTO_INCREMENT NOT NULL,
  `community_id` int NOT NULL,
  `venue_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `community_venues_id` PRIMARY KEY(`id`),
  CONSTRAINT `community_venues_unique` UNIQUE(`community_id`,`venue_id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(256) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `description` text,
  `venue_id` int,
  `starts_at` timestamp NOT NULL,
  `ends_at` timestamp,
  `capacity` int,
  `image_url` varchar(512),
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `is_featured` boolean NOT NULL DEFAULT false,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `events_id` PRIMARY KEY(`id`),
  CONSTRAINT `events_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `community_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `community_id` int NOT NULL,
  `event_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `community_events_id` PRIMARY KEY(`id`),
  CONSTRAINT `community_events_unique` UNIQUE(`community_id`,`event_id`)
);
