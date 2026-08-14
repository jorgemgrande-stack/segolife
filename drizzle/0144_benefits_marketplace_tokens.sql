-- SEGOLIFE — Benefits Marketplace & SegoTokens Redemption (spec §6/§67).
-- Generada a mano — drizzle-kit generate sigue detenido en el mismo drift
-- preexistente documentado en 0139-0143, no relacionado con este cambio.
--
-- Puramente aditiva sobre `benefit_definitions`, sin tocar ninguna fila
-- existente: todas las columnas son NULL-por-defecto salvo
-- `is_marketplace_enabled`, que nace en `false` para TODA definición ya
-- existente (automática) — así ningún Benefit histórico se vuelve
-- comprable con SegoTokens por accidente. `is_marketplace_enabled=true` es
-- un flag EXPLÍCITO, comprobado siempre junto con `token_cost > 0`
-- (benefitPurchaseService.ts) — nunca se infiere de `token_cost` por sí
-- solo, para que una columna nullable futura no pueda "activar" el
-- marketplace de un Benefit automático sin decisión explícita.
--
-- No modifica `user_benefits` (ya tenía todo lo necesario: qrToken,
-- idempotencyKey, sourceType libre — el nuevo origen "token_purchase" no
-- requiere columna nueva, ver benefitsDb.ts::TOKEN_PURCHASE_SOURCE_TYPE),
-- ni ninguna tabla de Fourvenues/Native Ticketing/Community/Loyalty.

ALTER TABLE `benefit_definitions`
  ADD COLUMN `token_cost` int DEFAULT NULL AFTER `terms_es`,
  ADD COLUMN `is_marketplace_enabled` boolean NOT NULL DEFAULT false AFTER `token_cost`,
  ADD COLUMN `marketplace_inventory_total` int DEFAULT NULL AFTER `is_marketplace_enabled`,
  ADD COLUMN `per_student_purchase_limit` int DEFAULT NULL AFTER `marketplace_inventory_total`,
  ADD COLUMN `purchase_window_start` timestamp NULL DEFAULT NULL AFTER `per_student_purchase_limit`,
  ADD COLUMN `purchase_window_end` timestamp NULL DEFAULT NULL AFTER `purchase_window_start`,
  ADD COLUMN `redemption_validity_days` int DEFAULT NULL AFTER `purchase_window_end`;
