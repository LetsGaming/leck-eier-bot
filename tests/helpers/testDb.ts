import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";

/**
 * A fresh, fully-migrated in-memory database for tests that need the real schema without
 * touching disk or the shared `data/bot.sqlite` — see docs/DATABASE.md. Replaces the old
 * pattern of hand-copying `CREATE TABLE` statements into a `:memory:` database (which drifted
 * from the real schema over time); this instead runs the exact same generated migrations the
 * app itself applies.
 */
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}
