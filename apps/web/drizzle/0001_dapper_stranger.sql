CREATE TABLE `atlas_item_tombstones` (
	`item_id` text PRIMARY KEY NOT NULL,
	`deleted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `place_assessments` (
	`item_id` text PRIMARY KEY NOT NULL,
	`overall_rating` real,
	`is_favorite` integer DEFAULT false NOT NULL,
	`has_visited` integer DEFAULT false NOT NULL,
	`summary` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`item_title` text NOT NULL,
	`visited_at` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_visits_item_visited` ON `visits` (`item_id`,`visited_at`);