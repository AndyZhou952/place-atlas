CREATE TABLE `visit_media` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`item_id` text NOT NULL,
	`object_key` text NOT NULL,
	`original_filename` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`content_sha256` text NOT NULL,
	`caption` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_visit_media_object_key` ON `visit_media` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_visit_media_visit_order` ON `visit_media` (`visit_id`,`display_order`);--> statement-breakpoint
CREATE INDEX `idx_visit_media_item_created` ON `visit_media` (`item_id`,`created_at`);