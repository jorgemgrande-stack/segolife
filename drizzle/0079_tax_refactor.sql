-- ─── 0079: Refactor fiscal — separar fiscalRegime de taxRate ────────────────
-- Nuevo modelo: fiscalRegime = "general" | "reav" | "mixed"
--               taxRate = número independiente (21, 10, ...)
-- "general_21" queda obsoleto; coerción lazy en backend para datos legacy.

-- ─── 1. ENUM: experiences ────────────────────────────────────────────────────
SET @col_exists_tax1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'experiences' AND COLUMN_NAME = 'taxRate');
--> statement-breakpoint
SET @add_col_sql_tax1 = IF(@col_exists_tax1 = 0, 'ALTER TABLE `experiences` ADD COLUMN `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 21.00', 'SELECT 1 AS skipped');
--> statement-breakpoint
PREPARE _add_col_tax1 FROM @add_col_sql_tax1;
--> statement-breakpoint
EXECUTE _add_col_tax1;
--> statement-breakpoint
DEALLOCATE PREPARE _add_col_tax1;
--> statement-breakpoint
ALTER TABLE `experiences` MODIFY COLUMN `fiscalRegime` ENUM('reav','general','mixed') NOT NULL DEFAULT 'general';
--> statement-breakpoint
UPDATE `experiences` SET `fiscalRegime` = 'general' WHERE `fiscalRegime` = 'general_21';
--> statement-breakpoint

-- ─── 2. ENUM: packs ──────────────────────────────────────────────────────────
SET @col_exists_tax2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'packs' AND COLUMN_NAME = 'taxRate');
--> statement-breakpoint
SET @add_col_sql_tax2 = IF(@col_exists_tax2 = 0, 'ALTER TABLE `packs` ADD COLUMN `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 21.00', 'SELECT 1 AS skipped');
--> statement-breakpoint
PREPARE _add_col_tax2 FROM @add_col_sql_tax2;
--> statement-breakpoint
EXECUTE _add_col_tax2;
--> statement-breakpoint
DEALLOCATE PREPARE _add_col_tax2;
--> statement-breakpoint
ALTER TABLE `packs` MODIFY COLUMN `fiscalRegime` ENUM('reav','general','mixed') NOT NULL DEFAULT 'general';
--> statement-breakpoint
UPDATE `packs` SET `fiscalRegime` = 'general' WHERE `fiscalRegime` = 'general_21';
--> statement-breakpoint

-- ─── 3. ENUM: room_types ─────────────────────────────────────────────────────
SET @col_exists_tax3 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_types' AND COLUMN_NAME = 'taxRate');
--> statement-breakpoint
SET @add_col_sql_tax3 = IF(@col_exists_tax3 = 0, 'ALTER TABLE `room_types` ADD COLUMN `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 21.00', 'SELECT 1 AS skipped');
--> statement-breakpoint
PREPARE _add_col_tax3 FROM @add_col_sql_tax3;
--> statement-breakpoint
EXECUTE _add_col_tax3;
--> statement-breakpoint
DEALLOCATE PREPARE _add_col_tax3;
--> statement-breakpoint
ALTER TABLE `room_types` MODIFY COLUMN `fiscalRegime` ENUM('reav','general','mixed') NOT NULL DEFAULT 'general';
--> statement-breakpoint
UPDATE `room_types` SET `fiscalRegime` = 'general' WHERE `fiscalRegime` = 'general_21';
--> statement-breakpoint

-- ─── 4. ENUM: spa_treatments ─────────────────────────────────────────────────
SET @col_exists_tax4 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'spa_treatments' AND COLUMN_NAME = 'taxRate');
--> statement-breakpoint
SET @add_col_sql_tax4 = IF(@col_exists_tax4 = 0, 'ALTER TABLE `spa_treatments` ADD COLUMN `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 21.00', 'SELECT 1 AS skipped');
--> statement-breakpoint
PREPARE _add_col_tax4 FROM @add_col_sql_tax4;
--> statement-breakpoint
EXECUTE _add_col_tax4;
--> statement-breakpoint
DEALLOCATE PREPARE _add_col_tax4;
--> statement-breakpoint
ALTER TABLE `spa_treatments` MODIFY COLUMN `fiscalRegime` ENUM('reav','general','mixed') NOT NULL DEFAULT 'general';
--> statement-breakpoint
UPDATE `spa_treatments` SET `fiscalRegime` = 'general' WHERE `fiscalRegime` = 'general_21';
--> statement-breakpoint

-- ─── 5. ENUM: tpv_sale_items (columna fiscalRegime_tsi) ──────────────────────
ALTER TABLE `tpv_sale_items`
  MODIFY COLUMN `fiscalRegime_tsi` ENUM('reav','general','mixed') DEFAULT 'general';
--> statement-breakpoint
UPDATE `tpv_sale_items` SET `fiscalRegime_tsi` = 'general' WHERE `fiscalRegime_tsi` = 'general_21';
--> statement-breakpoint

-- ─── 6. ENUM + taxRate: transactions (columna fiscalRegime_tx) ───────────────
SET @col_exists_tax5 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'taxRate_tx');
--> statement-breakpoint
SET @add_col_sql_tax5 = IF(@col_exists_tax5 = 0, 'ALTER TABLE `transactions` ADD COLUMN `taxRate_tx` DECIMAL(5,2) DEFAULT 21.00', 'SELECT 1 AS skipped');
--> statement-breakpoint
PREPARE _add_col_tax5 FROM @add_col_sql_tax5;
--> statement-breakpoint
EXECUTE _add_col_tax5;
--> statement-breakpoint
DEALLOCATE PREPARE _add_col_tax5;
--> statement-breakpoint
ALTER TABLE `transactions` MODIFY COLUMN `fiscalRegime_tx` ENUM('reav','general','mixed') DEFAULT 'general';
--> statement-breakpoint
UPDATE `transactions` SET `fiscalRegime_tx` = 'general' WHERE `fiscalRegime_tx` = 'general_21';
--> statement-breakpoint
UPDATE `transactions` SET `taxRate_tx` = 21 WHERE `taxRate_tx` IS NULL AND `fiscalRegime_tx` = 'general';
--> statement-breakpoint

-- ─── 7. taxBreakdown JSON en invoices ────────────────────────────────────────
-- taxRate se conserva para retrocompatibilidad con facturas antiguas.
SET @col_exists_tax6 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'taxBreakdown');
--> statement-breakpoint
SET @add_col_sql_tax6 = IF(@col_exists_tax6 = 0, 'ALTER TABLE `invoices` ADD COLUMN `taxBreakdown` JSON NULL', 'SELECT 1 AS skipped');
--> statement-breakpoint
PREPARE _add_col_tax6 FROM @add_col_sql_tax6;
--> statement-breakpoint
EXECUTE _add_col_tax6;
--> statement-breakpoint
DEALLOCATE PREPARE _add_col_tax6;
