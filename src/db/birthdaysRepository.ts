import { db } from "./index.js";
import type { BirthdayEntry, BirthdaysByDate } from "../types.js";

interface BirthdayRow {
  date: string;
  mention: string;
  user_id: string | null;
  name: string | null;
}

function rowToEntry(row: BirthdayRow): BirthdayEntry {
  return { mention: row.mention, userId: row.user_id, name: row.name };
}

const selectByDateStmt = db.prepare<[string], BirthdayRow>(
  "SELECT date, mention, user_id, name FROM birthdays WHERE date = ?",
);
const selectAllStmt = db.prepare<[], BirthdayRow>(
  "SELECT date, mention, user_id, name FROM birthdays ORDER BY date",
);
const deleteAllStmt = db.prepare("DELETE FROM birthdays");
const insertStmt = db.prepare<{
  date: string;
  mention: string;
  userId: string | null;
  name: string | null;
}>(
  "INSERT INTO birthdays (date, mention, user_id, name) VALUES (@date, @mention, @userId, @name)",
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
 * Atomically swaps the entire birthday list — used after re-scanning the
 * announcement channel, which always produces a fresh, complete snapshot.
 */
export const replaceAllBirthdays = db.transaction((data: BirthdaysByDate) => {
  deleteAllStmt.run();
  for (const [date, entries] of Object.entries(data)) {
    for (const entry of entries) {
      insertStmt.run({ date, mention: entry.mention, userId: entry.userId, name: entry.name });
    }
  }
});
