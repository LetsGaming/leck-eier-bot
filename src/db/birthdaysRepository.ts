import { db } from "./index.js";
import type { BirthdayEntry, BirthdaysByDate } from "../types.js";

interface BirthdayRow {
  date: string;
  mention: string;
  user_id: string | null;
  name: string | null;
  source: "list" | "self";
}

function rowToEntry(row: BirthdayRow): BirthdayEntry {
  return { mention: row.mention, userId: row.user_id, name: row.name, source: row.source };
}

const selectByDateStmt = db.prepare<[string], BirthdayRow>(
  "SELECT date, mention, user_id, name, source FROM birthdays WHERE date = ?",
);
const selectAllStmt = db.prepare<[], BirthdayRow>(
  "SELECT date, mention, user_id, name, source FROM birthdays ORDER BY date",
);
// Only 'list' rows are wiped on a re-scan — 'self' rows (registered via
// /setmybirthday or a message in the channel) live outside the
// manually-maintained announcement message and must survive it.
const deleteListStmt = db.prepare("DELETE FROM birthdays WHERE source = 'list'");
const insertListStmt = db.prepare<{
  date: string;
  mention: string;
  userId: string | null;
  name: string | null;
}>(
  `INSERT INTO birthdays (date, mention, user_id, name, source) VALUES (@date, @mention, @userId, @name, 'list')
   ON CONFLICT(user_id) DO NOTHING`,
);
const upsertSelfStmt = db.prepare<{
  date: string;
  mention: string;
  userId: string;
  name: string | null;
}>(
  `INSERT INTO birthdays (date, mention, user_id, name, source) VALUES (@date, @mention, @userId, @name, 'self')
   ON CONFLICT(user_id) DO UPDATE SET date = excluded.date, mention = excluded.mention, name = excluded.name, source = 'self'`,
);

export function getBirthdaysForDate(date: string): BirthdayEntry[] {
  return selectByDateStmt.all(date).map(rowToEntry);
}

export function getAllBirthdaysByDate(): BirthdaysByDate {
  const grouped: BirthdaysByDate = {};
  for (const row of selectAllStmt.all()) {
    (grouped[row.date] ??= []).push(rowToEntry(row));
  }
  return grouped;
}

/**
 * Atomically swaps the manually-maintained ('list') part of the birthday
 * list — used after re-scanning the announcement channel, which always
 * produces a fresh, complete snapshot of that source. Self-registered
 * ('self') rows are untouched; if a user appears in both, the self
 * registration wins (ON CONFLICT DO NOTHING on the list insert).
 */
export const replaceAllBirthdays = db.transaction((data: BirthdaysByDate) => {
  deleteListStmt.run();
  for (const [date, entries] of Object.entries(data)) {
    for (const entry of entries) {
      insertListStmt.run({ date, mention: entry.mention, userId: entry.userId, name: entry.name });
    }
  }
});

/** Inserts or updates a member's own birthday, keyed by Discord user id — used by `/setmybirthday` and the birthday-channel auto-detector. */
export function upsertSelfBirthday(entry: { date: string; mention: string; userId: string; name: string | null }): void {
  upsertSelfStmt.run(entry);
}
