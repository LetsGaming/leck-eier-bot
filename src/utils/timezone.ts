/**
 * Timezone-aware helpers for bucketing events by calendar month.
 *
 * All bucketing must happen in `config.timezone`, not UTC — otherwise a
 * `00:30` Berlin New Year's event would file under December in UTC, a
 * visible and unexplainable bug for anyone in that timezone. This module
 * is the single server-side implementation; clients only ever pass/receive
 * `"YYYY-MM"` strings, never raw offsets.
 *
 * Built entirely on `Intl.DateTimeFormat` — no timezone-database
 * dependency needed.
 */

/**
 * Computes the offset (in milliseconds) such that `utcMs - offset` is the
 * true UTC instant that renders as the wall-clock time `utcMs` (read as if
 * it were UTC) in `tz`. Callers use this to invert a "naive" wall-clock
 * reading — a desired local time misencoded as UTC — into the real UTC
 * instant: `trueUtcMs = naiveMs - tzOffsetMs(naiveMs, tz)`.
 *
 * A single `offsetAt` call is wrong right around a DST transition: the
 * offset that applies depends on which side of the transition the *true*
 * instant falls on, which is exactly what we're solving for, so using
 * `naiveMs` itself as the query point can read the wrong side. This
 * function therefore iterates the fixed point once: `firstGuess =
 * offsetAt(naiveMs)` gives a candidate true instant `naiveMs -
 * firstGuess`, and re-querying the offset *there* (`offsetAt(naiveMs -
 * firstGuess)`) converges to the correct offset. (Re-querying at `naiveMs
 * + firstGuess` moves away from the true instant instead of toward it —
 * verified wrong via round-trip testing, see task-6-report.md.)
 *
 * The only remaining edge case is a wall-clock time that never occurred at
 * all (e.g. 02:30 local time on a spring-forward day, when clocks jump
 * 02:00→03:00) — there is no correct answer for genuinely nonexistent
 * local times, and this resolves them to the post-transition offset.
 */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const offsetAt = (guessMs: number): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guessMs));

    const lookup: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") lookup[part.type] = part.value;
    }

    // Reconstruct the wall-clock reading as if it were UTC; the delta from
    // the original UTC instant is the timezone's offset at that instant.
    const asUtc = Date.UTC(
      Number(lookup.year),
      Number(lookup.month) - 1,
      Number(lookup.day),
      Number(lookup.hour === "24" ? "0" : lookup.hour),
      Number(lookup.minute),
      Number(lookup.second),
    );

    return asUtc - guessMs;
  };

  const firstGuess = offsetAt(utcMs);
  return offsetAt(utcMs - firstGuess);
}

/**
 * Computes the half-open UTC range `[fromIso, toIso)` covering the given
 * calendar month (`"YYYY-MM"`) as observed in `tz` — i.e. the UTC instants
 * corresponding to the first moment of that month and the first moment of
 * the next month, both in `tz`.
 *
 * Intended for a `WHERE starts_at >= fromIso AND starts_at < toIso` query.
 */
export function monthRangeUtc(
  month: string,
  tz: string,
): { fromIso: string; toIso: string } {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1; // 0-based

  const startOfMonth = (y: number, mIndex: number): Date => {
    // Naive UTC guess for "first moment of this month in tz".
    const naiveMs = Date.UTC(y, mIndex, 1, 0, 0, 0, 0);
    const offset = tzOffsetMs(naiveMs, tz);
    // naiveMs is the wall-clock instant we want, expressed as if it were
    // UTC; subtracting the offset converts it to the actual UTC instant.
    return new Date(naiveMs - offset);
  };

  const from = startOfMonth(year, monthIndex);
  const to = startOfMonth(year, monthIndex + 1);

  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

/**
 * Returns the `"YYYY-MM"` calendar month that `iso` (a UTC timestamp)
 * falls into when rendered in `tz`.
 */
export function monthKeyInTimezone(iso: string, tz: string): string {
  const utcMs = new Date(iso).getTime();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(utcMs));

  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }

  return `${lookup.year}-${lookup.month}`;
}

/** Returns the current `"YYYY-MM"` calendar month in `tz`. */
export function currentMonthKey(tz: string): string {
  return monthKeyInTimezone(new Date().toISOString(), tz);
}

/**
 * Finds the next UTC instant, at or after `nowMs`, that falls on calendar
 * weekday `weekday` (0=Sunday..6=Saturday, `Date#getUTCDay()` convention) at
 * `startTimeHHMM`/`endTimeHHMM` ("HH:MM") wall-clock time in `tz` — the
 * "this event is always Tuesdays at 8pm" default-time feature on event
 * templates (see `EventTemplate.defaultWeekday` in `src/types.ts`). Today
 * counts if its occurrence hasn't started yet; otherwise the search moves to
 * next week. `endTimeHHMM` earlier than `startTimeHHMM` is treated as
 * crossing midnight (end lands the following calendar day).
 *
 * Same naive-UTC-guess + `tzOffsetMs` correction as `monthRangeUtc` above —
 * weekday itself is checked on the plain calendar date (a pure Gregorian
 * property, independent of timezone), only the actual start/end instants
 * need the DST-aware conversion.
 */
export function nextWeekdayOccurrenceUtc(
  weekday: number,
  startTimeHHMM: string,
  endTimeHHMM: string,
  tz: string,
  nowMs: number = Date.now(),
): { startsAt: string; endsAt: string } {
  const [startHour, startMinute] = startTimeHHMM.split(":").map(Number);
  const [endHour, endMinute] = endTimeHHMM.split(":").map(Number);

  const todayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const lookup: Record<string, string> = {};
  for (const part of todayParts) if (part.type !== "literal") lookup[part.type] = part.value;
  const todayYear = Number(lookup.year);
  const todayMonthIndex = Number(lookup.month) - 1;
  const todayDay = Number(lookup.day);

  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const candidateDate = new Date(Date.UTC(todayYear, todayMonthIndex, todayDay + dayOffset));
    if (candidateDate.getUTCDay() !== weekday) continue;

    const y = candidateDate.getUTCFullYear();
    const m = candidateDate.getUTCMonth();
    const d = candidateDate.getUTCDate();

    const naiveStartMs = Date.UTC(y, m, d, startHour, startMinute);
    const startMs = naiveStartMs - tzOffsetMs(naiveStartMs, tz);
    if (startMs < nowMs) continue; // this week's occurrence already started/passed

    const naiveEndMs = Date.UTC(y, m, d, endHour, endMinute);
    let endMs = naiveEndMs - tzOffsetMs(naiveEndMs, tz);
    if (endMs < startMs) endMs += 24 * 60 * 60 * 1000; // end time-of-day is before start's — crosses midnight

    return { startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString() };
  }

  // Unreachable: every weekday occurs at least once in any 8-day window.
  throw new Error(`nextWeekdayOccurrenceUtc: no occurrence of weekday ${weekday} found`);
}

const LOCAL_DATETIME_PATTERN = /^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})$/;

/**
 * Parses a "TT.MM.JJJJ HH:MM" wall-clock string — the format the `/event`
 * modal asks users for instead of raw ISO, matching the dashboard's de-DE
 * date display — as a time in `tz`, returning the UTC instant. Returns
 * `null` for anything that doesn't match the pattern or names a calendar
 * date that doesn't exist (e.g. 31.02.), rather than silently rolling over
 * the way `Date.UTC` normally would. Same naive-UTC-guess + `tzOffsetMs`
 * correction as `nextWeekdayOccurrenceUtc`.
 */
export function parseLocalDateTime(raw: string, tz: string): Date | null {
  const match = LOCAL_DATETIME_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, dayStr, monthStr, yearStr, hourStr, minuteStr] = match;
  const day = Number(dayStr);
  const month = Number(monthStr);
  const year = Number(yearStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;

  const naiveMs = Date.UTC(year, month - 1, day, hour, minute);
  const naiveDate = new Date(naiveMs);
  if (naiveDate.getUTCFullYear() !== year || naiveDate.getUTCMonth() !== month - 1 || naiveDate.getUTCDate() !== day) return null;

  return new Date(naiveMs - tzOffsetMs(naiveMs, tz));
}

/**
 * Formats `iso` (a UTC timestamp) as "TT.MM.JJJJ HH:MM" wall-clock time in
 * `tz` — the inverse of `parseLocalDateTime`, used to prefill the `/event`
 * modal's date fields with a value users can read and re-type without
 * consulting a UTC offset.
 */
export function formatLocalDateTime(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const lookup: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") lookup[part.type] = part.value;
  return `${lookup.day}.${lookup.month}.${lookup.year} ${lookup.hour}:${lookup.minute}`;
}

/**
 * Shifts a `"YYYY-MM"` calendar month key by `delta` calendar months
 * (positive or negative), e.g. `shiftMonthKey("2026-01", -1) === "2025-12"`.
 * Pure integer arithmetic — no timezone involved.
 */
export function shiftMonthKey(month: string, delta: number): string {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1; // 0-based

  const totalMonths = year * 12 + monthIndex + delta;
  const newYear = Math.floor(totalMonths / 12);
  const newMonthIndex = ((totalMonths % 12) + 12) % 12;

  return `${newYear}-${String(newMonthIndex + 1).padStart(2, "0")}`;
}
