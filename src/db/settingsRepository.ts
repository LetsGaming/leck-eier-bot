import { db } from "./index.js";
import { settingsBus, SettingsEvent } from "../services/settingsBus.js";
import type { Settings } from "../types.js";

interface SettingsRow {
  birthday_template: string;
  first_birthday_message_id: string | null;
  birthday_list_channel_id: string | null;
  birthday_cron: string;
  birthday_mod_channel_id: string | null;
  birthday_anchor_template: string;
  birthday_anchor_intro: string | null;
  font_map: string | null;
  birthday_anchor_use_font: 0 | 1;
  birthday_announcement_use_font: 0 | 1;
  leave_notifications_enabled: 0 | 1;
  register_gate_role_id: string | null;
  registration_tier_role_id: string | null;
  rules_accepted_use_discord_screening: 0 | 1;
  register_channel_id: string | null;
  role_selection_channel_id: string | null;
  register_confirmation_template: string;
  register_nickname_use_font: 0 | 1;
  register_auto_complete: 0 | 1;
  auto_register_confirmation_template: string;
  apollo_event_channel_id: string | null;
  event_voice_channel_id: string | null;
}

function rowToSettings(row: SettingsRow): Settings {
  return {
    birthdayTemplate: row.birthday_template,
    firstBirthdayMessageId: row.first_birthday_message_id,
    birthdayListChannelId: row.birthday_list_channel_id,
    birthdayCron: row.birthday_cron,
    birthdayModChannelId: row.birthday_mod_channel_id,
    birthdayAnchorTemplate: row.birthday_anchor_template,
    birthdayAnchorIntro: row.birthday_anchor_intro,
    fontMap: row.font_map,
    birthdayAnchorUseFont: row.birthday_anchor_use_font === 1,
    birthdayAnnouncementUseFont: row.birthday_announcement_use_font === 1,
    leaveNotificationsEnabled: row.leave_notifications_enabled === 1,
    registerGateRoleId: row.register_gate_role_id,
    registrationTierRoleId: row.registration_tier_role_id,
    rulesAcceptedUseDiscordScreening: row.rules_accepted_use_discord_screening === 1,
    registerChannelId: row.register_channel_id,
    roleSelectionChannelId: row.role_selection_channel_id,
    registerConfirmationTemplate: row.register_confirmation_template,
    registerNicknameUseFont: row.register_nickname_use_font === 1,
    registerAutoComplete: row.register_auto_complete === 1,
    autoRegisterConfirmationTemplate: row.auto_register_confirmation_template,
    apolloEventChannelId: row.apollo_event_channel_id,
    eventVoiceChannelId: row.event_voice_channel_id,
  };
}

const selectStmt = db.prepare<[], SettingsRow>(
  `SELECT birthday_template, first_birthday_message_id, birthday_list_channel_id,
          birthday_cron, birthday_mod_channel_id,
          birthday_anchor_template, birthday_anchor_intro, font_map, birthday_anchor_use_font,
          birthday_announcement_use_font, leave_notifications_enabled,
          register_gate_role_id, registration_tier_role_id, rules_accepted_use_discord_screening,
          register_channel_id, role_selection_channel_id, register_confirmation_template,
          register_nickname_use_font, register_auto_complete, auto_register_confirmation_template,
          apollo_event_channel_id, event_voice_channel_id
   FROM settings WHERE id = 1`,
);
const updateStmt = db.prepare<{
  birthdayTemplate: string;
  firstBirthdayMessageId: string | null;
  birthdayListChannelId: string | null;
  birthdayCron: string;
  birthdayModChannelId: string | null;
  birthdayAnchorTemplate: string;
  birthdayAnchorIntro: string | null;
  fontMap: string | null;
  birthdayAnchorUseFont: 0 | 1;
  birthdayAnnouncementUseFont: 0 | 1;
  leaveNotificationsEnabled: 0 | 1;
  registerGateRoleId: string | null;
  registrationTierRoleId: string | null;
  rulesAcceptedUseDiscordScreening: 0 | 1;
  registerChannelId: string | null;
  roleSelectionChannelId: string | null;
  registerConfirmationTemplate: string;
  registerNicknameUseFont: 0 | 1;
  registerAutoComplete: 0 | 1;
  autoRegisterConfirmationTemplate: string;
  apolloEventChannelId: string | null;
  eventVoiceChannelId: string | null;
}>(
  `UPDATE settings SET
     birthday_template = @birthdayTemplate,
     first_birthday_message_id = @firstBirthdayMessageId,
     birthday_list_channel_id = @birthdayListChannelId,
     birthday_cron = @birthdayCron,
     birthday_mod_channel_id = @birthdayModChannelId,
     birthday_anchor_template = @birthdayAnchorTemplate,
     birthday_anchor_intro = @birthdayAnchorIntro,
     font_map = @fontMap,
     birthday_anchor_use_font = @birthdayAnchorUseFont,
     birthday_announcement_use_font = @birthdayAnnouncementUseFont,
     leave_notifications_enabled = @leaveNotificationsEnabled,
     register_gate_role_id = @registerGateRoleId,
     registration_tier_role_id = @registrationTierRoleId,
     rules_accepted_use_discord_screening = @rulesAcceptedUseDiscordScreening,
     register_channel_id = @registerChannelId,
     role_selection_channel_id = @roleSelectionChannelId,
     register_confirmation_template = @registerConfirmationTemplate,
     register_nickname_use_font = @registerNicknameUseFont,
     register_auto_complete = @registerAutoComplete,
     auto_register_confirmation_template = @autoRegisterConfirmationTemplate,
     apollo_event_channel_id = @apolloEventChannelId,
     event_voice_channel_id = @eventVoiceChannelId
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
    birthdayCron: next.birthdayCron,
    birthdayModChannelId: next.birthdayModChannelId,
    birthdayAnchorTemplate: next.birthdayAnchorTemplate,
    birthdayAnchorIntro: next.birthdayAnchorIntro,
    fontMap: next.fontMap,
    birthdayAnchorUseFont: next.birthdayAnchorUseFont ? 1 : 0,
    birthdayAnnouncementUseFont: next.birthdayAnnouncementUseFont ? 1 : 0,
    leaveNotificationsEnabled: next.leaveNotificationsEnabled ? 1 : 0,
    registerGateRoleId: next.registerGateRoleId,
    registrationTierRoleId: next.registrationTierRoleId,
    rulesAcceptedUseDiscordScreening: next.rulesAcceptedUseDiscordScreening ? 1 : 0,
    registerChannelId: next.registerChannelId,
    roleSelectionChannelId: next.roleSelectionChannelId,
    registerConfirmationTemplate: next.registerConfirmationTemplate,
    registerNicknameUseFont: next.registerNicknameUseFont ? 1 : 0,
    registerAutoComplete: next.registerAutoComplete ? 1 : 0,
    autoRegisterConfirmationTemplate: next.autoRegisterConfirmationTemplate,
    apolloEventChannelId: next.apolloEventChannelId,
    eventVoiceChannelId: next.eventVoiceChannelId,
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
