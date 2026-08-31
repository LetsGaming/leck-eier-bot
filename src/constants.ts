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
/** Cap on the dashboard's Find User page when listing everyone (no search query yet) — a real search is still capped at FIND_USER_RESULT_LIMIT. */
export const FIND_USER_LIST_LIMIT = 500;
/** Cap on how many former members the dashboard's Member Audit page returns (most-recently-left first) — the in-guild side is bounded by guild size instead. */
export const MEMBER_AUDIT_LEFT_LIMIT = 500;
/** Discord error code for "message is too old to bulk delete". */
export const DISCORD_ERROR_CODE_TOO_OLD_TO_DELETE = 50034;

/**
 * Upper bound for `/clear`'s `amount` option. `bulkDelete` handles most of
 * the work in batches of 100, but messages older than 14 days must fall
 * back to one delete call each with a throttling delay — at that worst
 * case, this cap keeps the command comfortably inside the ~15 minutes an
 * interaction's follow-up token stays valid for.
 */
export const MAX_CLEAR_AMOUNT = 1000;

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

// --- Self-service birthday registration ---
/** Matches a `D.M`/`DD.MM` (optionally `/` or `-` separated, optional trailing year) date anywhere in free text — see `parseSelfRegistrationDate` in services/birthdays.ts. */
export const SELF_BIRTHDAY_DATE_REGEX = /\b(\d{1,2})[.\/-](\d{1,2})\.?(?:[.\/-]\d{2,4})?\b/;
/**
 * Messages longer than this in the birthday channel are left alone even if
 * they contain something date-shaped — keeps casual chat ("see you at
 * 20.30") from being misread as a birthday registration. A real submission
 * is just the date, maybe with a couple of words around it.
 */
export const SELF_BIRTHDAY_MESSAGE_MAX_LENGTH = 50;

// --- Bot-managed birthday anchor message ---
/** `{month}` is the (optionally font-styled — see utils/font.ts) month name; `{entries}` is the marker-formatted date/mention lines for that month — see `renderAnchorMessage()`. */
export const DEFAULT_BIRTHDAY_ANCHOR_TEMPLATE = "**{month}**\n{entries}";
/** Discord's hard cap on a message's `content` length — the anchor message is paginated across multiple messages once the full list exceeds this. See `paginateAnchorParts()`. */
export const DISCORD_MESSAGE_MAX_LENGTH = 2000;

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
export const DISCORD_OAUTH_TOKEN_URL = "https://discord.com/api/oauth2/token";
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
  SetMyBirthday = "setmybirthday",
  ClearDm = "cleardm",
  Clear = "clear",
  FindUser = "finduser",
  ReactionRoles = "reactionroles",
}

/** How members interact with a panel to pick roles. See docs/REACTION_ROLES.md. Immutable after a panel is created. */
export enum SelectionType {
  Reactions = "reactions",
  Buttons = "buttons",
  Dropdown = "dropdown",
}

/** Only meaningful for a `managed` panel — an unmanaged (attached-to-existing-message) panel never touches message content. */
export enum PanelMessageType {
  Text = "text",
  Embed = "embed",
}

/** Discord hard caps: 5 buttons per action row, 5 rows per message. */
export const MAX_BUTTONS_PER_PANEL = 25;
/** Discord hard cap on a single select menu's option count. */
export const MAX_DROPDOWN_OPTIONS_PER_PANEL = 25;
