export type SelectionType = "reactions" | "buttons" | "dropdown";
export type PanelMessageType = "text" | "embed";

/** Strict hierarchy, highest first: 'bot-owner' (always total access) > 'guild-owner' > 'admin'. */
export type WebRole = "bot-owner" | "guild-owner" | "admin";

export interface Me {
  userId: string;
  username: string;
  avatar: string | null;
  role: WebRole;
  /** IANA timezone name (e.g. "Europe/Berlin") every dashboard date is displayed in — see `setDisplayTimezone` in `../dateFormat`. */
  timezone: string;
}

export interface Status {
  botTag: string | null;
  uptimeMs: number;
  guildName: string | null;
  guildMemberCount: number | null;
  cachedMemberCount: number;
  reactionRolePanelCount: number;
}

export interface Channel {
  id: string;
  name: string;
  position: number;
}

export interface RoleOption {
  id: string;
  name: string;
  color: string;
  position: number;
  managed: boolean;
  manageable: boolean;
}

export interface EmojiOption {
  id: string;
  name: string | null;
  animated: boolean;
}

export interface Mapping {
  id: number;
  panelId: number;
  /** Null for a buttons/dropdown option with no emoji — reactions always have one. */
  emojiName: string | null;
  emojiId: string | null;
  /** One or more roles this option grants. Multiple only ever possible on a Reactions panel — Buttons/Dropdown are restricted to exactly one. */
  roleIds: string[];
  label: string | null;
  position: number;
}

export interface Panel {
  id: number;
  name: string;
  channelId: string;
  messageId: string | null;
  managed: boolean;
  /** Immutable after creation. */
  selectionType: SelectionType;
  /** Ignored for an unmanaged (attached-to-existing-message) panel. */
  messageType: PanelMessageType;
  /** Reactions only. */
  removeReaction: boolean;
  allowMultiple: boolean;
  removable: boolean;
  allowedRoleIds: string[] | null;
  /** Draft panels haven't been posted to Discord yet — see the Send button. */
  sent: boolean;
  title: string | null;
  description: string | null;
  /** Renders the title, message text, and button/dropdown labels through the global font set on the Settings page, if one's configured. */
  useFont: boolean;
  createdAt: string;
  mappings: Mapping[];
}

export interface PanelInput {
  name: string;
  channelId: string;
  messageType: PanelMessageType;
  removeReaction: boolean;
  allowMultiple: boolean;
  removable: boolean;
  allowedRoleIds: string[] | null;
  title: string | null;
  description: string | null;
  useFont: boolean;
}

export interface CreatePanelInput extends PanelInput {
  selectionType: SelectionType;
  /** Attach to a pre-existing message (e.g. an admin's rules post) instead of having the bot post/manage its own. Create-only, reactions-only. */
  existingMessageId: string | null;
}

export interface MappingInput {
  emojiName: string | null;
  emojiId: string | null;
  roleIds: string[];
  label: string | null;
}

export interface BirthdaySettings {
  template: string;
  /** Channel the bot-managed anchor message chain lives in. */
  channelId: string | null;
  cron: string;
  /** Channel the bot posts a heads-up to whenever someone self-registers their birthday. Null = no notification posted. */
  modChannelId: string | null;
  /** `{month}`/`{entries}` placeholder template for each month's heading in the bot-managed anchor message. */
  anchorTemplate: string;
  /** Shown once above all the month blocks (e.g. how to register a birthday) — never repeated, never font-styled. Null = no intro shown. */
  anchorIntro: string | null;
  /** Whether the anchor message's `{month}` heading renders through the global font set on the Settings page. */
  anchorUseFont: boolean;
  /** Whether the daily birthday announcement message renders through the global font set on the Settings page. */
  announcementUseFont: boolean;
}

export interface BirthdayEntry {
  /** Row id — needed to edit/delete a specific entry from the dashboard's admin-managed table. */
  id: number;
  mention: string;
  userId: string | null;
  name: string | null;
  /** 'list' = added/edited by an admin via the dashboard; 'self' = registered via `/setmybirthday` or a message in the birthday channel. */
  source: "list" | "self";
}

/** Body for adding or editing a birthday from the dashboard's admin-managed table (see `api.addBirthday`/`api.updateBirthday`). */
export interface BirthdayEntryInput {
  day: number;
  month: number;
  userId: string | null;
  name: string | null;
}

export type BirthdaysByDate = Record<string, BirthdayEntry[]>;

export interface UpcomingBirthday {
  dateKey: string;
  /** Whole days from now, computed server-side (0 = today, 1 = tomorrow, ...) — see docs/DATABASE.md and the daysUntil() doc comment for why this isn't a timestamp. */
  daysUntil: number;
  entries: BirthdayEntry[];
}

export interface CommandDef {
  name: string;
  description: string;
  permission?: "none" | "admin" | "owner";
  enabled: boolean;
  guildOnly: boolean;
}

export interface GeneralSettings {
  leaveNotificationsEnabled: boolean;
  /** Pasted 52-character stylized alphabet (AaBbCc...XxYyZz, one for one), set once and reused by any feature with its own "use font" toggle — see Birthdays and Reaction Roles. Null = no font configured. */
  fontMap: string | null;
  /** Role that lets a not-yet-registered member see #register. Null = the register-gate role swap is disabled. */
  registerGateRoleId: string | null;
  /** The lowest membership tier role, granted once at manual registration. Null = the register-gate role swap is disabled. */
  registrationTierRoleId: string | null;
  /** How "rules accepted" is detected on the Member Audit page. Off (default) = role-based: newly granted registerGateRoleId. On = Discord's native membership-screening `pending` flag. */
  rulesAcceptedUseDiscordScreening: boolean;
  /** Channel watched for self-service registration-form submissions. Null = the feature is disabled. */
  registerChannelId: string | null;
  /** Channel mentioned (as `{roleChannel}`) in the registration confirmation note. */
  roleSelectionChannelId: string | null;
  /** Posted in the private thread created on a member's registration-form message. `{name}`/`{roleChannel}` placeholders. */
  registerConfirmationTemplate: string;
  /** Whether the generated nickname's first-name half renders through the global font set above. Defaults on. */
  registerNicknameUseFont: boolean;
  /** Off by default. When on, a valid registration-form submission immediately grants the registration-tier role instead of waiting for staff. The private thread still opens (with `autoRegisterConfirmationTemplate` instead of `registerConfirmationTemplate`) but auto-deletes after an hour. Has no effect if `registrationTierRoleId` isn't set. */
  registerAutoComplete: boolean;
  /** Posted in the private thread instead of `registerConfirmationTemplate` when `registerAutoComplete` successfully grants the tier role. Same `{name}`/`{roleChannel}` placeholders. */
  autoRegisterConfirmationTemplate: string;
  /** Channel the Apollo bot posts event RSVP embeds in. Null = event attendance tracking is disabled. */
  apolloEventChannelId: string | null;
  /** The one voice channel every tracked event happens in. Null = tracking never activates even if an event is parsed. */
  eventVoiceChannelId: string | null;
}

/**
 * One user's row on the dashboard's Member Audit page — current or former
 * (`inGuild` tells them apart). Every date is an ISO UTC string or `null`
 * ("not tracked", not "never happened" — see `MemberRecord` on the backend);
 * render them with `formatAbsolute()`/`formatRelative()` (`../dateFormat`),
 * which convert to the viewer's local timezone.
 */
export interface MemberAuditEntry {
  userId: string;
  username: string;
  tag: string;
  displayName: string;
  nickname: string | null;
  avatarUrl: string;
  inGuild: boolean;
  joinedAt: string | null;
  rulesAcceptedAt: string | null;
  leftAt: string | null;
}

export interface MemberAuditResponse {
  inGuild: MemberAuditEntry[];
  left: MemberAuditEntry[];
}

/**
 * 'pending' = form submitted, awaiting staff action, private thread open.
 * 'registered' = staff granted the registration-tier role.
 * 'removed' = manually reset from the dashboard so the member can resubmit.
 * 'left' = the member left/was kicked/was banned while still 'pending'.
 */
export type RegistrationStatus = "pending" | "registered" | "removed" | "left";

/** A member who's ever posted a self-service registration-form submission, regardless of outcome — see `registerWatcher.ts`. */
export interface Registration {
  userId: string;
  username: string;
  displayName: string;
  nickname: string | null;
  avatarUrl: string;
  status: RegistrationStatus;
  /** ISO UTC — when the registration was submitted. */
  submittedAt: string | null;
  /** Jump link to the private thread. Null once resolved — the thread no longer exists. */
  threadUrl: string | null;
  /** Raw `name:` field value, as submitted. */
  submittedName: string | null;
  /** Raw `sso name:` field value, as submitted (the full value, not just the surname used for the nickname). */
  submittedSsoName: string | null;
  /** Raw `alter:` field value, as submitted. Null if the member left it out. */
  submittedAge: string | null;
}

/** What a member clicked on Apollo's event embed. */
export type ApolloRsvpChoice = "accepted" | "declined" | "tentative";

/** How a signup's `rawName` was resolved to a guild member. */
export type SignupMatchSource = "auto" | "manual" | "unmatched" | "ambiguous";

/** scheduled -> active -> completed, or -> cancelled if the Apollo message is deleted while still scheduled. */
export type ApolloEventStatus = "scheduled" | "active" | "completed" | "cancelled";

/** on_time/late/no_show/left_early are derived from the tracked voice channel; not_tracked means the bot missed the whole window or the voice channel wasn't configured/visible. Null means not yet computed — still scheduled, or the signup is 'declined' (never tracked). */
export type AttendanceStatus = "on_time" | "late" | "no_show" | "left_early" | "not_tracked";

/** One signed-up member on an `EventAttendance` entry. */
export interface EventSignup {
  id: number;
  /** As it appeared in Apollo's embed, exactly. */
  rawName: string;
  choice: ApolloRsvpChoice;
  userId: string | null;
  displayName: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  matchSource: SignupMatchSource;
  attendanceStatus: AttendanceStatus | null;
  firstJoinedAt: string | null;
  lastLeftAt: string | null;
  /** ISO UTC — set when this name disappears from a re-parsed embed after the event has gone active/completed. Null while still present. */
  withdrawnAt: string | null;
}

/** One Apollo-managed event with its full sign-up/attendance list — see `services/eventAttendance.ts` on the backend for the state machine and derivation rules. */
export interface EventAttendance {
  id: number;
  apolloEventId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  status: ApolloEventStatus;
  /** The bot was offline for some/all of this event's tracking window — timestamps may be approximate. */
  trackingIncomplete: boolean;
  /** Jump link to the original Apollo message. */
  messageUrl: string;
  voiceChannelId: string | null;
  signups: EventSignup[];
}
