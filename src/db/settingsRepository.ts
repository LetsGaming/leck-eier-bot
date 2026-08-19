import { db } from "./index.js";
import { settingsBus, SettingsEvent } from "../services/settingsBus.js";
import type { Settings } from "../types.js";

interface SettingsRow {
  birthday_template: string;
  first_birthday_message_id: string | null;
  birthday_list_channel_id: string | null;
  birthday_list_message_id: string | null;
  birthday_cron: string;
  leave_notifications_enabled: 0 | 1;
}

function rowToSettings(row: SettingsRow): Settings {
  return {
    birthdayTemplate: row.birthday_template,
    firstBirthdayMessageId: row.first_birthday_message_id,
    birthdayListChannelId: row.birthday_list_channel_id,
    birthdayListMessageId: row.birthday_list_message_id,
    birthdayCron: row.birthday_cron,
    leaveNotificationsEnabled: row.leave_notifications_enabled === 1,
  };
}

const selectStmt = db.prepare<[], SettingsRow>(
  `SELECT birthday_template, first_birthday_message_id, birthday_list_channel_id,
          birthday_list_message_id, birthday_cron, leave_notifications_enabled
   FROM settings WHERE id = 1`,
);
const updateStmt = db.prepare<{
  birthdayTemplate: string;
  firstBirthdayMessageId: string | null;
  birthdayListChannelId: string | null;
  birthdayListMessageId: string | null;
  birthdayCron: string;
  leaveNotificationsEnabled: 0 | 1;
}>(
  `UPDATE settings SET
     birthday_template = @birthdayTemplate,
     first_birthday_message_id = @firstBirthdayMessageId,
     birthday_list_channel_id = @birthdayListChannelId,
     birthday_list_message_id = @birthdayListMessageId,
     birthday_cron = @birthdayCron,
     leave_notifications_enabled = @leaveNotificationsEnabled
   WHERE id = 1`,
);

/** The settings row is seeded on startup (see src/db/index.ts), so this is always present. */
export function getSettings(): Settings {
  return rowToSettings(selectStmt.get()!);
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const current = getSettings();
  const next: Settings = { ...current, ...patch };
  updateStmt.run({
    birthdayTemplate: next.birthdayTemplate,
    firstBirthdayMessageId: next.firstBirthdayMessageId,
    birthdayListChannelId: next.birthdayListChannelId,
    birthdayListMessageId: next.birthdayListMessageId,
    birthdayCron: next.birthdayCron,
    leaveNotificationsEnabled: next.leaveNotificationsEnabled ? 1 : 0,
  });
  settingsBus.emit(SettingsEvent.Settings);
  return next;
}

const selectCommandStmt = db.prepare<[string], { enabled: 0 | 1; guild_only: 0 | 1 }>(
  "SELECT enabled, guild_only FROM command_settings WHERE name = ?",
);
const selectAllCommandsStmt = db.prepare<[], { name: string; enabled: 0 | 1; guild_only: 0 | 1 }>(
  "SELECT name, enabled, guild_only FROM command_settings",
);
const upsertCommandStmt = db.prepare<{ name: string; enabled: 0 | 1; guildOnly: 0 | 1 }>(
  `INSERT INTO command_settings (name, enabled, guild_only) VALUES (@name, @enabled, @guildOnly)
   ON CONFLICT(name) DO UPDATE SET enabled = @enabled, guild_only = @guildOnly`,
);

export interface CommandOverride {
  enabled: boolean;
  guildOnly: boolean;
}

/** Falls back to {enabled: true, guildOnly: true} for commands that have never been overridden. */
export function getCommandOverride(name: string): CommandOverride {
  const row = selectCommandStmt.get(name);
  return row
    ? { enabled: row.enabled === 1, guildOnly: row.guild_only === 1 }
    : { enabled: true, guildOnly: true };
}

export function getAllCommandOverrides(): Record<string, CommandOverride> {
  const out: Record<string, CommandOverride> = {};
  for (const row of selectAllCommandsStmt.all()) {
    out[row.name] = { enabled: row.enabled === 1, guildOnly: row.guild_only === 1 };
  }
  return out;
}

export function setCommandOverride(name: string, override: CommandOverride): void {
  upsertCommandStmt.run({
    name,
    enabled: override.enabled ? 1 : 0,
    guildOnly: override.guildOnly ? 1 : 0,
  });
  settingsBus.emit(SettingsEvent.Commands);
}
