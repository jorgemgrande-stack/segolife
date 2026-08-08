ALTER TABLE `quotes` ADD `activity_date` varchar(20);--> statement-breakpoint
ALTER TABLE `reservations` ADD `cancellation_request_id` int;--> statement-breakpoint
ALTER TABLE `spa_schedule_templates` ADD `slotIntervalMinutes` int NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `users` ADD `supplierId` int;
