CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`worker_id` text,
	`ts` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `learned_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text,
	`cmd` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`worker_id` text,
	`ts` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pty_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`worker_id` text NOT NULL,
	`ts` integer NOT NULL,
	`seq` integer NOT NULL,
	`bytes` blob NOT NULL,
	FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workers` (
	`id` text PRIMARY KEY NOT NULL,
	`cli` text NOT NULL,
	`cwd` text NOT NULL,
	`pid` integer,
	`pgid` integer,
	`state` text DEFAULT 'idle' NOT NULL,
	`env_mode` text DEFAULT 'no-worktree' NOT NULL,
	`created_at` integer NOT NULL,
	`exited_at` integer,
	`exit_code` integer
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pty_chunks_worker_seq` ON `pty_chunks` (`worker_id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_events_worker_ts` ON `events` (`worker_id`,`ts`);
