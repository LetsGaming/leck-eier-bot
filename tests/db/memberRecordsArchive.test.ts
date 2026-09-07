import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import Database from "better-sqlite3";

// archiveOldMemberRecords() itself isn't exercised directly here: it imports
// src/db/index.ts, which opens the real data/bot.sqlite file as a top-level
// import side effect (see commandPermissionGateMigration.test.ts's comment
// for the same constraint) — not something a unit test should trigger. This
// instead verifies, in isolation, the two things that function's correctness
// actually rests on: the cutoff SQL selecting the right rows, and the
// gzip+JSONL file format round-tripping the archived data losslessly.

function makeMemberRecordsDb(): Database.Database {
  const db = new Database(":memory:");
  // Mirrors the columns listArchivableMemberRecords()'s query reads from
  // (src/db/memberRecordsRepository.ts) — left_at/in_guild are the only ones
  // its WHERE clause touches.
  db.exec(`
    CREATE TABLE member_records (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      left_at TEXT,
      in_guild INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

const SELECT_ARCHIVABLE_SQL = `SELECT user_id FROM member_records WHERE left_at IS NOT NULL AND left_at <= ?`;

test("archivable-records cutoff: a member who left before the cutoff is selected", () => {
  const db = makeMemberRecordsDb();
  db.prepare("INSERT INTO member_records (user_id, username, left_at, in_guild) VALUES (?, ?, ?, 0)").run(
    "old-leaver",
    "OldLeaver",
    "2020-01-01T00:00:00.000Z",
  );

  const rows = db.prepare(SELECT_ARCHIVABLE_SQL).all("2021-01-01T00:00:00.000Z") as Array<{ user_id: string }>;
  assert.deepEqual(
    rows.map((r) => r.user_id),
    ["old-leaver"],
  );
  db.close();
});

test("archivable-records cutoff: a member who left after the cutoff is NOT selected", () => {
  const db = makeMemberRecordsDb();
  db.prepare("INSERT INTO member_records (user_id, username, left_at, in_guild) VALUES (?, ?, ?, 0)").run(
    "recent-leaver",
    "RecentLeaver",
    "2026-06-01T00:00:00.000Z",
  );

  const rows = db.prepare(SELECT_ARCHIVABLE_SQL).all("2021-01-01T00:00:00.000Z") as Array<{ user_id: string }>;
  assert.deepEqual(rows, []);
  db.close();
});

test("archivable-records cutoff: a current member (left_at NULL) is never selected regardless of cutoff", () => {
  const db = makeMemberRecordsDb();
  db.prepare("INSERT INTO member_records (user_id, username, left_at, in_guild) VALUES (?, ?, NULL, 1)").run(
    "current-member",
    "CurrentMember",
  );

  const rows = db.prepare(SELECT_ARCHIVABLE_SQL).all(new Date().toISOString()) as Array<{ user_id: string }>;
  assert.deepEqual(rows, []);
  db.close();
});

test("gzip+JSONL archive format round-trips the exact records written", () => {
  const records = [
    { userId: "a", username: "Alice", leftAt: "2020-01-01T00:00:00.000Z" },
    { userId: "b", username: "Bob", leftAt: "2020-02-01T00:00:00.000Z" },
  ];
  const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + "\n";

  const compressed = gzipSync(jsonl);
  const decompressed = gunzipSync(compressed).toString("utf-8");
  const parsed = decompressed
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));

  assert.deepEqual(parsed, records);
});
