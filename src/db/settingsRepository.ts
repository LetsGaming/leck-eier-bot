import { db } from "./index.js";
import { settingsBus, SettingsEvent } from "../services/settingsBus.js";
import type { PermissionGate, Settings } from "../types.js";

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
  register_confirmation_template: string;
  register_confirmation_use_font: 0 | 1;
  register_nickname_use_font: 0 | 1;
  register_nickname_emoji: string;
  register_auto_complete: 0 | 1;
  auto_register_confirmation_template: string;
  auto_register_confirmation_use_font: 0 | 1;
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
    registerConfirmationTemplate: row.register_confirmation_template,
    registerConfirmationUseFont: row.register_confirmation_use_font === 1,
    registerNicknameUseFont: row.register_nickname_use_font === 1,
    registerNicknameEmoji: row.register_nickname_emoji,
    registerAutoComplete: row.register_auto_complete === 1,
    autoRegisterConfirmationTemplate: row.auto_register_confirmation_template,
    autoRegisterConfirmationUseFont: row.auto_register_confirmation_use_font === 1,
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
          register_channel_id, register_confirmation_template,
          register_confirmation_use_font,
          register_nickname_use_font, register_nickname_emoji, register_auto_complete, auto_register_confirmation_template,
          auto_register_confirmation_use_font,
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
  registerConfirmationTemplate: string;
  registerConfirmationUseFont: 0 | 1;
  registerNicknameUseFont: 0 | 1;
  registerNicknameEmoji: string;
  registerAutoComplete: 0 | 1;
  autoRegisterConfirmationTemplate: string;
  autoRegisterConfirmationUseFont: 0 | 1;
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
     register_confirmation_template = @registerConfirmationTemplate,
     register_confirmation_use_font = @registerConfirmationUseFont,
     register_nickname_use_font = @registerNicknameUseFont,
     register_nickname_emoji = @registerNicknameEmoji,
     register_auto_complete = @registerAutoComplete,
     auto_register_confirmation_template = @autoRegisterConfirmationTemplate,
     auto_register_confirmation_use_font = @autoRegisterConfirmationUseFont,
     apollo_event_channel_id = @apolloEventChannelId,
     event_voice_channel_id = @eventVoiceChannelId
   WHERE id = 1`,
);

// --- Settings cache ----------------------------------------------------
// getSettings() is called unconditionally on every Discord message by
// multiple event handlers (birthdayWatcher, registerWatcher, ...) before
// those handlers even check relevance, so it's worth avoiding a SQLite
// read on every call. Populated lazily and invalidated on
// SettingsEvent.Settings, which updateSettings() below emits on every
// write to the `settings` row — the only source getSettings() reads from.
//
// INVARIANT: this is the one safe way to cache settings in this codebase.
// getSettings()'s result must always be either read fresh from the DB, or
// served from a cache that is invalidated via settingsBus on every write
// path that can change what it returns. Do NOT add or extend caching
// (here or anywhere else that wraps getSettings()) without wiring up an
// equivalent settingsBus invalidation — an uninvalidated cache would
// silently serve stale settings, which is exactly the failure mode this
// cache is designed to avoid.
let settingsCache: Settings | null = null;

settingsBus.on(SettingsEvent.Settings, () => {
  settingsCache = null;
});

/** The settings row is seeded on startup (see src/db/index.ts), so this is always present. */
export function getSettings(): Settings {
  settingsCache ??= rowToSettings(selectStmt.get()!);
  return settingsCache;
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
    registerConfirmationTemplate: next.registerConfirmationTemplate,
    registerConfirmationUseFont: next.registerConfirmationUseFont ? 1 : 0,
    registerNicknameUseFont: next.registerNicknameUseFont ? 1 : 0,
    registerNicknameEmoji: next.registerNicknameEmoji,
    registerAutoComplete: next.registerAutoComplete ? 1 : 0,
    autoRegisterConfirmationTemplate: next.autoRegisterConfirmationTemplate,
    autoRegisterConfirmationUseFont: next.autoRegisterConfirmationUseFont ? 1 : 0,
    apolloEventChannelId: next.apolloEventChannelId,
    eventVoiceChannelId: next.eventVoiceChannelId,
  });
  settingsBus.emit(SettingsEvent.Settings);
  return next;
}

interface CommandSettingsRow {
  enabled: 0 | 1;
  guild_only: 0 | 1;
  permission_gate: string | null;
}

const selectCommandStmt = db.prepare<[string], CommandSettingsRow>(
  "SELECT enabled, guild_only, permission_gate FROM command_settings WHERE name = ?",
);
const selectAllCommandsStmt = db.prepare<[], CommandSettingsRow & { name: string }>(
  "SELECT name, enabled, guild_only, permission_gate FROM command_settings",
);
const upsertCommandStmt = db.prepare<{
  name: string;
  enabled: 0 | 1;
  guildOnly: 0 | 1;
  permissionGate: string | null;
}>(
  `INSERT INTO command_settings (name, enabled, guild_only, permission_gate)
   VALUES (@name, @enabled, @guildOnly, @permissionGate)
   ON CONFLICT(name) DO UPDATE SET enabled = @enabled, guild_only = @guildOnly, permission_gate = @permissionGate`,
);

export interface CommandOverride {
  enabled: boolean;
  guildOnly: boolean;
  /** `null` = no override; the command falls back to `defaultGateFor(permission)`. See PermissionGate in types.ts. */
  permissionGate: PermissionGate | null;
}

function rowToCommandOverride(row: CommandSettingsRow): CommandOverride {
  return {
    enabled: row.enabled === 1,
    guildOnly: row.guild_only === 1,
    // Same JSON-column convention as reaction_role_panels.allowed_role_ids —
    // stored as TEXT, null passed through as SQL NULL.
    permissionGate: row.permission_gate !== null ? (JSON.parse(row.permission_gate) as PermissionGate) : null,
  };
}

/** Falls back to {enabled: true, guildOnly: true, permissionGate: null} for commands that have never been overridden. */
export function getCommandOverride(name: string): CommandOverride {
  const row = selectCommandStmt.get(name);
  return row ? rowToCommandOverride(row) : { enabled: true, guildOnly: true, permissionGate: null };
}

export function getAllCommandOverrides(): Record<string, CommandOverride> {
  const out: Record<string, CommandOverride> = {};
  for (const row of selectAllCommandsStmt.all()) {
    out[row.name] = rowToCommandOverride(row);
  }
  return out;
}

export function setCommandOverride(name: string, override: CommandOverride): void {
  upsertCommandStmt.run({
    name,
    enabled: override.enabled ? 1 : 0,
    guildOnly: override.guildOnly ? 1 : 0,
    permissionGate: override.permissionGate !== null ? JSON.stringify(override.permissionGate) : null,
  });
  settingsBus.emit(SettingsEvent.Commands);
}

const selectCommandDefinitionsHashStmt = db.prepare<[], { definitions_hash: string | null }>(
  "SELECT definitions_hash FROM command_registration_state WHERE id = 1",
);
const updateCommandDefinitionsHashStmt = db.prepare<[string]>(
  "UPDATE command_registration_state SET definitions_hash = ? WHERE id = 1",
);

/** Null means no successful Discord command-registration push has happened yet (fresh install, or upgraded from before this column existed). */
export function getCommandDefinitionsHash(): string | null {
  return selectCommandDefinitionsHashStmt.get()?.definitions_hash ?? null;
}

export function setCommandDefinitionsHash(hash: string): void {
  updateCommandDefinitionsHashStmt.run(hash);
}
