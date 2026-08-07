ALTER TABLE `cancellation_requests`
  ADD COLUMN `cancellation_scope` VARCHAR(10) NOT NULL DEFAULT 'total' AFTER `cancellation_number`,
  ADD COLUMN `cancelled_items_json` TEXT NULL AFTER `cancellation_scope`;
