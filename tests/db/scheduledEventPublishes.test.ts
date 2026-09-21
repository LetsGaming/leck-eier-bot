import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// scheduledEventPublishesRepository.ts can't be imported directly — it pulls
// in src/db/index.ts, which opens the real data/bot.sqlite file as a
// top-level import side effect (same constraint documented in
// eventAttendanceRepository.test.ts). This mirrors the v39 migration's exact
// SQL and the due-query predicate against a throwaway in-memory database.

const MAX_ATTEMPTS = 3;

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE scheduled_event_publishes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publish_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      published_event_id INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

const SELECT_DUE_SQL = `
  SELECT id FROM scheduled_event_publishes
  WHERE published_event_id IS NULL AND attempts < ${MAX_ATTEMPTS} AND publish_at <= ?
`;

function insert(
  db: Database.Database,
  overrides: Partial<{ publishAt: string; publishedEventId: number | null; attempts: number }>,
): number {
  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO scheduled_event_publishes (publish_at, payload, published_event_id, attempts, created_at, updated_at)
         VALUES (@publishAt, '{}', @publishedEventId, @attempts, @now, @now)`,
      )
      .run({
        publishAt: overrides.publishAt ?? "2026-01-01T00:00:00.000Z",
        publishedEventId: overrides.publishedEventId ?? null,
        attempts: overrides.attempts ?? 0,
        now,
      }).lastInsertRowid,
  );
}

const NOW = "2026-06-01T00:00:00.000Z";

test("due-publishes SQL: a pending, past-due entry is returned", () => {
  const db = makeDb();
  const id = insert(db, { publishAt: "2026-05-01T00:00:00.000Z" });
  const rows = db.prepare(SELECT_DUE_SQL).all(NOW) as { id: number }[];
  assert.deepEqual(rows.map((r) => r.id), [id]);
});

test("due-publishes SQL: a future entry is not returned", () => {
  const db = makeDb();
  insert(db, { publishAt: "2027-01-01T00:00:00.000Z" });
  const rows = db.prepare(SELECT_DUE_SQL).all(NOW) as { id: number }[];
  assert.deepEqual(rows, []);
});

test("due-publishes SQL: an already-published entry is not returned even if due", () => {
  const db = makeDb();
  insert(db, { publishAt: "2026-05-01T00:00:00.000Z", publishedEventId: 42 });
  const rows = db.prepare(SELECT_DUE_SQL).all(NOW) as { id: number }[];
  assert.deepEqual(rows, []);
});

test("due-publishes SQL: an entry that exhausted its attempts is not returned", () => {
  const db = makeDb();
  insert(db, { publishAt: "2026-05-01T00:00:00.000Z", attempts: MAX_ATTEMPTS });
  const rows = db.prepare(SELECT_DUE_SQL).all(NOW) as { id: number }[];
  assert.deepEqual(rows, []);
});

// listPendingPublishes() backs /event planned — unlike the "due" query above,
// it must still surface an entry that has exhausted its retries (so the
// command can show the user its error), and it isn't filtered by publish_at.
const SELECT_PENDING_SQL = `
  SELECT id FROM scheduled_event_publishes WHERE published_event_id IS NULL ORDER BY publish_at ASC
`;

test("pending-publishes SQL: includes a not-yet-due future entry", () => {
  const db = makeDb();
  const id = insert(db, { publishAt: "2027-01-01T00:00:00.000Z" });
  const rows = db.prepare(SELECT_PENDING_SQL).all() as { id: number }[];
  assert.deepEqual(rows.map((r) => r.id), [id]);
});

test("pending-publishes SQL: includes a retry-exhausted entry (unlike the due query)", () => {
  const db = makeDb();
  const id = insert(db, { publishAt: "2026-05-01T00:00:00.000Z", attempts: MAX_ATTEMPTS });
  const rows = db.prepare(SELECT_PENDING_SQL).all() as { id: number }[];
  assert.deepEqual(rows.map((r) => r.id), [id]);
});

test("pending-publishes SQL: excludes an already-published entry", () => {
  const db = makeDb();
  insert(db, { publishAt: "2026-05-01T00:00:00.000Z", publishedEventId: 42 });
  const rows = db.prepare(SELECT_PENDING_SQL).all() as { id: number }[];
  assert.deepEqual(rows, []);
});

test("pending-publishes SQL: orders soonest publish_at first", () => {
  const db = makeDb();
  const later = insert(db, { publishAt: "2026-08-01T00:00:00.000Z" });
  const sooner = insert(db, { publishAt: "2026-07-01T00:00:00.000Z" });
  const rows = db.prepare(SELECT_PENDING_SQL).all() as { id: number }[];
  assert.deepEqual(
    rows.map((r) => r.id),
    [sooner, later],
  );
});
