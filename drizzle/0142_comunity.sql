-- COMUNITY (docs/comunity/architecture.md) — migración aditiva, no
-- destructiva. Generada a mano (mismo motivo que 0141: drizzle-kit generate
-- se detiene en un prompt interactivo de reconciliación por drift
-- preexistente del journal, no relacionado con este cambio).
--
-- Contenido: 2 columnas nuevas en `events` (source_type/source_id, ambas
-- nullable) + 7 tablas nuevas del dominio COMUNITY.
--
-- NO aplicada a producción hasta autorización explícita de cierre.

ALTER TABLE `events` ADD COLUMN `source_type` varchar(64) DEFAULT NULL;
ALTER TABLE `events` ADD COLUMN `source_id` int DEFAULT NULL;

CREATE TABLE `community_proposals` (
  `id` int AUTO_INCREMENT NOT NULL,
  `title` varchar(256) NOT NULL,
  `description` text,
  `question_type` enum('single_choice','yes_no','percentage_scale','scale_1_5','multiselect','ranking','attendance_intention','me_apunto','open_text') NOT NULL,
  `status` enum('draft','scheduled','active','closed','cancelled','converted') NOT NULL DEFAULT 'draft',
  `urgency_type` enum('flash','scheduled') NOT NULL DEFAULT 'scheduled',
  `starts_at` timestamp NULL,
  `ends_at` timestamp NULL,
  `results_visibility` enum('immediate','after_vote','after_close','never') NOT NULL DEFAULT 'after_vote',
  `allow_change_response` boolean NOT NULL DEFAULT true,
  `token_reward` int DEFAULT NULL,
  `cover_image_url` varchar(512) DEFAULT NULL,
  `venue_id` int DEFAULT NULL,
  `related_event_id` int DEFAULT NULL,
  `converted_event_id` int DEFAULT NULL,
  `source_student_proposal_id` int DEFAULT NULL,
  `audience_definition` json DEFAULT NULL,
  `audience_snapshot_at` timestamp NULL,
  `min_sample_size` int NOT NULL DEFAULT 5,
  `created_by_user_id` int NOT NULL,
  `published_at` timestamp NULL,
  `closed_at` timestamp NULL,
  `cancelled_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `community_proposals_id` PRIMARY KEY(`id`)
);
ALTER TABLE `community_proposals` ADD INDEX `community_proposals_status_idx` (`status`);
ALTER TABLE `community_proposals` ADD INDEX `community_proposals_starts_at_idx` (`starts_at`);
ALTER TABLE `community_proposals` ADD INDEX `community_proposals_ends_at_idx` (`ends_at`);
ALTER TABLE `community_proposals` ADD INDEX `community_proposals_venue_id_idx` (`venue_id`);
ALTER TABLE `community_proposals` ADD INDEX `community_proposals_source_student_proposal_idx` (`source_student_proposal_id`);

CREATE TABLE `community_proposal_communities` (
  `id` int AUTO_INCREMENT NOT NULL,
  `proposal_id` int NOT NULL,
  `community_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `community_proposal_communities_id` PRIMARY KEY(`id`),
  CONSTRAINT `community_proposal_communities_unique` UNIQUE(`proposal_id`,`community_id`)
);

CREATE TABLE `community_options` (
  `id` int AUTO_INCREMENT NOT NULL,
  `proposal_id` int NOT NULL,
  `label` varchar(256) NOT NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  `is_positive_intent` boolean NOT NULL DEFAULT false,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `community_options_id` PRIMARY KEY(`id`)
);
ALTER TABLE `community_options` ADD INDEX `community_options_proposal_id_idx` (`proposal_id`);

CREATE TABLE `community_proposal_audiences` (
  `id` int AUTO_INCREMENT NOT NULL,
  `proposal_id` int NOT NULL,
  `user_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `community_proposal_audiences_id` PRIMARY KEY(`id`),
  CONSTRAINT `community_proposal_audiences_unique` UNIQUE(`proposal_id`,`user_id`)
);
ALTER TABLE `community_proposal_audiences` ADD INDEX `community_proposal_audiences_user_id_idx` (`user_id`);

CREATE TABLE `community_responses` (
  `id` int AUTO_INCREMENT NOT NULL,
  `proposal_id` int NOT NULL,
  `user_id` int NOT NULL,
  `responded_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `reward_granted` boolean NOT NULL DEFAULT false,
  `token_ledger_id` int DEFAULT NULL,
  CONSTRAINT `community_responses_id` PRIMARY KEY(`id`),
  CONSTRAINT `community_responses_unique` UNIQUE(`proposal_id`,`user_id`)
);
ALTER TABLE `community_responses` ADD INDEX `community_responses_user_id_idx` (`user_id`);

CREATE TABLE `community_response_values` (
  `id` int AUTO_INCREMENT NOT NULL,
  `response_id` int NOT NULL,
  `option_id` int DEFAULT NULL,
  `value_text` text,
  `value_number` int DEFAULT NULL,
  `is_hidden` boolean NOT NULL DEFAULT false,
  `is_featured` boolean NOT NULL DEFAULT false,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `community_response_values_id` PRIMARY KEY(`id`)
);
ALTER TABLE `community_response_values` ADD INDEX `community_response_values_response_id_idx` (`response_id`);
ALTER TABLE `community_response_values` ADD INDEX `community_response_values_option_id_idx` (`option_id`);

CREATE TABLE `community_student_proposals` (
  `id` int AUTO_INCREMENT NOT NULL,
  `student_user_id` int NOT NULL,
  `community_id` int NOT NULL,
  `title` varchar(256) NOT NULL,
  `description` text,
  `venue_id` int DEFAULT NULL,
  `suggested_date` date DEFAULT NULL,
  `category` varchar(64) DEFAULT NULL,
  `status` enum('pending_moderation','approved','rejected','scheduled','active','closed','converted') NOT NULL DEFAULT 'pending_moderation',
  `rejection_reason_internal` varchar(512) DEFAULT NULL,
  `rejection_reason_student` varchar(512) DEFAULT NULL,
  `moderated_by_user_id` int DEFAULT NULL,
  `moderated_at` timestamp NULL,
  `converted_proposal_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `community_student_proposals_id` PRIMARY KEY(`id`)
);
ALTER TABLE `community_student_proposals` ADD INDEX `community_student_proposals_status_idx` (`status`);
ALTER TABLE `community_student_proposals` ADD INDEX `community_student_proposals_student_user_id_idx` (`student_user_id`);
ALTER TABLE `community_student_proposals` ADD INDEX `community_student_proposals_community_id_idx` (`community_id`);

CREATE TABLE `community_supports` (
  `id` int AUTO_INCREMENT NOT NULL,
  `student_proposal_id` int NOT NULL,
  `user_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `community_supports_id` PRIMARY KEY(`id`),
  CONSTRAINT `community_supports_unique` UNIQUE(`student_proposal_id`,`user_id`)
);
ALTER TABLE `community_supports` ADD INDEX `community_supports_user_id_idx` (`user_id`);
