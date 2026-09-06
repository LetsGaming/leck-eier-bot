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
  return { id: row.id, date: row.date, mention: row.mention, userId: row.user_id, name: row.name, source: row.source };
}

const selectByDateStmt = db.prepare<[string], BirthdayRow>(
  "SELECT id, date, mention, user_id, name, source FROM birthdays WHERE date = ?",
);
const selectAllStmt = db.prepare<[], BirthdayRow>(
  "SELECT id, date, mention, user_id, name, source FROM birthdays ORDER BY date",
);
const selectByUserIdStmt = db.prepare<[string], BirthdayRow>(
  "SELECT id, date, mention, user_id, name, source FROM birthdays WHERE user_id = ?",
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

/** A member's own birthday, if one is on file — used by the member-overview aggregation (`GET /api/members/:userId`). Null if this user has never registered/been given one. */
export function getBirthdayForUser(userId: string): BirthdayEntry | null {
  const row = selectByUserIdStmt.get(userId);
  return row ? rowToEntry(row) : null;
}

/**
 * One birthday falling within the next `days` calendar days (today itself
 * counts as "upcoming"), resolved to its actual next occurrence — used by
 * `/api/status`'s `communitySnapshot.birthdaysThisWeek`. Sorted soonest-first.
 */
export interface UpcomingBirthdayEntry {
  userId: string | null;
  name: string | null;
  mention: string;
  /** ISO UTC (server-local midnight) of the resolved next occurrence — this year's, or next year's if this year's has already passed. */
  date: string;
}

/**
 * This deliberately re-implements the year-wraparound resolution
 * `getUpcomingBirthdays()` (`services/birthdays.ts`) already does, rather
 * than calling it: the db layer here must not depend on the services layer
 * (the reverse dependency direction is used everywhere else in this repo —
 * services call repositories, never back), and `getUpcomingBirthdays()`
 * additionally groups by date/does display-oriented shaping this caller
 * doesn't want. Both must stay in sync if the "next occurrence" rule ever
 * changes.
 */
export function listBirthdaysInNextDays(days: number): UpcomingBirthdayEntry[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentYear = now.getFullYear();
  const todayMonth = now.getMonth();
  const todayDate = now.getDate();
  const horizonMs = startOfToday.getTime() + days * 86_400_000;

  const result: UpcomingBirthdayEntry[] = [];
  for (const row of selectAllStmt.all()) {
    const [ddStr, mmStr] = row.date.split(".");
    const dd = Number(ddStr);
    const month = Number(mmStr) - 1;
    if (!Number.isInteger(dd) || !Number.isInteger(month)) continue;
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
