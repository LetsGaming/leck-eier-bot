CREATE TABLE `birthday_anchor_messages` (
	`position` integer PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`months` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `birthdays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`mention` text NOT NULL,
	`user_id` text,
	`name` text,
	`source` text DEFAULT 'list' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_birthdays_user` ON `birthdays` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_birthdays_date` ON `birthdays` (`date`);--> statement-breakpoint
CREATE TABLE `command_registration_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`definitions_hash` text,
	CONSTRAINT "command_registration_state_id_singleton" CHECK(id = 1)
);
--> statement-breakpoint
CREATE TABLE `command_settings` (
	`name` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`guild_only` integer DEFAULT 1 NOT NULL,
	`permission_gate` text
);
--> statement-breakpoint
CREATE TABLE `dashboard_access_overrides` (
	`feature_key` text PRIMARY KEY NOT NULL,
	`gate_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashboard_api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by_username` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_api_tokens_token_hash_unique` ON `dashboard_api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `dashboard_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`role` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status_code` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dashboard_audit_log_at` ON `dashboard_audit_log` (`at`);--> statement-breakpoint
CREATE TABLE `dashboard_temporary_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` text NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`granted_by_username` text NOT NULL,
	`granted_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_dashboard_temporary_grants_user` ON `dashboard_temporary_grants` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `dashboard_user_overrides` (
	`user_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`role` text,
	`note` text,
	`set_by_user_id` text NOT NULL,
	`set_by_username` text NOT NULL,
	`set_at` text NOT NULL,
	CONSTRAINT "dashboard_user_overrides_mode_check" CHECK(mode IN ('grant', 'block'))
);
--> statement-breakpoint
CREATE TABLE `event_signups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`raw_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`choice` text NOT NULL,
	`user_id` text,
	`match_source` text NOT NULL,
	`withdrawn_at` text,
	`attendance_status` text,
	`first_joined_at` text,
	`last_left_at` text,
	`late_minutes` integer,
	`early_minutes` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_event_signups_user_unique` ON `event_signups` (`event_id`,`user_id`) WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_event_signups_user` ON `event_signups` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_event_signups_event` ON `event_signups` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_signups_event_id_normalized_name_unique` ON `event_signups` (`event_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `event_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`default_title` text NOT NULL,
	`base_description` text DEFAULT '' NOT NULL,
	`default_channel_id` text,
	`default_mention_role_id` text,
	`default_voice_channel_id` text,
	`default_weekday` integer,
	`default_start_time` text,
	`default_end_time` text,
	`use_font` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_event_templates_name` ON `event_templates` (`name`);--> statement-breakpoint
CREATE TABLE `event_voice_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_event_voice_log_event` ON `event_voice_log` (`event_id`,`user_id`,`at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`voice_channel_id` text,
	`activated_at` text,
	`completed_at` text,
	`tracking_incomplete` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`reminded_at` text,
	`description` text DEFAULT '' NOT NULL,
	`configured_voice_channel_id` text,
	`use_font` integer DEFAULT 0 NOT NULL,
	`channel_cleared_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_message_id_unique` ON `events` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_events_starts_at` ON `events` (`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_events_status_starts` ON `events` (`status`,`starts_at`);--> statement-breakpoint
CREATE TABLE `member_records` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar` text,
	`joined_at` text,
	`rules_accepted_at` text,
	`left_at` text,
	`in_guild` integer DEFAULT 1 NOT NULL,
	`register_thread_id` text,
	`register_submitted_at` text,
	`register_submitted_name` text,
	`register_submitted_sso_name` text,
	`register_submitted_age` text,
	`register_status` text,
	`register_thread_expires_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_member_records_register_status` ON `member_records` (`register_status`);--> statement-breakpoint
CREATE INDEX `idx_member_records_in_guild` ON `member_records` (`in_guild`);--> statement-breakpoint
CREATE TABLE `reaction_role_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`panel_id` integer NOT NULL,
	`emoji_name` text,
	`emoji_id` text,
	`role_ids` text NOT NULL,
	`label` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`panel_id`) REFERENCES `reaction_role_panels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rr_map_emoji` ON `reaction_role_mappings` (`panel_id`,`emoji_id`,`emoji_name`);--> statement-breakpoint
CREATE TABLE `reaction_role_panels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`managed` integer DEFAULT 1 NOT NULL,
	`mode` text DEFAULT 'toggle' NOT NULL,
	`remove_reaction` integer DEFAULT 0 NOT NULL,
	`title` text,
	`description` text,
	`created_at` text NOT NULL,
	`selection_type` text DEFAULT 'reactions' NOT NULL,
	`message_type` text DEFAULT 'embed' NOT NULL,
	`allow_multiple` integer DEFAULT 0 NOT NULL,
	`removable` integer DEFAULT 1 NOT NULL,
	`allowed_role_ids` text,
	`sent` integer DEFAULT 0 NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`use_font` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reaction_role_panels_mode_check" CHECK(mode IN ('toggle', 'unique', 'verify'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rr_panels_message` ON `reaction_role_panels` (`message_id`) WHERE message_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `scheduled_event_publishes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publish_at` text NOT NULL,
	`payload` text NOT NULL,
	`published_event_id` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_event_publishes_due` ON `scheduled_event_publishes` (`publish_at`);--> statement-breakpoint
CREATE TABLE `schema_migrations` (
	`version` integer PRIMARY KEY NOT NULL,
	`hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`birthday_template` text NOT NULL,
	`first_birthday_message_id` text,
	`birthday_list_channel_id` text,
	`birthday_list_message_id` text,
	`birthday_cron` text DEFAULT '0 0 * * *' NOT NULL,
	`leave_notifications_enabled` integer DEFAULT 1 NOT NULL,
	`birthday_mod_channel_id` text,
	`birthday_self_registration_enabled` integer DEFAULT 1 NOT NULL,
	`birthday_bot_manages_anchor` integer DEFAULT 0 NOT NULL,
	`birthday_anchor_template` text DEFAULT '**{month}**
{entries}' NOT NULL,
	`font_map` text,
	`birthday_anchor_use_font` integer DEFAULT 0 NOT NULL,
	`birthday_announcement_use_font` integer DEFAULT 0 NOT NULL,
	`register_gate_role_id` text,
	`registration_tier_role_id` text,
	`birthday_anchor_intro` text,
	`rules_accepted_use_discord_screening` integer DEFAULT 0 NOT NULL,
	`register_channel_id` text,
	`role_selection_channel_id` text,
	`register_confirmation_template` text DEFAULT 'Danke {name}! Du wirst in Kürze registriert. Bis dahin kannst du dir schon in {roleChannel} deine Rollen aussuchen.' NOT NULL,
	`register_nickname_use_font` integer DEFAULT 1 NOT NULL,
	`register_auto_complete` integer DEFAULT 0 NOT NULL,
	`auto_register_confirmation_template` text DEFAULT 'Willkommen {name}! Du bist jetzt vollständig registriert. Schau dir gerne schon in {roleChannel} deine Rollen an. Dieser Thread schließt sich in einer Stunde automatisch.' NOT NULL,
	`apollo_event_channel_id` text,
	`event_voice_channel_id` text,
	`register_nickname_emoji` text DEFAULT '💙' NOT NULL,
	`register_confirmation_use_font` integer DEFAULT 0 NOT NULL,
	`auto_register_confirmation_use_font` integer DEFAULT 0 NOT NULL,
	`dashboard_moderator_role_id` text,
	`event_channel_cleanup_enabled` integer DEFAULT 0 NOT NULL,
	`event_channel_cleanup_delay_hours` integer DEFAULT 24 NOT NULL,
	`temp_voice_category_id` text,
	`temp_voice_max_amount` integer DEFAULT 15 NOT NULL,
	`temp_voice_name_format` text DEFAULT 'Gruppe {n}' NOT NULL,
	CONSTRAINT "settings_id_singleton" CHECK(id = 1)
);
--> statement-breakpoint
CREATE TABLE `temporary_voice_channels` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`event_id` integer,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_temporary_voice_channels_event` ON `temporary_voice_channels` (`event_id`);--> statement-breakpoint
CREATE TABLE `web_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`avatar` text,
	`role` text DEFAULT 'admin' NOT NULL,
	`expires_at` integer NOT NULL
);
