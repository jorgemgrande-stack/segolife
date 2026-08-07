CREATE TABLE `universities` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(256) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `email_domain` varchar(128),
  `country` varchar(2) NOT NULL DEFAULT 'ES',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `universities_id` PRIMARY KEY(`id`),
  CONSTRAINT `universities_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `communities` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(256) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `default_locale` varchar(8) NOT NULL DEFAULT 'es',
  `available_locales` json NOT NULL DEFAULT (_utf8mb4'["es"]'),
  `status` enum('active','inactive','onboarding') NOT NULL DEFAULT 'onboarding',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `communities_id` PRIMARY KEY(`id`),
  CONSTRAINT `communities_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `community_universities` (
  `id` int AUTO_INCREMENT NOT NULL,
  `community_id` int NOT NULL,
  `university_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `community_universities_id` PRIMARY KEY(`id`),
  CONSTRAINT `community_universities_unique` UNIQUE(`community_id`,`university_id`)
);
--> statement-breakpoint
CREATE TABLE `user_communities` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `community_id` int NOT NULL,
  `role_in_community` varchar(64),
  `joined_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `user_communities_id` PRIMARY KEY(`id`),
  CONSTRAINT `user_communities_user_community_unique` UNIQUE(`user_id`,`community_id`)
);
