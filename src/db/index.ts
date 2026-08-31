import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_BIRTHDAY_TEMPLATE, DAILY_MIDNIGHT_CRON, DEFAULT_BIRTHDAY_ANCHOR_TEMPLATE } from "../constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// data/ always lives at the project root, one level above whichever of
// src (dev) or dist (prod) is currently executing.
const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "bot.sqlite");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/**
 * Schema migrations, applied in order and tracked via SQLite's built-in
 * `user_version` pragma. Each function receives the open connection and must
 * be idempotent-safe to add (never destructive) — once a migration ships it
 * is never edited, only appended to. Add new schema changes as a new entry
 * at the end of this array.
 */
const MIGRATIONS: Array<(d: Database.Database) => void> = [
  // v1: original schema (birthdays + singleton settings row).
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS birthdays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        mention TEXT NOT NULL,
        user_id TEXT,
        name TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_birthdays_date ON birthdays(date);

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        birthday_template TEXT NOT NULL,
        first_birthday_message_id TEXT
      );
    `);
    d.prepare(
      "INSERT OR IGNORE INTO settings (id, birthday_template) VALUES (1, ?)",
    ).run(DEFAULT_BIRTHDAY_TEMPLATE);
  },
  // v2: give the birthday channel/message, cron, leave notifications, and
  // per-command overrides a DB home so the dashboard can edit them live —
  // these were never meant to be bootstrap-only env var material.
  (d) => {
    d.exec(`
      ALTER TABLE settings ADD COLUMN birthday_list_channel_id TEXT;
      ALTER TABLE settings ADD COLUMN birthday_list_message_id TEXT;
      ALTER TABLE settings ADD COLUMN birthday_cron TEXT NOT NULL DEFAULT '${DAILY_MIDNIGHT_CRON}';
      ALTER TABLE settings ADD COLUMN leave_notifications_enabled INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE IF NOT EXISTS command_settings (
        name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        guild_only INTEGER NOT NULL DEFAULT 1
      );
    `);
  },
  // v3: reaction-role panels + their emoji->role mappings.
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS reaction_role_panels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        managed INTEGER NOT NULL DEFAULT 1,
        mode TEXT NOT NULL DEFAULT 'toggle' CHECK (mode IN ('toggle', 'unique', 'verify')),
        remove_reaction INTEGER NOT NULL DEFAULT 0,
        title TEXT,
        description TEXT,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_panels_message
        ON reaction_role_panels(message_id) WHERE message_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS reaction_role_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        panel_id INTEGER NOT NULL REFERENCES reaction_role_panels(id) ON DELETE CASCADE,
        emoji_name TEXT NOT NULL,
        emoji_id TEXT,
        role_id TEXT NOT NULL,
        label TEXT,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_map_emoji
        ON reaction_role_mappings(panel_id, emoji_id, emoji_name);
    `);
  },
  // v4: dashboard login sessions.
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS web_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        avatar TEXT,
        is_owner INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  },
  // v5: selection mechanism (reactions/buttons/dropdown), plain-text vs
  // embed messages, a simpler allow_multiple/removable model replacing
  // `mode`, per-panel allowed-role gating, and the draft-until-sent
  // workflow. `mode`/`remove_reaction` are left in place rather than
  // dropped — remove_reaction is still meaningful (reactions-only), and
  // dropping columns is more failure-prone than just not reading `mode`
  // anymore.
  (d) => {
    d.exec(`
      ALTER TABLE reaction_role_panels ADD COLUMN selection_type TEXT NOT NULL DEFAULT 'reactions';
      ALTER TABLE reaction_role_panels ADD COLUMN message_type TEXT NOT NULL DEFAULT 'embed';
      ALTER TABLE reaction_role_panels ADD COLUMN allow_multiple INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE reaction_role_panels ADD COLUMN removable INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE reaction_role_panels ADD COLUMN allowed_role_ids TEXT;
      ALTER TABLE reaction_role_panels ADD COLUMN sent INTEGER NOT NULL DEFAULT 0;
    `);
    // Carry existing panels' behavior forward under the new model, and
    // treat anything already posted as already "sent" so upgrading doesn't
    // pull a live panel back into an unsent draft state.
    d.exec(`
      UPDATE reaction_role_panels SET
        allow_multiple = CASE WHEN mode = 'toggle' THEN 1 ELSE 0 END,
        removable = CASE WHEN mode = 'verify' THEN 0 ELSE 1 END,
        sent = CASE WHEN message_id IS NOT NULL THEN 1 ELSE 0 END;
    `);

    // Buttons/dropdown options don't require an emoji (a plain labeled
    // button is valid), but emoji_name was NOT NULL from v3. SQLite has no
    // ALTER COLUMN, so relax it the standard way: rebuild the table. Safe
    // to do with foreign_keys as-is — mappings is the child side of the FK
    // (references reaction_role_panels), so recreating it never orphans a
    // parent row.
    d.exec(`
      CREATE TABLE reaction_role_mappings_v5 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        panel_id INTEGER NOT NULL REFERENCES reaction_role_panels(id) ON DELETE CASCADE,
        emoji_name TEXT,
        emoji_id TEXT,
        role_id TEXT NOT NULL,
        label TEXT,
        position INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO reaction_role_mappings_v5
        SELECT id, panel_id, emoji_name, emoji_id, role_id, label, position FROM reaction_role_mappings;
      DROP TABLE reaction_role_mappings;
      ALTER TABLE reaction_role_mappings_v5 RENAME TO reaction_role_mappings;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_map_emoji
        ON reaction_role_mappings(panel_id, emoji_id, emoji_name);
    `);
  },
  // v6: a required, always-present panel name for identifying it in the
  // dashboard/`/reactionroles list` — independent of `title`, which only
  // ever applied to embed-type managed panels. Backfilled from `title`
  // where one exists, else a generic placeholder.
  (d) => {
    d.exec(`ALTER TABLE reaction_role_panels ADD COLUMN name TEXT NOT NULL DEFAULT '';`);
    d.exec(`
      UPDATE reaction_role_panels
      SET name = CASE
        WHEN title IS NOT NULL AND title != '' THEN title
        WHEN managed = 0 THEN 'Existing message'
        ELSE 'Panel #' || id
      END
      WHERE name = '';
    `);
  },
  // v7: self-service birthday registration (`/setmybirthday` and posting a
  // date directly in the birthday channel), alongside the existing
  // manually-maintained announcement list. `source` distinguishes a row
  // parsed from that list ('list') from one a member registered themselves
  // ('self') so a list re-scan (`replaceAllBirthdays`) never wipes out a
  // self-registration — see birthdaysRepository.ts. `idx_birthdays_user` is
  // a plain (non-partial) unique index: SQLite already treats every NULL as
  // distinct for uniqueness purposes, so list-parsed entries without a
  // resolvable user_id (free-text @name that didn't match a member) can
  // still coexist as multiple NULLs, while self-registration can upsert by
  // user_id via a plain `ON CONFLICT(user_id)` target — a partial index
  // would additionally require the ON CONFLICT clause's WHERE to
  // syntactically match the index's, which just adds fragility for no
  // benefit here. birthday_mod_channel_id is where the bot posts a
  // heads-up for each new registration.
  (d) => {
    d.exec(`
      ALTER TABLE birthdays ADD COLUMN source TEXT NOT NULL DEFAULT 'list';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_birthdays_user ON birthdays(user_id);
      ALTER TABLE settings ADD COLUMN birthday_mod_channel_id TEXT;
    `);
  },
  // v8: dashboard RBAC — a session now carries a `role`
  // ('bot-owner' | 'guild-owner' | 'admin', see WebRole in types.ts)
  // instead of just an `is_owner` flag, resolved at login time in
  // web/auth.ts. `is_owner` is left in place unused rather than dropped
  // (SQLite migrations here are additive-only — see the note above).
  // NOTE: this defaults every pre-existing session row's role to 'admin'
  // regardless of `is_owner` — including a bot owner's — since a session
  // predating this migration has no better answer available here. v11
  // backfills that mistake; don't reason about "short-lived enough not to
  // matter" the way an earlier version of this comment did — 7 days is
  // plenty of time for it to matter.
  (d) => {
    d.exec(`ALTER TABLE web_sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';`);
  },
  // v9: lets the bot own the birthday announcement message end to end
  // instead of an admin hand-maintaining it — see services/birthdays.ts's
  // buildAnchorParts()/syncAnchorMessage(). birthday_self_registration_enabled
  // gates both self-registration paths from v7 (previously always on) and is
  // a prerequisite for birthday_bot_manages_anchor (enforced in
  // web/routes/birthdaySettings.ts, not the DB): with self-registration off,
  // nothing but the configured list message's own author ever adds an
  // entry, so the bot has no business rewriting that message. The heading
  // template lets that part be restyled without a code change and ships
  // with a working default; its font comes from the global font_map added
  // in v10 below.
  (d) => {
    d.exec(`
      ALTER TABLE settings ADD COLUMN birthday_self_registration_enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE settings ADD COLUMN birthday_bot_manages_anchor INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE settings ADD COLUMN birthday_anchor_template TEXT NOT NULL DEFAULT '${DEFAULT_BIRTHDAY_ANCHOR_TEMPLATE}';
    `);
  },
  // v10: a single global "font" (a pasted stylized Unicode alphabet — see
  // utils/font.ts) set once on the dashboard's Settings page, instead of
  // each message-generating feature needing its own pasted copy. Each
  // feature that can render through it keeps its own opt-in flag — the
  // birthday anchor message's `{month}` heading, the daily birthday
  // announcement, and (on `reaction_role_panels`) a given panel's
  // title/text/labels — so a font can be set once and forgotten while
  // still being off by default everywhere it hasn't been turned on.
  (d) => {
    d.exec(`
      ALTER TABLE settings ADD COLUMN font_map TEXT;
      ALTER TABLE settings ADD COLUMN birthday_anchor_use_font INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE settings ADD COLUMN birthday_announcement_use_font INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE reaction_role_panels ADD COLUMN use_font INTEGER NOT NULL DEFAULT 0;
    `);
  },
  // v11: fixes a v8 data bug — that migration defaulted every *existing*
  // session row's new `role` column to 'admin', even ones with
  // `is_owner = 1`, instead of backfilling from it (the reasoning at the
  // time — "sessions are short-lived, so old rows age out on their own" —
  // was wrong: a session created just before v8 ran keeps the wrong role
  // for up to its full 7-day TTL, not until the next login). A fresh login
  // was never affected — resolveDashboardRole() in web/auth.ts always
  // computed the role correctly — only a session that already existed at
  // the moment v8 ran.
  (d) => {
    d.exec(`UPDATE web_sessions SET role = 'bot-owner' WHERE is_owner = 1 AND role != 'bot-owner';`);
  },
  // v12: birthday self-registration and the bot-managed anchor message are
  // now required to move together (enforced in web/routes/birthdaySettings.ts)
  // — self-registration active while the bot *isn't* rendering the anchor
  // message is a dead end, since a self-registered entry never shows up
  // anywhere visible otherwise. v9 defaulted self-registration to 1 and
  // bot-managed-anchor to 0, so every install (fresh or upgraded) is
  // currently in that now-invalid combination; this turns self-registration
  // back off wherever the bot isn't managing the anchor, rather than the
  // more invasive alternative of turning bot-management on for everyone.
  // Deliberately not a `birthday_self_registration_enabled` column-default
  // change (SQLite can't ALTER a column default without a table rebuild) —
  // this UPDATE runs unconditionally after v9's INSERT on every install,
  // fresh or upgraded, so it doubles as that new effective default.
  (d) => {
    d.exec(`
      UPDATE settings SET birthday_self_registration_enabled = 0
      WHERE birthday_self_registration_enabled = 1 AND birthday_bot_manages_anchor = 0;
    `);
  },
  // v13: the dashboard's Member Audit page — one row per user ever seen,
  // current members and former ones alike (`in_guild` tells them apart).
  // `joined_at`/`rules_accepted_at`/`left_at` are all recorded by the bot
  // itself as each event happens (services/memberRecords.ts), not read back
  // from Discord after the fact — Discord doesn't expose a member's rules-
  // acceptance timestamp or a former member's join/leave history at all, so
  // this table *is* the only record of them. `joined_at` is backfilled once
  // at every startup from the live member cache for anyone already in the
  // guild (Discord does still expose current members' join dates), but
  // `rules_accepted_at` has no equivalent backfill — it's only ever known
  // from having observed registerGateRoleId (the rules-message reaction-
  // role) being newly granted, live, so it reads as "not tracked" (null)
  // for anyone who got that role before this shipped.
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS member_records (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar TEXT,
        joined_at TEXT,
        rules_accepted_at TEXT,
        left_at TEXT,
        in_guild INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_member_records_in_guild ON member_records(in_guild);
    `);
  },
  // v14: drops web_sessions.is_owner, which v8's comment already called
  // dead ("left in place unused rather than dropped") but never actually
  // removed — it's still `NOT NULL` with no default, and createSession()
  // (sessionsRepository.ts) hasn't supplied it since v8 switched to `role`.
  // Every fresh login INSERT has been failing the NOT NULL constraint ever
  // since; only sessions that predate v8 still work. SQLite can't drop a
  // NOT NULL column via plain ALTER, hence the rebuild-and-swap.
  (d) => {
    d.exec(`
      CREATE TABLE web_sessions_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        avatar TEXT,
        role TEXT NOT NULL DEFAULT 'admin',
        expires_at INTEGER NOT NULL
      );
      INSERT INTO web_sessions_new (id, user_id, username, avatar, role, expires_at)
        SELECT id, user_id, username, avatar, role, expires_at FROM web_sessions;
      DROP TABLE web_sessions;
      ALTER TABLE web_sessions_new RENAME TO web_sessions;
    `);
  },
  // v15: the register-channel role swap — a member holds a reaction-granted
  // "register gate" role only so they can see the #register channel; once
  // staff manually grant them the lowest membership tier role at
  // registration, the gate role is stripped (memberEvents.ts) so the
  // channel disappears for them. registration_tier_role_id is deliberately
  // the *lowest* tier only, not "any member role" — later tier promotions
  // swap between higher roles and must never re-trigger this.
  (d) => {
    d.exec(`
      ALTER TABLE settings ADD COLUMN register_gate_role_id TEXT;
      ALTER TABLE settings ADD COLUMN registration_tier_role_id TEXT;
    `);
  },
  // v16: a one-time note shown above all the month blocks in the bot-managed
  // anchor message (e.g. "use /setmybirthday to register!") — distinct from
  // birthday_anchor_template, which repeats per month. Always rendered
  // plain (never through fontMap), and omitted entirely when unset.
  (d) => {
    d.exec(`ALTER TABLE settings ADD COLUMN birthday_anchor_intro TEXT;`);
  },
  // v17: the bot-managed anchor message can now span multiple Discord
  // messages (each capped at DISCORD_MESSAGE_MAX_LENGTH) instead of
  // silently failing to update once the full birthday list outgrows one —
  // see paginateAnchorParts()/syncAnchorMessage() in services/birthdays.ts.
  // `position` orders the chain; `birthday_list_message_id` on `settings`
  // is left untouched (and untouched by this migration) since it's shared
  // with the *other*, manually-maintained list mode — only seed this new
  // table from it when bot-managed mode is actually the one that produced
  // that message id, so an admin's manually-maintained message never gets
  // mistaken for (and later edited/deleted as) a bot-owned anchor chunk.
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS birthday_anchor_messages (
        position INTEGER PRIMARY KEY,
        message_id TEXT NOT NULL
      );
    `);
    const row = d
      .prepare("SELECT birthday_list_message_id, birthday_bot_manages_anchor FROM settings WHERE id = 1")
      .get() as { birthday_list_message_id: string | null; birthday_bot_manages_anchor: number } | undefined;
    if (row?.birthday_bot_manages_anchor === 1 && row.birthday_list_message_id) {
      d.prepare("INSERT INTO birthday_anchor_messages (position, message_id) VALUES (0, ?)").run(
        row.birthday_list_message_id,
      );
    }
  },
  // v18: each chunk in the anchor chain now records which months (and,
  // whichever chunk carries it, the intro — stored as the literal key
  // "intro") it renders, comma-separated (e.g. "intro,1,2,3"). This lets
  // syncAnchorMessage() keep a month pinned to the same message across
  // syncs instead of re-flowing (and re-editing) every later chunk whenever
  // an earlier month's entry count changes — see paginateAnchorParts()'s
  // stability bias in services/birthdays.ts. Empty string (existing rows
  // from before this migration) means "unknown assignment", which the
  // packer treats as no stability constraint on the first run after
  // upgrade.
  (d) => {
    d.exec(`ALTER TABLE birthday_anchor_messages ADD COLUMN months TEXT NOT NULL DEFAULT '';`);
  },
  // v19: birthday self-registration and the bot-managed anchor message are
  // no longer optional — the bot now owns the whole feature end to end (no
  // more hand-maintained announcement-message mode). The columns that used
  // to gate this (birthday_self_registration_enabled, birthday_bot_manages_anchor)
  // are left in the schema unread rather than dropped (see the additive-only
  // note above) but are backfilled to their new always-on effective value so
  // the data isn't left contradicting what the code now does.
  (d) => {
    d.exec(`
      UPDATE settings SET birthday_self_registration_enabled = 1, birthday_bot_manages_anchor = 1 WHERE id = 1;
    `);
  },
  // v20: which signal counts as "rules accepted" is now a toggle instead of
  // hardcoded — role-based (registerGateRoleId newly granted) by default,
  // since that's this bot's own rules-message reaction-role mechanism;
  // Discord's native membership-screening `pending` flag is opt-in for
  // guilds that actually use that feature instead. See
  // recordRulesAcceptedIfJustVerified() in services/memberRecords.ts.
  (d) => {
    d.exec(`ALTER TABLE settings ADD COLUMN rules_accepted_use_discord_screening INTEGER NOT NULL DEFAULT 0;`);
  },
];

const currentVersion = db.pragma("user_version", { simple: true }) as number;
for (let v = currentVersion; v < MIGRATIONS.length; v++) {
  db.transaction(() => {
    MIGRATIONS[v]!(db);
    db.pragma(`user_version = ${v + 1}`);
  })();
}
