import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// Same constraint as eventConflicts.test.ts: eventAttendanceRepository.ts
// can't be imported directly here (it opens the real data/bot.sqlite as a
// top-level side effect), so this mirrors the two new queries'/statement's
// exact SQL against a throwaway in-memory database.

function makeEventsDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      completed_at TEXT,
      channel_cleared_at TEXT
    );
  `);
  return db;
}

const SELECT_DUE_FOR_CLEANUP_SQL = `
  SELECT id FROM events WHERE status = 'completed' AND channel_cleared_at IS NULL AND completed_at <= ?
`;
const SELECT_PROTECTED_IN_CHANNEL_SQL = `
  SELECT id FROM events WHERE channel_id = ? AND status IN ('scheduled', 'active')
`;

function insert(
  db: Database.Database,
  overrides: Partial<{ channelId: string; status: string; completedAt: string | null; channelClearedAt: string | null }>,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO events (channel_id, status, completed_at, channel_cleared_at) VALUES (@channelId, @status, @completedAt, @channelClearedAt)`,
      )
      .run({
        channelId: overrides.channelId ?? "chan-1",
        status: overrides.status ?? "completed",
        completedAt: overrides.completedAt ?? "2026-01-01T00:00:00.000Z",
        channelClearedAt: overrides.channelClearedAt ?? null,
      }).lastInsertRowid,
  );
}

test("due-for-channel-cleanup SQL: an already-cleared event is never returned again", () => {
  const db = makeEventsDb();
  insert(db, { channelClearedAt: "2026-01-02T00:00:00.000Z" });
  const rows = db.prepare(SELECT_DUE_FOR_CLEANUP_SQL).all("2026-06-01T00:00:00.000Z");
  assert.deepEqual(rows, []);
});

test("due-for-channel-cleanup SQL: only completed events past the cutoff are returned", () => {
  const db = makeEventsDb();
  const due = insert(db, { completedAt: "2026-01-01T00:00:00.000Z" });
  insert(db, { completedAt: "2026-12-01T00:00:00.000Z" }); // not yet past cutoff
  insert(db, { status: "active", completedAt: null }); // not completed
  const rows = db.prepare(SELECT_DUE_FOR_CLEANUP_SQL).all("2026-06-01T00:00:00.000Z") as { id: number }[];
  assert.deepEqual(
    rows.map((r) => r.id),
    [due],
  );
});

test("protected-events-in-channel SQL: only scheduled/active events in the given channel are returned", () => {
  const db = makeEventsDb();
  const scheduled = insert(db, { channelId: "chan-1", status: "scheduled" });
  const active = insert(db, { channelId: "chan-1", status: "active" });
  insert(db, { channelId: "chan-1", status: "completed" });
  insert(db, { channelId: "chan-1", status: "cancelled" });
  insert(db, { channelId: "chan-2", status: "scheduled" }); // different channel
  const rows = db.prepare(SELECT_PROTECTED_IN_CHANNEL_SQL).all("chan-1") as { id: number }[];
  assert.deepEqual(
    rows.map((r) => r.id).sort((a, b) => a - b),
    [scheduled, active].sort((a, b) => a - b),
  );
});
