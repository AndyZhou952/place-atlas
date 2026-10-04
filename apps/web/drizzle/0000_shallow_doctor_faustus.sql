CREATE TABLE `atlas_item_overrides` (
	`item_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`personal_state` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `atlas_items` (
	`id` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`verification_status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_items_verification_status` ON `atlas_items` (`verification_status`);--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_ref` text NOT NULL,
	`creator_name` text NOT NULL,
	`platform` text NOT NULL,
	`status` text NOT NULL,
	`discovered_count` integer DEFAULT 0 NOT NULL,
	`needs_review_count` integer DEFAULT 0 NOT NULL,
	`message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_import_jobs_status_created_at` ON `import_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`item_title` text NOT NULL,
	`visited_at` text NOT NULL,
	`rating` real NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_journal_entries_item_visited` ON `journal_entries` (`item_id`,`visited_at`);--> statement-breakpoint
PRAGMA optimize;
