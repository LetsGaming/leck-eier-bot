import type {
  ChatInputCommandInteraction,
  Client,
  Collection,
  SlashCommandBuilder,
} from "discord.js";
import type { CommandPermission, PanelMessageType, SelectionType } from "./constants.js";

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

/** A single option within a reaction-role panel — an emoji, a button, or a dropdown entry, mapped to a role. */
export interface ReactionRoleMapping {
  id: number;
  panelId: number;
  /** Unicode emoji character, or a custom emoji's name. Null for a buttons/dropdown mapping with no emoji — a reaction always has one. */
  emojiName: string | null;
  /** Set only for custom (guild) emoji; null for unicode emoji or no emoji at all. */
  emojiId: string | null;
  roleId: string;
  label: string | null;
  position: number;
}

/** A message members interact with (react to, click a button on, or pick from a dropdown on) to self-assign roles. */
export interface ReactionRolePanel {
  id: number;
  channelId: string;
  /** Null until the panel has been posted to Discord for the first time (managed panels only — set immediately for an attached-to-existing-message one). */
  messageId: string | null;
  /** Whether the bot owns and re-renders the message, vs. being attached to a pre-existing one it never edits — see docs/REACTION_ROLES.md#attaching-to-an-existing-message. Immutable after creation. */
  managed: boolean;
  /** How members interact with it. Immutable after creation — buttons/dropdowns require a bot-owned message, so this can't combine with `managed: false`. */
  selectionType: SelectionType;
  /** Ignored (and always null-backed) for an unmanaged panel — there's no message content to render it into. */
  messageType: PanelMessageType;
  /** Reactions-only: strip the user's own reaction immediately after acting, so re-reacting flips the role instead of un-reacting revoking it. */
  removeReaction: boolean;
  /** If false, only one mapping's role may be held at a time — picking/reacting to a new one revokes the previous. */
  allowMultiple: boolean;
  /** If false, a granted role can never be given up through this panel once acquired (rules-acceptance style). */
  removable: boolean;
  /** Only members holding at least one of these roles may use the panel. Null/empty = everyone. */
  allowedRoleIds: string[] | null;
  /** Panels start as drafts (no writes are pushed to Discord) until explicitly sent — see docs/REACTION_ROLES.md#draft-then-send. */
  sent: boolean;
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
