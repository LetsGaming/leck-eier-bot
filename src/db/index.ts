import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_BIRTHDAY_TEMPLATE, DAILY_MIDNIGHT_CRON } from "../constants.js";

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
];

const currentVersion = db.pragma("user_version", { simple: true }) as number;
for (let v = currentVersion; v < MIGRATIONS.length; v++) {
  db.transaction(() => {
    MIGRATIONS[v]!(db);
    db.pragma(`user_version = ${v + 1}`);
  })();
}
