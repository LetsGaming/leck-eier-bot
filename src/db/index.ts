import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_BIRTHDAY_TEMPLATE } from "../constants.js";
import { runMigrations } from "./migrations.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// data/ always lives at the project root, one level above whichever of
// src (dev) or dist (prod) is currently executing — unless DATA_DIR
// overrides it, which is how scripts/dev-up.mjs gives each concurrent dev
// session (and its seeded mock data) its own isolated SQLite file instead
// of colliding on the shared one.
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, "..", "..", "data");
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "bot.sqlite");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
// Defense-in-depth: this app runs as a single Node.js process with one
// better-sqlite3 connection shared by the bot and the dashboard's Fastify
// server — there is no live cross-process contention today. This pragma
// protects against a future second writer (maintenance script, external sqlite3
// CLI inspection during uptime, or a split deployment), not an active problem.
db.pragma("busy_timeout = 5000");

// Schema is managed by Drizzle (src/db/schema.ts is the source of truth; generated SQL lives
// under src/db/migrations/, never hand-edited — see docs/DATABASE.md). runMigrations() is safe
// to call on every process start: it no-ops once the DB is current.
runMigrations(db);

// Two tables are CHECK (id = 1) singletons that the app always expects exactly one row in
// (getSettings() and the command-registration-hash lookup both assume this — see
// settingsRepository.ts's getSettings() doc comment). Drizzle migrations manage schema, not
// data, so seeding these rows on first boot is application bootstrap, not a migration step.
db.prepare("INSERT OR IGNORE INTO settings (id, birthday_template) VALUES (1, ?)").run(DEFAULT_BIRTHDAY_TEMPLATE);
db.prepare("INSERT OR IGNORE INTO command_registration_state (id, definitions_hash) VALUES (1, NULL)").run();
