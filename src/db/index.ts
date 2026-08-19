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
  // (SQLite migrations here are additive-only — see the note
  // above); sessions are short-lived (7-day TTL) so old rows age out on
  // their own instead of needing a backfill.
  (d) => {
    d.exec(`ALTER TABLE web_sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';`);
  },
  // v9: lets the bot own the birthday announcement message end to end
  // instead of an admin hand-maintaining it — see services/birthdays.ts's
  // renderAnchorMessage()/syncAnchorMessage(). birthday_self_registration_enabled
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
];

const currentVersion = db.pragma("user_version", { simple: true }) as number;
for (let v = currentVersion; v < MIGRATIONS.length; v++) {
  db.transaction(() => {
    MIGRATIONS[v]!(db);
    db.pragma(`user_version = ${v + 1}`);
  })();
}
