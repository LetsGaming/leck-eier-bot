import type {
  ChatInputCommandInteraction,
  Client,
  Collection,
  SlashCommandBuilder,
} from "discord.js";
import type { CommandPermission, ReactionRoleMode } from "./constants.js";

export type { Config } from "./config/schema.js";

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<unknown>;
  guildOnly?: boolean;
  /** Defaults to {@link CommandPermission.None} when omitted. */
  permission?: CommandPermission;
}

export type BotClient = Client & {
  commands: Collection<string, Command>;
};

export interface BirthdayEntry {
  mention: string;
  userId: string | null;
  name: string | null;
}

export type BirthdaysByDate = Record<string, BirthdayEntry[]>;

export interface Settings {
  birthdayTemplate: string;
  firstBirthdayMessageId: string | null;
  /** Channel/message id of the manually-maintained birthday announcement list. Null until set via command or dashboard. */
  birthdayListChannelId: string | null;
  birthdayListMessageId: string | null;
  /** node-cron expression for the daily birthday-announcement job. */
  birthdayCron: string;
  leaveNotificationsEnabled: boolean;
}

export interface CommandSetting {
  name: string;
  enabled: boolean;
  guildOnly: boolean;
}

/** A single emoji -> role mapping within a reaction-role panel. */
export interface ReactionRoleMapping {
  id: number;
  panelId: number;
  /** Unicode emoji character, or a custom emoji's name. */
  emojiName: string;
  /** Set only for custom (guild) emoji; null for unicode emoji. */
  emojiId: string | null;
  roleId: string;
  label: string | null;
  position: number;
}

/** A message the bot posts/maintains whose reactions grant roles. */
export interface ReactionRolePanel {
  id: number;
  channelId: string;
  /** Null until the panel has been posted to Discord for the first time. */
  messageId: string | null;
  /** Whether the bot owns and re-renders the message (always true for now; reserved for a future "attach to an existing message" mode). */
  managed: boolean;
  mode: ReactionRoleMode;
  removeReaction: boolean;
  title: string | null;
  description: string | null;
  createdAt: string;
}

export type ReactionRolePanelWithMappings = ReactionRolePanel & {
  mappings: ReactionRoleMapping[];
};

/** Identifies one emoji, the way discord.js's `ReactionEmoji`/`GuildEmoji` do. */
export interface EmojiKey {
  name: string;
  id: string | null;
}

/** A logged-in dashboard session, backed by the `web_sessions` table. */
export interface WebSession {
  id: string;
  userId: string;
  username: string;
  avatar: string | null;
  isOwner: boolean;
  expiresAt: number;
}
