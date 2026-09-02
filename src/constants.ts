/**
 * Central home for magic numbers/strings used across the bot.
 * Grouping them here keeps intent documented in one place instead of
 * scattered inline literals.
 */

// --- Discord API ---
export const DISCORD_API_VERSION = "10";
export const DISCORD_FETCH_PAGE_SIZE = 100;
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
  "Heute feiern wir {userMention}! {everyoneMention} gratuliert {userNick}";
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
/** `{month}` is the (optionally font-styled — see utils/font.ts) month name; `{entries}` is the marker-formatted date/mention lines for that month — see `buildAnchorParts()`. */
export const DEFAULT_BIRTHDAY_ANCHOR_TEMPLATE = "**{month}**\n{entries}";
/** Discord's hard cap on a message's `content` length — the anchor message is paginated across multiple messages once the full list exceeds this. See `paginateAnchorParts()`. */
export const DISCORD_MESSAGE_MAX_LENGTH = 2000;

// --- Self-service registration form ---
/** `{name}` is the value pulled from the submitted form's `name:` line; `{roleChannel}` is a `#channel` mention of `roleSelectionChannelId`. See `registerWatcher.ts`. */
export const DEFAULT_REGISTER_CONFIRMATION_TEMPLATE =
  "Danke {name}! Du wirst in Kürze registriert. Bis dahin kannst du dir schon in {roleChannel} deine Rollen aussuchen.";
/** Matches a `name:`-labeled line anywhere in a register-form submission (case-insensitive) — see `parseRegisterForm()` in `registerWatcher.ts`. */
export const REGISTER_FORM_NAME_REGEX = /^\s*name\s*:\s*(.+)$/im;
/** Matches an `sso name:`-labeled line (case-insensitive) — its last whitespace-separated word becomes the lowercase surname half of the generated nickname. Anchored so a plain `name:` line never matches this. See `parseRegisterForm()` in `registerWatcher.ts`. */
export const REGISTER_FORM_SSO_NAME_REGEX = /^\s*sso\s*name\s*:\s*(.+)$/im;
/** Matches an `alter:`-labeled line (case-insensitive) — purely informational, shown on the dashboard's pending-registrations list but not used to build the nickname. Optional: a submission missing this still counts as valid. See `parseRegisterForm()` in `registerWatcher.ts`. */
export const REGISTER_FORM_ALTER_REGEX = /^\s*alter\s*:\s*(.+)$/im;
/** Prefixes every nickname the register-form flow generates — see `buildRegisterNickname()` in `registerWatcher.ts`. */
export const REGISTER_NICKNAME_EMOJI = "💙";
/** `{name}`/`{roleChannel}` — same placeholders as DEFAULT_REGISTER_CONFIRMATION_TEMPLATE. Posted instead of the normal template when `settings.registerAutoComplete` is on and the tier role was granted successfully. */
export const DEFAULT_AUTO_REGISTER_CONFIRMATION_TEMPLATE =
  "Willkommen {name}! Du bist jetzt vollständig registriert. Schau dir gerne schon in {roleChannel} deine Rollen an. Dieser Thread schließt sich in einer Stunde automatisch.";
/** How long the private thread stays open after an auto-completed registration before being deleted — see `sweepExpiredRegisterThreads()` in `registerWatcher.ts`. Not configurable by design. */
export const REGISTER_AUTO_THREAD_LIFETIME_MS = 60 * 60 * 1000;
/** How often the bot checks for auto-completed registration threads past their lifetime. */
export const REGISTER_THREAD_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
/** Discord's hard cap on a member's nickname length. */
export const DISCORD_NICKNAME_MAX_LENGTH = 32;

// --- Apollo event attendance ---
/** How often the bot checks for events that need to start/end tracking — see `sweepApolloEvents()` in `services/eventAttendance.ts`. */
export const APOLLO_EVENT_SWEEP_INTERVAL_MS = 30 * 1000;
/** Someone joining the voice channel this many ms after the event's start still counts as "on time" rather than "late" — 0 per the product decision (exact start time), documented here so the ±sweep-interval fuzz this implies is explicit rather than silently baked into the sweep cadence. */
export const APOLLO_EVENT_ON_TIME_GRACE_MS = 0;
/** Assumed event length when Apollo's embed only yields one timestamp (should be rare — Apollo normally gives both start and end). */
export const APOLLO_EVENT_DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
/** Matches the numeric event id in an apollo.fyi event link — the real link shape is `apollo.fyi/workspaces/<id>/events/<id>` (arbitrary path segments before the final `events/<id>` or short-form `e/<id>`), not `apollo.fyi/events/<id>` directly. See `parseApolloEventEmbed()` in `services/apolloEventParser.ts`. */
export const APOLLO_EVENT_URL_REGEX = /apollo\.fyi(?:\/[^/\s]+)*\/(?:e|events)\/(\d+)/i;
/** Matches a Discord timestamp token, e.g. `<t:1756832423:F>` — Apollo's "Time" field uses these for the event's start/end. */
export const DISCORD_TIMESTAMP_TOKEN_REGEX = /<t:(-?\d+)(?::[tTdDfFR])?>/g;
/** Fallback start/end source when timestamp tokens are missing — the `dates=` param on Apollo's "add to Google Calendar" link, e.g. `dates=20260902T165000Z/20260902T175000Z`. */
export const GOOGLE_CALENDAR_DATES_REGEX = /[?&]dates=(\d{8}T\d{6}Z)(?:%2F|\/)(\d{8}T\d{6}Z)/i;
/**
 * Embed field names (after stripping emoji/count-suffix and lowercasing —
 * see `normalizeFieldLabel()`) that identify an Apollo RSVP list, mapped to
 * the choice they represent. "Accepted"/"Declined"/"Tentative" are confirmed
 * against a real embed on this server; the German entries are still a guess
 * — see docs/EVENT_ATTENDANCE.md's caveat.
 *
 * "Waitlist" is a real, confirmed field too — it appears once an event has a
 * signup cap (shown as "Accepted (2/1)" — actual/limit — rather than a plain
 * count). Mapped to 'accepted' since a waitlisted member did click Accept,
 * just didn't make the cut; if that turns out to be the wrong call, give it
 * its own ApolloRsvpChoice value instead of merging it in here.
 */
export const APOLLO_RSVP_FIELD_LABELS: Record<string, "accepted" | "declined" | "tentative"> = {
  accepted: "accepted",
  zugesagt: "accepted",
  angenommen: "accepted",
  waitlist: "accepted",
  warteliste: "accepted",
  declined: "declined",
  abgesagt: "declined",
  abgelehnt: "declined",
  tentative: "tentative",
  vielleicht: "tentative",
  unentschlossen: "tentative",
};

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
