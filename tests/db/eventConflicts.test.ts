import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { dateKeyInTimezone } from "../../src/utils/timezone.js";

// services/eventConflicts.ts can't be imported directly here — it pulls in
// src/db/eventAttendanceRepository.ts, which pulls in src/db/index.ts, which
// opens the real data/bot.sqlite file as a top-level import side effect
// (same constraint documented in eventAttendanceRepository.test.ts). This
// mirrors listNonCancelledEventsFrom()'s exact SQL against a throwaway
// in-memory database, and exercises dateKeyInTimezone() (no DB side effect,
// safe to import directly) as findEventConflicts() itself uses it.

const TZ = "Europe/Berlin";

function makeEventsDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled'
    );
  `);
  return db;
}

const SELECT_NON_CANCELLED_FROM_SQL = `
  SELECT id, title, starts_at FROM events WHERE status != 'cancelled' AND starts_at >= ? ORDER BY starts_at ASC
`;

function insert(db: Database.Database, overrides: Partial<{ title: string; startsAt: string; status: string }>): number {
  return Number(
    db
      .prepare(`INSERT INTO events (title, starts_at, status) VALUES (@title, @startsAt, @status)`)
      .run({
        title: overrides.title ?? "Event",
        startsAt: overrides.startsAt ?? "2026-09-23T18:00:00.000Z",
        status: overrides.status ?? "scheduled",
      }).lastInsertRowid,
  );
}

test("non-cancelled-events-from SQL: a cancelled event is excluded", () => {
  const db = makeEventsDb();
  insert(db, { status: "cancelled" });
  const rows = db.prepare(SELECT_NON_CANCELLED_FROM_SQL).all("2026-01-01T00:00:00.000Z");
  assert.deepEqual(rows, []);
});

test("non-cancelled-events-from SQL: scheduled/active/completed events are all included", () => {
  const db = makeEventsDb();
  const ids = [insert(db, { status: "scheduled" }), insert(db, { status: "active" }), insert(db, { status: "completed" })];
  const rows = db.prepare(SELECT_NON_CANCELLED_FROM_SQL).all("2026-01-01T00:00:00.000Z") as { id: number }[];
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    ids.sort(),
  );
});

test("non-cancelled-events-from SQL: excludes events before fromIso", () => {
  const db = makeEventsDb();
  insert(db, { startsAt: "2025-01-01T00:00:00.000Z" });
  const rows = db.prepare(SELECT_NON_CANCELLED_FROM_SQL).all("2026-01-01T00:00:00.000Z");
  assert.deepEqual(rows, []);
});

test("dateKeyInTimezone-based matching: 01:30 local (past midnight) keys to the local calendar day, not the UTC one", () => {
  const startsAt = "2026-09-23T23:30:00.000Z"; // 01:30 CEST on the 24th
  assert.equal(dateKeyInTimezone(startsAt, TZ), "2026-09-24");
});

test("dateKeyInTimezone-based matching: two events on the same local date match regardless of exact time", () => {
  const a = dateKeyInTimezone("2026-09-23T08:00:00.000Z", TZ);
  const b = dateKeyInTimezone("2026-09-23T20:00:00.000Z", TZ);
  assert.equal(a, b);
});
