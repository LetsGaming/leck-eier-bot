/**
 * Central home for magic numbers/strings used across the bot.
 * Grouping them here keeps intent documented in one place instead of
 * scattered inline literals.
 */

// --- Discord API ---
export const DISCORD_API_VERSION = "10";
export const DISCORD_FETCH_PAGE_SIZE = 100;
export const BIRTHDAY_LIST_SCAN_LIMIT = 50;
export const FIND_USER_RESULT_LIMIT = 15;
/** Discord error code for "message is too old to bulk delete". */
export const DISCORD_ERROR_CODE_TOO_OLD_TO_DELETE = 50034;

// --- Rate-limit friendly delays (ms) ---
export const MEMBER_FETCH_DELAY_MS = 120;
export const MESSAGE_DELETE_DELAY_MS = 250;
export const DM_DELETE_DELAY_MS = 500;
export const AUDIT_LOG_SYNC_DELAY_MS = 2000;
export const AUDIT_LOG_RECENT_WINDOW_MS = 10_000;
export const PAGINATION_TIMEOUT_MS = 60_000;

// --- Birthday list parsing ---
/** Marks a line in the birthday announcement message as a birthday entry. */
export const BIRTHDAY_LIST_MARKER = "ღ:";
export const DEFAULT_BIRTHDAY_TEMPLATE =
  "Today we celebrate {userMention}! {everyoneMention} say gratulate {userNick}";
/** Runs every day at midnight server time. Also the default for the DB-stored `birthdayCron` setting. */
export const DAILY_MIDNIGHT_CRON = "0 0 * * *";

// --- Reaction roles ---
/**
 * How long a bot-initiated reaction removal (unique-mode swaps,
 * `removeReaction` panels) is remembered before the corresponding
 * `messageReactionRemove` event is treated as user-initiated again.
 */
export const REACTION_SELF_ECHO_TTL_MS = 10_000;

// --- Web dashboard ---
export const WEB_SESSION_COOKIE_NAME = "leb_session";
export const WEB_OAUTH_STATE_COOKIE_NAME = "leb_oauth_state";
export const WEB_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** How long a login attempt has to complete the Discord OAuth2 round trip (authorize + any 2FA/consent) before its state cookie expires. */
export const WEB_OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes
export const DISCORD_OAUTH_AUTHORIZE_URL = "https://discord.com/api/oauth2/authorize";
export const DISCORD_OAUTH_TOKEN_URL = "https://discord.com/oauth2/token";
export const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

// --- Logging ---
export const LOG_RETENTION_DAYS = "14d";
export const LOG_MAX_FILE_SIZE = "20m";

export enum EmbedColor {
  Default = 0x00bfff,
  Success = 0x55ff55,
  Error = 0xff5555,
  Info = 0x3498db,
}

export enum CommandPermission {
  /** Anyone can use the command. */
  None = "none",
  /** Bot owner or a member with Administrator permission. */
  Admin = "admin",
  /** Bot owner only. */
  Owner = "owner",
}

export enum CommandName {
  CheckBirthday = "checkbirthday",
  ClearBirthdayChannel = "clearbirthdaychannel",
  RefreshBirthdays = "refreshbirthdays",
  SetBirthdayMessage = "setbirthdaymessage",
  TestBirthdayMessage = "testbirthdaymessage",
  ClearDm = "cleardm",
  FindUser = "finduser",
  ReactionRoles = "reactionroles",
}

/** How reacting/un-reacting affects role membership for a panel. See docs/REACTION_ROLES.md. */
export enum ReactionRoleMode {
  /** React grants the role, un-react revokes it. */
  Toggle = "toggle",
  /** Only one mapping in the panel may be held at a time; picking a new one revokes the previous. */
  Unique = "unique",
  /** React grants the role; un-reacting never revokes it. */
  Verify = "verify",
}
