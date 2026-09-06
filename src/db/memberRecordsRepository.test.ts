import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// listRecentMemberActivity() (src/db/memberRecordsRepository.ts) isn't
// exercised directly here — that module imports src/db/index.ts, which opens
// the real data/bot.sqlite file as a top-level import side effect (see
// commandPermissionGateMigration.test.ts's comment for the same constraint).
// This instead mirrors its exact SQL against a throwaway in-memory database —
// same convention as memberRecordsArchive.test.ts's cutoff-SQL tests.

function makeMemberRecordsDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE member_records (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      joined_at TEXT,
      rules_accepted_at TEXT,
      left_at TEXT,
      in_guild INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

const SELECT_RECENT_ACTIVITY_SQL = `
  SELECT user_id, display_name, event, at FROM (
    SELECT user_id, display_name, 'joined' AS event, joined_at AS at FROM member_records WHERE joined_at IS NOT NULL
    UNION ALL
    SELECT user_id, display_name, 'left' AS event, left_at AS at FROM member_records WHERE left_at IS NOT NULL
    UNION ALL
    SELECT user_id, display_name, 'rulesAccepted' AS event, rules_accepted_at AS at FROM member_records WHERE rules_accepted_at IS NOT NULL
  )
  ORDER BY at DESC
  LIMIT ?
`;

interface Row {
  user_id: string;
  display_name: string;
  event: "joined" | "left" | "rulesAccepted";
  at: string;
}

test("listRecentMemberActivity SQL: a member with all three timestamps produces one row per event type", () => {
  const db = makeMemberRecordsDb();
  db.prepare(
    "INSERT INTO member_records (user_id, username, display_name, joined_at, rules_accepted_at, left_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("1", "alice", "Alice", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z");

  const rows = db.prepare(SELECT_RECENT_ACTIVITY_SQL).all(10) as Row[];
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.event),
    ["left", "rulesAccepted", "joined"],
  );
});

test("listRecentMemberActivity SQL: a null timestamp produces no row for that event type", () => {
  const db = makeMemberRecordsDb();
  db.prepare("INSERT INTO member_records (user_id, username, display_name, joined_at) VALUES (?, ?, ?, ?)").run(
    "2",
    "bob",
    "Bob",
    "2026-01-01T00:00:00.000Z",
  );

  const rows = db.prepare(SELECT_RECENT_ACTIVITY_SQL).all(10) as Row[];
  assert.deepEqual(rows, [{ user_id: "2", display_name: "Bob", event: "joined", at: "2026-01-01T00:00:00.000Z" }]);
});

test("listRecentMemberActivity SQL: rows are ordered most-recent-first across every member/event type", () => {
  const db = makeMemberRecordsDb();
  db.prepare("INSERT INTO member_records (user_id, username, display_name, joined_at) VALUES (?, ?, ?, ?)").run(
    "old",
    "old",
    "Old",
    "2020-01-01T00:00:00.000Z",
  );
  db.prepare("INSERT INTO member_records (user_id, username, display_name, joined_at) VALUES (?, ?, ?, ?)").run(
    "new",
    "new",
    "New",
    "2026-01-01T00:00:00.000Z",
  );

  const rows = db.prepare(SELECT_RECENT_ACTIVITY_SQL).all(10) as Row[];
  assert.deepEqual(
    rows.map((r) => r.user_id),
    ["new", "old"],
  );
});

test("listRecentMemberActivity SQL: limit caps the total rows across all event types combined, not per type", () => {
  const db = makeMemberRecordsDb();
  db.prepare(
    "INSERT INTO member_records (user_id, username, display_name, joined_at, rules_accepted_at, left_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("1", "alice", "Alice", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z");

  const rows = db.prepare(SELECT_RECENT_ACTIVITY_SQL).all(2) as Row[];
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.event),
    ["left", "rulesAccepted"],
  );
});
