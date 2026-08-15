-- SEGOLIFE FASE 10.5 — SEGOTOKENS ECONOMY CONTROL CENTER
-- Puramente aditiva: 1 tabla nueva (registro de auditoría de cambios de
-- configuración económica). token_rules/token_campaigns/
-- token_redemption_policies/referral_campaigns NO se modifican en su
-- estructura — esta fase solo actualiza VALORES de filas existentes (ver
-- scripts/apply-segotokens-economy-v1.cjs) e inserta filas nuevas donde no
-- existía ninguna configuración (redemption policy global, referral campaign).

CREATE TABLE `economy_config_changes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `entity_type` enum('token_rule','redemption_policy','campaign','referral_campaign') NOT NULL,
  `entity_id` int NOT NULL,
  `field_name` varchar(64) NOT NULL,
  `old_value` varchar(256),
  `new_value` varchar(256),
  `reason` varchar(500),
  `actor_user_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `economy_config_changes_entity_idx` (`entity_type`, `entity_id`),
  KEY `economy_config_changes_created_at_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
