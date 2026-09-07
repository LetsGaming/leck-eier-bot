import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// getBirthdayForUser()/listBirthdaysInNextDays() (src/db/birthdaysRepository.ts)
// aren't exercised directly here: that module imports src/db/index.ts, which
// opens the real data/bot.sqlite file as a top-level import side effect (see
// commandPermissionGateMigration.test.ts's comment for the same constraint).
// This instead mirrors, in isolation, the exact SQL and resolution logic
// those two functions rest on — same convention as
// memberRecordsArchive.test.ts's cutoff-SQL tests.

interface BirthdayRow {
  id: number;
  date: string;
  mention: string;
  user_id: string | null;
  name: string | null;
  source: "list" | "self";
}

function makeBirthdaysDb(): Database.Database {
  const db = new Database(":memory:");
  // Mirrors the `birthdays` table shape getBirthdayForUser()/
  // listBirthdaysInNextDays() actually query (src/db/birthdaysRepository.ts).
  db.exec(`
    CREATE TABLE birthdays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      mention TEXT NOT NULL,
      user_id TEXT,
      name TEXT,
      source TEXT NOT NULL DEFAULT 'list'
    );
    CREATE UNIQUE INDEX idx_birthdays_user ON birthdays(user_id);
  `);
  return db;
}

const SELECT_BY_USER_SQL = "SELECT id, date, mention, user_id, name, source FROM birthdays WHERE user_id = ?";

test("getBirthdayForUser SQL: finds the row for that user_id", () => {
  const db = makeBirthdaysDb();
  db.prepare("INSERT INTO birthdays (date, mention, user_id, name, source) VALUES (?, ?, ?, ?, 'self')").run(
    "15.03",
    "<@42>",
    "42",
    null,
  );

  const row = db.prepare(SELECT_BY_USER_SQL).get("42") as BirthdayRow | undefined;
  assert.ok(row);
  assert.equal(row.date, "15.03");
  assert.equal(row.mention, "<@42>");
});

test("getBirthdayForUser SQL: returns undefined for a user with no birthday on file", () => {
  const db = makeBirthdaysDb();
  const row = db.prepare(SELECT_BY_USER_SQL).get("no-such-user");
  assert.equal(row, undefined);
});

/**
 * Mirrors listBirthdaysInNextDays()'s year-wraparound resolution exactly
 * (src/db/birthdaysRepository.ts) — kept in sync manually, same tradeoff
 * documented on that function.
 */
function listBirthdaysInNextDaysMirror(db: Database.Database, days: number, now: Date) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentYear = now.getFullYear();
  const todayMonth = now.getMonth();
  const todayDate = now.getDate();
  const horizonMs = startOfToday.getTime() + days * 86_400_000;

  const rows = db.prepare("SELECT id, date, mention, user_id, name, source FROM birthdays ORDER BY date").all() as BirthdayRow[];
  const result: { userId: string | null; name: string | null; mention: string; date: string }[] = [];
  for (const row of rows) {
    const [ddStr, mmStr] = row.date.split(".");
    const dd = Number(ddStr);
    const month = Number(mmStr) - 1;
    const alreadyPassedThisYear = month < todayMonth || (month === todayMonth && dd < todayDate);
    const year = alreadyPassedThisYear ? currentYear + 1 : currentYear;
    const occursOn = new Date(year, month, dd);
    if (occursOn.getTime() >= startOfToday.getTime() && occursOn.getTime() <= horizonMs) {
      result.push({ userId: row.user_id, name: row.name, mention: row.mention, date: occursOn.toISOString() });
    }
  }
  result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return result;
}

test("listBirthdaysInNextDays: includes a birthday later this month, within the window", () => {
  const db = makeBirthdaysDb();
  const now = new Date(2026, 5, 1); // 2026-06-01
  db.prepare("INSERT INTO birthdays (date, mention, user_id, name, source) VALUES ('05.06', '<@1>', '1', null, 'list')").run();

  const result = listBirthdaysInNextDaysMirror(db, 7, now);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.userId, "1");
  assert.equal(result[0]!.date, new Date(2026, 5, 5).toISOString());
});

test("listBirthdaysInNextDays: today itself counts as upcoming", () => {
  const db = makeBirthdaysDb();
  const now = new Date(2026, 5, 1); // 2026-06-01
  db.prepare("INSERT INTO birthdays (date, mention, user_id, name, source) VALUES ('01.06', '<@1>', '1', null, 'list')").run();

  const result = listBirthdaysInNextDaysMirror(db, 7, now);
  assert.equal(result.length, 1);
});

test("listBirthdaysInNextDays: excludes a birthday outside the window", () => {
  const db = makeBirthdaysDb();
  const now = new Date(2026, 5, 1); // 2026-06-01
  db.prepare("INSERT INTO birthdays (date, mention, user_id, name, source) VALUES ('20.06', '<@1>', '1', null, 'list')").run();

  const result = listBirthdaysInNextDaysMirror(db, 7, now);
  assert.equal(result.length, 0);
});

test("listBirthdaysInNextDays: a birthday just passed this year wraps to next year and is excluded unless the window spans the year boundary", () => {
  const db = makeBirthdaysDb();
  const now = new Date(2026, 11, 30); // 2026-12-30
  // 05.01 already passed for 2026 -> resolves to 2027-01-05, 6 days out.
  db.prepare("INSERT INTO birthdays (date, mention, user_id, name, source) VALUES ('05.01', '<@1>', '1', null, 'list')").run();

  assert.equal(listBirthdaysInNextDaysMirror(db, 3, now).length, 0);
  const wrapped = listBirthdaysInNextDaysMirror(db, 7, now);
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0]!.date, new Date(2027, 0, 5).toISOString());
});

test("listBirthdaysInNextDays: results are sorted soonest-first", () => {
  const db = makeBirthdaysDb();
  const now = new Date(2026, 5, 1); // 2026-06-01
  db.prepare("INSERT INTO birthdays (date, mention, user_id, name, source) VALUES ('07.06', '<@later>', 'later', null, 'list')").run();
  db.prepare("INSERT INTO birthdays (date, mention, user_id, name, source) VALUES ('02.06', '<@sooner>', 'sooner', null, 'list')").run();

  const result = listBirthdaysInNextDaysMirror(db, 7, now);
  assert.deepEqual(
    result.map((r) => r.userId),
    ["sooner", "later"],
  );
});
