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
function tzOffsetMs(utcMs: number, tz: string): number {
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
