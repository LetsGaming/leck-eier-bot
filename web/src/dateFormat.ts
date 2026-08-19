/**
 * Every timestamp from the API is an ISO UTC string (or `null` = "not
 * tracked"). `new Date(iso)` parses that correctly regardless of the
 * viewer's timezone, and `toLocaleString()` renders it back in that
 * timezone automatically — no manual UTC/local conversion needed here.
 */

/** Absolute date/time in the viewer's own local timezone. */
export function formatAbsolute(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/**
 * "xM, yD and zHr ago" — a calendar-aware months/days/hours breakdown
 * rather than a single huge unit (e.g. "47 days ago"), so anything more
 * than a few weeks old still reads at a glance.
 */
export function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const from = new Date(iso);
  const to = new Date();

  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  const cursor = new Date(from);
  cursor.setMonth(cursor.getMonth() + months);
  if (cursor.getTime() > to.getTime()) {
    months -= 1;
    cursor.setMonth(cursor.getMonth() - 1);
  }

  const remainingMs = Math.max(0, to.getTime() - cursor.getTime());
  const days = Math.floor(remainingMs / 86_400_000);
  const hours = Math.floor((remainingMs % 86_400_000) / 3_600_000);

  return `${months}M, ${days}D and ${hours}Hr ago`;
}
