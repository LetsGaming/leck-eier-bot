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
  /** 'list' = parsed from the manually-maintained announcement message; 'self' = registered via `/setmybirthday` or a message in the birthday channel. */
  source: "list" | "self";
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
  /** Channel the bot posts a heads-up to whenever someone self-registers their birthday. Null = no notification posted. */
  birthdayModChannelId: string | null;
  /** Gates both self-registration paths (`/setmybirthday` and posting a date in the birthday channel). Off = the anchor message's author must edit it themselves, same as before that feature existed. */
  birthdaySelfRegistrationEnabled: boolean;
  /** When true, the bot renders and owns the anchor message itself (posting/editing it) instead of an admin hand-maintaining it — only meaningful (and only settable) while birthdaySelfRegistrationEnabled is also true. */
  birthdayBotManagesAnchor: boolean;
  /** Per-month heading template for the bot-managed anchor message — `{month}` and `{entries}` placeholders. See DEFAULT_BIRTHDAY_ANCHOR_TEMPLATE. */
  birthdayAnchorTemplate: string;
  /**
   * Pasted 52-character stylized alphabet (matching FONT_REFERENCE in
   * utils/font.ts position for position) — set once from the dashboard's
   * Settings page, then reused by any feature below with its own
   * `*UseFont` flag turned on, so nothing has to paste it more than once.
   * Null = no font configured.
   */
  fontMap: string | null;
  /** Whether the bot-managed anchor message's `{month}` heading is rendered through `fontMap`. */
  birthdayAnchorUseFont: boolean;
  /** Whether the daily birthday announcement message is rendered through `fontMap`. */
  birthdayAnnouncementUseFont: boolean;
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
  /** Always-present admin-facing label — independent of `title`, which only ever applies to an embed-type managed panel. Shown in the dashboard's panel list and `/reactionroles list`. */
  name: string;
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
  /** Renders the title, message text, and button/dropdown labels through `settings.fontMap`, if one's configured — see utils/font.ts. */
  useFont: boolean;
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

/**
 * One row per Discord user ever seen in the configured guild, current or
 * former (`inGuild` tells them apart) — backs the dashboard's Member Audit
 * page. Every date here is recorded live by the bot itself (see
 * services/memberRecords.ts) rather than read back from Discord after the
 * fact, since Discord doesn't expose a former member's history or a rules-
 * acceptance timestamp at all; `null` means "not tracked" (e.g. verified
 * before this feature shipped), not "never happened".
 */
export interface MemberRecord {
  userId: string;
  username: string;
  displayName: string;
  /** Global user avatar hash — `null` for the default avatar. Only meaningful for a former member; a current one's avatar is read live from the cache instead. */
  avatar: string | null;
  /** ISO UTC. Backfilled once at every startup for anyone already in the guild — Discord does expose a current member's join date. */
  joinedAt: string | null;
  /** ISO UTC. Only ever known from observing the pending->false (membership screening / "rules") transition live — see `recordRulesAcceptedIfJustVerified()`. */
  rulesAcceptedAt: string | null;
  /** ISO UTC. `null` while still in the guild. */
  leftAt: string | null;
  inGuild: boolean;
}

/**
 * Dashboard RBAC role, resolved at login (`resolveDashboardRole()` in
 * web/auth.ts) and carried on the session for its lifetime — a Discord-side
 * ownership/role change takes effect on the next login, not live. Strict
 * hierarchy, highest first:
 *   - 'bot-owner' — `config.botOwnerId`. Always total access.
 *   - 'guild-owner' — owns the configured guild, but isn't the bot owner.
 *   - 'admin' — holds Discord's Administrator permission in that guild
 *     (directly or via @everyone), but is neither of the above.
 * Every route is currently gated to allow all three (see requireRole() in
 * web/session.ts) — the tiers exist so a route can be narrowed to e.g.
 * 'bot-owner'-only later without a schema change.
 */
export type WebRole = "bot-owner" | "guild-owner" | "admin";

/** A logged-in dashboard session, backed by the `web_sessions` table. */
export interface WebSession {
  id: string;
  userId: string;
  username: string;
  avatar: string | null;
  role: WebRole;
  expiresAt: number;
}
