import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// listSignupsForUser() (src/db/eventAttendanceRepository.ts) isn't exercised
// directly here — that module imports src/db/index.ts, which opens the real
// data/bot.sqlite file as a top-level import side effect (see
// commandPermissionGateMigration.test.ts's comment for the same constraint).
// This instead mirrors its exact join SQL against a throwaway in-memory
// database — same convention as memberRecordsArchive.test.ts's cutoff-SQL
// tests.

function makeEventsDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE apollo_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      starts_at TEXT NOT NULL
    );
    CREATE TABLE apollo_event_signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      raw_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      choice TEXT NOT NULL,
      user_id TEXT,
      match_source TEXT NOT NULL,
      withdrawn_at TEXT,
      attendance_status TEXT,
      first_joined_at TEXT,
      last_left_at TEXT,
      late_minutes INTEGER,
      early_minutes INTEGER
    );
  `);
  return db;
}

const SELECT_SIGNUPS_FOR_USER_SQL = `
  SELECT s.id, s.event_id, s.raw_name, s.normalized_name, s.choice, s.user_id, s.match_source, s.withdrawn_at,
         s.attendance_status, s.first_joined_at, s.last_left_at, s.late_minutes, s.early_minutes,
         e.title AS event_title, e.starts_at AS event_starts_at
  FROM apollo_event_signups s
  JOIN apollo_events e ON e.id = s.event_id
  WHERE s.user_id = ?
  ORDER BY e.starts_at DESC
`;

interface Row {
  id: number;
  event_id: number;
  user_id: string | null;
  event_title: string;
  event_starts_at: string;
}

function insertEvent(db: Database.Database, title: string, startsAt: string): number {
  return Number(db.prepare("INSERT INTO apollo_events (title, starts_at) VALUES (?, ?)").run(title, startsAt).lastInsertRowid);
}

function insertSignup(db: Database.Database, eventId: number, userId: string | null, choice = "accepted"): void {
  db.prepare(
    "INSERT INTO apollo_event_signups (event_id, raw_name, normalized_name, choice, user_id, match_source) VALUES (?, 'Name', 'name', ?, ?, 'manual')",
  ).run(eventId, choice, userId);
}

test("listSignupsForUser SQL: returns only this user's signups, joined with event title/start", () => {
  const db = makeEventsDb();
  const eventId = insertEvent(db, "Raid Night", "2026-06-01T20:00:00.000Z");
  insertSignup(db, eventId, "target-user");
  insertSignup(db, eventId, "someone-else");

  const rows = db.prepare(SELECT_SIGNUPS_FOR_USER_SQL).all("target-user") as Row[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.user_id, "target-user");
  assert.equal(rows[0]!.event_title, "Raid Night");
  assert.equal(rows[0]!.event_starts_at, "2026-06-01T20:00:00.000Z");
});

test("listSignupsForUser SQL: orders by event start descending across multiple events", () => {
  const db = makeEventsDb();
  const older = insertEvent(db, "Older Event", "2026-01-01T00:00:00.000Z");
  const newer = insertEvent(db, "Newer Event", "2026-06-01T00:00:00.000Z");
  insertSignup(db, older, "user-1");
  insertSignup(db, newer, "user-1");

  const rows = db.prepare(SELECT_SIGNUPS_FOR_USER_SQL).all("user-1") as Row[];
  assert.deepEqual(
    rows.map((r) => r.event_title),
    ["Newer Event", "Older Event"],
  );
});

test("listSignupsForUser SQL: a user with no signups gets an empty array", () => {
  const db = makeEventsDb();
  const eventId = insertEvent(db, "Some Event", "2026-01-01T00:00:00.000Z");
  insertSignup(db, eventId, "someone-else");

  const rows = db.prepare(SELECT_SIGNUPS_FOR_USER_SQL).all("nobody") as Row[];
  assert.deepEqual(rows, []);
});
