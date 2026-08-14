-- SEGOLIFE — Communication Center, Brevo Transactional Email &
-- Omnichannel Orchestration (spec §19-21). Generada a mano — drizzle-kit
-- generate sigue detenido en el mismo drift preexistente documentado desde
-- 0139-0144, no relacionado con este cambio.
--
-- Puramente aditiva:
--   1. notification_deliveries.opened_at/clicked_at — el webhook de Brevo
--      necesita persistir apertura/click sin forzar esos hechos dentro del
--      enum `status` (un email puede estar delivered Y abierto Y clicado a
--      la vez — no son estados mutuamente excluyentes).
--   2. email_suppressions (tabla nueva, aislada) — supresión TÉCNICA
--      (hard bounce/blocked/spam) distinta de notification_preferences
--      (opt-out de marketing por elección del Student, spec §21).
--
-- No modifica ninguna fila existente, ningún enum existente, ninguna tabla
-- de Fourvenues/SegoTokens/Benefits/Commerce/Community.

ALTER TABLE `notification_deliveries`
  ADD COLUMN `opened_at` timestamp NULL DEFAULT NULL AFTER `external_message_id`,
  ADD COLUMN `clicked_at` timestamp NULL DEFAULT NULL AFTER `opened_at`;

CREATE TABLE `email_suppressions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(320) NOT NULL,
  `reason` enum('hard_bounce','blocked','spam','manual') NOT NULL,
  `source` varchar(64) NOT NULL,
  `notes` varchar(512) DEFAULT NULL,
  `suppressed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email_suppressions_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
