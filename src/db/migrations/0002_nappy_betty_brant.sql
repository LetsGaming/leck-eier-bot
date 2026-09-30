CREATE TABLE `pending_voice_channel_moves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`due_at` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pending_voice_channel_moves_due` ON `pending_voice_channel_moves` (`due_at`);