CREATE TABLE `heartbeats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`monitor_id` text NOT NULL,
	`status` text NOT NULL,
	`status_code` integer,
	`response_ms` integer,
	`message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_heartbeats_monitor_time` ON `heartbeats` (`monitor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`cause` text,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_incidents_monitor` ON `incidents` (`monitor_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`name` text,
	`method` text DEFAULT 'GET' NOT NULL,
	`interval_sec` integer DEFAULT 60 NOT NULL,
	`timeout_ms` integer DEFAULT 5000 NOT NULL,
	`retries` integer DEFAULT 2 NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`last_check_at` integer,
	`last_response_ms` integer,
	`is_public` integer DEFAULT 1 NOT NULL,
	`is_paused` integer DEFAULT 0 NOT NULL,
	`muted_until` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_monitors_user` ON `monitors` (`user_id`);--> statement-breakpoint
CREATE TABLE `ssl_info` (
	`monitor_id` text PRIMARY KEY NOT NULL,
	`issuer` text,
	`valid_from` integer,
	`valid_to` integer,
	`days_remaining` integer,
	`checked_at` integer,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_id` text,
	`email` text,
	`plan` text DEFAULT 'free' NOT NULL,
	`status_slug` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_id_unique` ON `users` (`telegram_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_status_slug_unique` ON `users` (`status_slug`);