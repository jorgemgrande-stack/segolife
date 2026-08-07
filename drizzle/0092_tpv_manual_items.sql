ALTER TABLE `tpv_sale_items`
  ADD COLUMN `is_manual` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN `concept_text` varchar(500) DEFAULT NULL;
