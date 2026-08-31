import { db } from "./index.js";
import type { BirthdayEntry, BirthdaysByDate } from "../types.js";

interface BirthdayRow {
  id: number;
  date: string;
  mention: string;
  user_id: string | null;
  name: string | null;
  source: "list" | "self";
}

function rowToEntry(row: BirthdayRow): BirthdayEntry {
  return { id: row.id, mention: row.mention, userId: row.user_id, name: row.name, source: row.source };
}

const selectByDateStmt = db.prepare<[string], BirthdayRow>(
  "SELECT id, date, mention, user_id, name, source FROM birthdays WHERE date = ?",
);
const selectAllStmt = db.prepare<[], BirthdayRow>(
  "SELECT id, date, mention, user_id, name, source FROM birthdays ORDER BY date",
);
const insertListStmt = db.prepare<{
  date: string;
  mention: string;
  userId: string | null;
  name: string | null;
}>(`INSERT INTO birthdays (date, mention, user_id, name, source) VALUES (@date, @mention, @userId, @name, 'list')`);
const updateEntryStmt = db.prepare<{
  id: number;
  date: string;
  mention: string;
  userId: string | null;
  name: string | null;
}>("UPDATE birthdays SET date = @date, mention = @mention, user_id = @userId, name = @name WHERE id = @id");
const deleteEntryStmt = db.prepare<[number]>("DELETE FROM birthdays WHERE id = ?");
const deleteByUserStmt = db.prepare<[string]>("DELETE FROM birthdays WHERE user_id = ?");
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

/** Adds an admin-entered birthday (dashboard "Add birthday") — always `source: 'list'`. Returns the new entry's id. */
export function insertBirthday(entry: { date: string; mention: string; userId: string | null; name: string | null }): number {
  return Number(insertListStmt.run(entry).lastInsertRowid);
}

/** Edits an existing entry in place by id — used by the dashboard's admin-managed birthday table, regardless of that entry's `source`. */
export function updateBirthdayEntry(
  id: number,
  entry: { date: string; mention: string; userId: string | null; name: string | null },
): void {
  updateEntryStmt.run({ id, ...entry });
}

export function deleteBirthday(id: number): void {
  deleteEntryStmt.run(id);
}

/** Removes every entry (list or self-registered) tied to a Discord user id — used when a member leaves the guild. Returns the number of rows removed (0 or 1, since `user_id` is uniquely indexed). */
export function deleteBirthdaysForUser(userId: string): number {
  return deleteByUserStmt.run(userId).changes;
}

/** Inserts or updates a member's own birthday, keyed by Discord user id — used by `/setmybirthday` and the birthday-channel auto-detector. */
export function upsertSelfBirthday(entry: { date: string; mention: string; userId: string; name: string | null }): void {
  upsertSelfStmt.run(entry);
}
