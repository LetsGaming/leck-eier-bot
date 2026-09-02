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
  /** Row id in the `birthdays` table — needed to target a specific entry for the dashboard's edit/delete actions (see web/routes/birthdays.ts). */
  id: number;
  mention: string;
  userId: string | null;
  name: string | null;
  /** 'list' = added/edited by an admin via the dashboard; 'self' = registered via `/setmybirthday` or a message in the birthday channel. */
  source: "list" | "self";
}

export type BirthdaysByDate = Record<string, BirthdayEntry[]>;

export interface Settings {
  birthdayTemplate: string;
  firstBirthdayMessageId: string | null;
  /** Channel the bot-managed birthday anchor message chain lives in. Null until set via the dashboard. */
  birthdayListChannelId: string | null;
  /** node-cron expression for the daily birthday-announcement job. */
  birthdayCron: string;
  /** Channel the bot posts a heads-up to whenever someone self-registers their birthday. Null = no notification posted. */
  birthdayModChannelId: string | null;
  /** Per-month heading template for the bot-managed anchor message — `{month}` and `{entries}` placeholders. See DEFAULT_BIRTHDAY_ANCHOR_TEMPLATE. */
  birthdayAnchorTemplate: string;
  /** Shown once above all the month blocks in the bot-managed anchor message (e.g. how to register a birthday) — unlike birthdayAnchorTemplate, never repeated and never rendered through fontMap. Null = no intro shown. */
  birthdayAnchorIntro: string | null;
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
  /** Role granted (typically via a reaction) that lets a not-yet-registered member see the #register channel. Null = the register-gate role swap is disabled. */
  registerGateRoleId: string | null;
  /** The lowest membership tier role, granted once at manual registration — not any tier role, since later promotions swap between higher tiers and must never re-trigger the gate-role removal. Null = the register-gate role swap is disabled. */
  registrationTierRoleId: string | null;
  /** How "rules accepted" (member_records.rules_accepted_at) is detected. Off (default) = role-based: the member being newly granted `registerGateRoleId` — this bot's own rules-message reaction-role. On = Discord's native membership-screening `pending` flag flipping to false, for guilds that use that feature instead. See `recordRulesAcceptedIfJustVerified()` in services/memberRecords.ts. */
  rulesAcceptedUseDiscordScreening: boolean;
  /** Channel watched for self-service registration-form submissions. Null = the feature is disabled. See `registerWatcher.ts`. */
  registerChannelId: string | null;
  /** Channel mentioned (as `{roleChannel}`) in the registration confirmation note — where a newly-registered member can pick their roles while waiting on staff. */
  roleSelectionChannelId: string | null;
  /** Posted in the private thread created on a member's registration-form message. `{name}`/`{roleChannel}` placeholders — see DEFAULT_REGISTER_CONFIRMATION_TEMPLATE. */
  registerConfirmationTemplate: string;
  /** Whether the generated nickname's first-name half renders through the shared `fontMap` (see `buildRegisterNickname()` in registerWatcher.ts). Defaults on. */
  registerNicknameUseFont: boolean;
  /** Off by default. When on, a valid registration-form submission immediately grants `registrationTierRoleId` instead of waiting for staff — see `registerWatcher.ts`. The private thread still opens (posting `autoRegisterConfirmationTemplate` instead of `registerConfirmationTemplate`) but auto-deletes after `REGISTER_AUTO_THREAD_LIFETIME_MS`. Has no effect if `registrationTierRoleId` isn't set. */
  registerAutoComplete: boolean;
  /** Posted in the private thread instead of `registerConfirmationTemplate` when `registerAutoComplete` successfully grants the tier role. Same `{name}`/`{roleChannel}` placeholders — see DEFAULT_AUTO_REGISTER_CONFIRMATION_TEMPLATE. */
  autoRegisterConfirmationTemplate: string;
  /** Channel the Apollo bot posts event RSVP embeds in. Null = Apollo event attendance tracking is disabled. See `apolloEventWatcher.ts`. */
  apolloEventChannelId: string | null;
  /** The one voice channel every tracked event happens in. Null = tracking never activates even if an event is parsed (see `sweepApolloEvents()`). */
  eventVoiceChannelId: string | null;
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
  /** One or more roles this option grants. Multiple roles are only ever possible on a Reactions panel — Buttons/Dropdown mappings are restricted to exactly one, enforced in web/routes/reactionRolePanels.ts, not here. Always non-empty. */
  roleIds: string[];
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
  /** ISO UTC. Only ever known from observing the configured signal (see `Settings.rulesAcceptedUseDiscordScreening`) live — see `recordRulesAcceptedIfJustVerified()`. */
  rulesAcceptedAt: string | null;
  /** ISO UTC. `null` while still in the guild. */
  leftAt: string | null;
  inGuild: boolean;
  /** Id of the private thread created for this member's registration-form submission (registerWatcher.ts). Null once the thread is deleted — staff complete the registration, it's manually removed from the dashboard, or the member leaves/is kicked/banned (memberEvents.ts) — or if none was ever created. Unlike the fields below, this does NOT persist past a terminal status, since the thread itself no longer exists to link to. */
  registerThreadId: string | null;
  /** ISO UTC — when the registration was submitted. Persists past a terminal status (see `registerStatus`) for the dashboard's history view. */
  registerSubmittedAt: string | null;
  /** Raw `name:` field value from the registration-form submission. Persists past a terminal status. Purely informational. */
  registerSubmittedName: string | null;
  /** Raw `sso name:` field value from the registration-form submission (the full value, not just the surname used for the nickname — see `buildRegisterNickname()`). Persists past a terminal status. */
  registerSubmittedSsoName: string | null;
  /** Raw `alter:` field value from the registration-form submission. Null if omitted (optional). Persists past a terminal status. */
  registerSubmittedAge: string | null;
  /** Lifecycle of the most recent registration-form submission. Null = never submitted one. Set to 'pending' on submission and never reset to null again — see `savePendingRegistration()`/`completeRegistration()`/`removeRegistration()`/`markRegistrationLeft()` in `memberRecordsRepository.ts`. */
  registerStatus: RegistrationStatus | null;
  /** ISO UTC — set only when `settings.registerAutoComplete` completes a registration, keeping the thread open a while longer instead of deleting it immediately. `sweepExpiredRegisterThreads()` in `registerWatcher.ts` deletes the thread once this passes. Null otherwise (including for a manually-completed/removed/left registration, which deletes the thread right away). */
  registerThreadExpiresAt: string | null;
}

/**
 * 'pending' = form submitted, awaiting staff action, private thread open.
 * 'registered' = staff granted the registration-tier role.
 * 'removed' = manually reset from the dashboard so the member can resubmit.
 * 'left' = the member left/was kicked/was banned while still 'pending'
 * (leaving after already being 'registered' does NOT overwrite that status
 * — see `markRegistrationLeft()`'s guard).
 */
export type RegistrationStatus = "pending" | "registered" | "removed" | "left";

/** What a member clicked on Apollo's event embed. */
export type ApolloRsvpChoice = "accepted" | "declined" | "tentative";

/** How a signup's `raw_name` was resolved to a guild member — see `resolveMemberByExactName()` in `services/memberSearch.ts`. */
export type SignupMatchSource = "auto" | "manual" | "unmatched" | "ambiguous";

/**
 * scheduled -> active -> completed, or -> cancelled if the Apollo message is
 * deleted while still scheduled. See `sweepApolloEvents()` in
 * `services/eventAttendance.ts`.
 */
export type ApolloEventStatus = "scheduled" | "active" | "completed" | "cancelled";

/** on_time/late/no_show/left_early are derived from `apollo_event_voice_log` by `deriveAttendance()`; not_tracked means the bot missed the whole window (offline) or the voice channel wasn't configured/visible when the event activated. Null (on a signup) means not yet computed — still scheduled, or the signup is 'declined' (never tracked at all). */
export type AttendanceStatus = "on_time" | "late" | "no_show" | "left_early" | "not_tracked";

/** A single Apollo-managed event, parsed from its RSVP embed. See migration v28 in `db/index.ts` for the full column rationale. */
export interface ApolloEvent {
  id: number;
  /** Numeric id from the event's `apollo.fyi/events/<id>` link. Null if it couldn't be found — `messageId` is then the only identity. */
  apolloEventId: string | null;
  messageId: string;
  channelId: string;
  title: string;
  /** ISO UTC. Frozen once `status` leaves 'scheduled' — a later Apollo edit can't move an in-flight measurement's goalposts. */
  startsAt: string;
  /** ISO UTC. Same freeze rule as `startsAt`. */
  endsAt: string;
  status: ApolloEventStatus;
  /** Snapshot of `settings.eventVoiceChannelId` taken at activation — a later setting change never rewrites an event's own history. Null until activated. */
  voiceChannelId: string | null;
  activatedAt: string | null;
  completedAt: string | null;
  /** The bot was offline for some/all of this event's tracking window — see `catchUpApolloEvents()`. Timestamps on this event's signups may be approximate. */
  trackingIncomplete: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One signed-up member on an `ApolloEvent`. Two independent field groups — see migration v28's doc comment in `db/index.ts` for why they're never written by the same code path. */
export interface ApolloEventSignup {
  id: number;
  eventId: number;
  /** As it appeared in Apollo's embed, exactly. */
  rawName: string;
  /** `normalizeForSearch(rawName)` — the natural key alongside `eventId` for re-parse upserts. */
  normalizedName: string;
  choice: ApolloRsvpChoice;
  /** Null until resolved (or if resolution failed/was ambiguous). */
  userId: string | null;
  matchSource: SignupMatchSource;
  /** ISO UTC — set when this name disappears from a re-parsed embed after the event has gone active/completed (rows are just deleted instead, pre-activation). Null while still present. */
  withdrawnAt: string | null;
  /** Null while the event is still 'scheduled', and always null for a 'declined' choice (never tracked). */
  attendanceStatus: AttendanceStatus | null;
  firstJoinedAt: string | null;
  lastLeftAt: string | null;
}

/** One join/leave/snapshot row in the tracked voice channel for an active event — the source of truth `deriveAttendance()` replays. Logged for every non-bot member who touches the channel, not just signed-up ones, so a manual name-link made after the fact can still reconstruct real attendance. */
export interface ApolloEventVoiceLogRow {
  id: number;
  eventId: number;
  userId: string;
  action: "present_at_start" | "join" | "leave" | "present_at_end";
  /** ISO UTC, clamped into [startsAt, endsAt]. */
  at: string;
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
