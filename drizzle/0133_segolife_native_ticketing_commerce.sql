ALTER TABLE `ticket_orders` MODIFY COLUMN `status` enum('pending','awaiting_payment','paid','cancelled','expired','refunded','partially_refunded','failed','reconciliation_required') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `ticket_orders` ADD `expires_at` timestamp;--> statement-breakpoint
ALTER TABLE `ticket_orders` ADD `cancelled_at` timestamp;--> statement-breakpoint
ALTER TABLE `ticket_orders` ADD `refunded_at` timestamp;--> statement-breakpoint
CREATE TABLE `ticket_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`provider` varchar(32) NOT NULL,
	`external_payment_id` varchar(128),
	`amount_cents` int NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`status` enum('pending','succeeded','failed','refunded') NOT NULL DEFAULT 'pending',
	`idempotency_key` varchar(191) NOT NULL,
	`failure_reason` varchar(256),
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ticket_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `ticket_payments_idempotency_key_unique` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `student_identity_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`token` varchar(64) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`rotated_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `student_identity_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `student_identity_tokens_user_id_unique` UNIQUE(`user_id`),
	CONSTRAINT `student_identity_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
