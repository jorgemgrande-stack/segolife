-- SEGOLIFE — REFERRAL & INVITE REWARDS ENGINE (Fase 8). Generada a mano —
-- drizzle-kit generate sigue detenido en el drift preexistente documentado
-- desde 0139.
--
-- Puramente aditiva: 2 tablas nuevas + 1 columna nullable en
-- student_profiles. Ninguna tabla existente cambia semántica. Sin backfill,
-- sin campaña por defecto, sin código de referido pre-generado para
-- estudiantes existentes (se genera bajo demanda, ver referralService.ts).

ALTER TABLE `student_profiles`
  ADD COLUMN `referral_code` varchar(16) DEFAULT NULL AFTER `status`,
  ADD UNIQUE KEY `student_profiles_referral_code_unique` (`referral_code`);
--> statement-breakpoint

CREATE TABLE `referral_campaigns` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(256) NOT NULL,
  `status` enum('draft','active','paused','ended','archived') NOT NULL DEFAULT 'draft',
  `community_id` int DEFAULT NULL,
  `inviter_reward_tokens` int NOT NULL,
  `invitee_reward_tokens` int NOT NULL,
  `conversion_condition` enum('account_created','verified_student','profile_completed','first_venue_visit','first_event_attendance') NOT NULL,
  `attribution_window_days` int NOT NULL DEFAULT 30,
  `max_rewards_per_inviter` int DEFAULT NULL,
  `max_total_conversions` int DEFAULT NULL,
  `budget_tokens` int DEFAULT NULL,
  `priority` int NOT NULL DEFAULT 0,
  `starts_at` timestamp NULL DEFAULT NULL,
  `ends_at` timestamp NULL DEFAULT NULL,
  `created_by_user_id` int DEFAULT NULL,
  `activated_at` timestamp NULL DEFAULT NULL,
  `activated_by_user_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `referral_campaigns_status_idx` (`status`),
  KEY `referral_campaigns_community_id_idx` (`community_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE `referrals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `referrer_user_id` int NOT NULL,
  `referred_user_id` int NOT NULL,
  `referral_code` varchar(16) NOT NULL,
  `campaign_id` int DEFAULT NULL,
  `community_id` int DEFAULT NULL,
  `status` enum('registered','converted','rewarded','ineligible','expired','cancelled') NOT NULL DEFAULT 'registered',
  `required_conversion_condition` enum('account_created','verified_student','profile_completed','first_venue_visit','first_event_attendance') DEFAULT NULL,
  `converted_via` enum('account_created','verified_student','profile_completed','first_venue_visit','first_event_attendance') DEFAULT NULL,
  `inviter_reward_tokens` int NOT NULL DEFAULT 0,
  `invitee_reward_tokens` int NOT NULL DEFAULT 0,
  `inviter_ledger_id` int DEFAULT NULL,
  `invitee_ledger_id` int DEFAULT NULL,
  `ineligible_reason` varchar(64) DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `registered_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `converted_at` timestamp NULL DEFAULT NULL,
  `rewarded_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `referrals_referred_user_id_unique` (`referred_user_id`),
  KEY `referrals_referrer_user_id_idx` (`referrer_user_id`),
  KEY `referrals_status_idx` (`status`),
  KEY `referrals_campaign_id_idx` (`campaign_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
