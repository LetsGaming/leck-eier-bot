/**
 * Every timestamp from the API is an ISO UTC string (or `null` = "not
 * tracked"). `new Date(iso)` parses that correctly regardless of anything
 * else — the question this module answers is which *display* timezone to
 * render it back in.
 */

/**
 * IANA timezone name every admin's dashboard renders dates in, regardless of
 * their own device's timezone — set once from `Me.timezone` (see App.tsx)
 * right after login, which mirrors the bot's own `TIMEZONE` env var. "UTC"
 * is just the safe placeholder before that fetch resolves.
 */
let displayTimezone = "UTC";

export function setDisplayTimezone(timezone: string): void {
  displayTimezone = timezone;
}

/** Absolute date/time in the configured display timezone (see `setDisplayTimezone`), not the viewer's own device timezone. */
export function formatAbsolute(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("de-DE", { timeZone: displayTimezone });
}

/** Adds `months` calendar months to `date` (UTC-based), clamping the day-of-month to the last valid day of the resulting month instead of overflowing into the month after (e.g. Aug 31 + 1 month -> Sep 30, never Oct 1). */
function addUtcMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1); // park on a day that exists in every month while shifting
  result.setUTCMonth(result.getUTCMonth() + months);
  const daysInTargetMonth = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, daysInTargetMonth));
  return result;
}

/**
 * "vor xM, yT und zStd" — a calendar-aware months/days/hours breakdown
 * rather than a single huge unit (e.g. "47 Tage"), so anything more than a
 * few weeks old still reads at a glance. Computed entirely via UTC getters —
 * elapsed calendar time doesn't depend on any display timezone, and using
 * UTC throughout avoids DST/day-length edge cases the viewer's own local
 * timezone could otherwise introduce.
 */
export function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const from = new Date(iso);
  const to = new Date();
  if (Number.isNaN(from.getTime())) return "—";
  if (from.getTime() >= to.getTime()) return "gerade eben";

  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  // Walk back one month at a time until the shifted-forward `from` no longer
  // overshoots `to` — clamped shifting (see addUtcMonthsClamped) means this
  // never needs more than one correction in practice, but a loop is only a
  // handful of iterations even in a pathological case and is trivially
  // correct, unlike the single `if` this used to be.
  let cursor = addUtcMonthsClamped(from, months);
  while (cursor.getTime() > to.getTime() && months > 0) {
    months -= 1;
    cursor = addUtcMonthsClamped(from, months);
  }

  const remainingMs = Math.max(0, to.getTime() - cursor.getTime());
  const days = Math.floor(remainingMs / 86_400_000);
  const hours = Math.floor((remainingMs % 86_400_000) / 3_600_000);

  return `vor ${months}M, ${days}T und ${hours}Std`;
}
