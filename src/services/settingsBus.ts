import { EventEmitter } from "events";

/**
 * Fired whenever DB-backed settings change (birthday config, command
 * overrides, reaction-role panels/mappings, ...), regardless of whether the
 * write came from a slash command or the dashboard API. Lets long-lived
 * consumers (the cron job, the command loader, the reaction-role cache)
 * react without restarting the process.
 *
 * Event names are deliberately coarse-grained — consumers that only care
 * about one slice of settings still just re-read from the repository, so
 * there's no need to thread payloads through the bus.
 */
export const settingsBus = new EventEmitter();

export const SettingsEvent = {
  /** Any field on the singleton `settings` row changed. */
  Settings: "settings",
  /** A row in `command_settings` was added/changed/removed. */
  Commands: "commands",
  /** A reaction-role panel or one of its mappings was created/updated/deleted. */
  ReactionRoles: "reactionRoles",
} as const;
