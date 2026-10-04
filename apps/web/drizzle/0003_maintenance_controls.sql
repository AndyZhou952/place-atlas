CREATE TABLE `maintenance_control` (
	`id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
	`mode` text NOT NULL,
	`maintenance_id` text,
	`writer_generation` text NOT NULL,
	`write_revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `maintenance_control` (`id`, `mode`, `maintenance_id`, `writer_generation`, `write_revision`)
VALUES (1, 'normal', NULL, 'unattested', 0);
--> statement-breakpoint
CREATE TABLE `maintenance_write_leases` (
	`lease_id` text PRIMARY KEY NOT NULL,
	`maintenance_id` text,
	`operation_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`started_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`resolution` text
);
--> statement-breakpoint
CREATE INDEX `idx_maintenance_write_leases_expiry` ON `maintenance_write_leases` (`expires_at`);--> statement-breakpoint
CREATE TABLE `maintenance_confirmations` (
	`confirmation_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`maintenance_id` text NOT NULL,
	`action` text NOT NULL,
	`evidence_digest` text NOT NULL,
	`target_digest` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_maintenance_confirmations_expiry` ON `maintenance_confirmations` (`expires_at`);--> statement-breakpoint
CREATE TABLE `maintenance_restore_runs` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`maintenance_id` text NOT NULL,
	`phase` text NOT NULL,
	`target_digest` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_restore_chunks` (
	`operation_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`chunk_bytes` blob NOT NULL,
	`chunk_digest` text NOT NULL,
	`sealed_at` text,
	PRIMARY KEY (`operation_id`, `chunk_index`)
);
