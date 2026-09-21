import { listNonCancelledEventsFrom } from "../db/eventAttendanceRepository.js";
import { listPendingPublishes, MAX_ATTEMPTS } from "../db/scheduledEventPublishesRepository.js";
import { dateKeyInTimezone } from "../utils/timezone.js";

/**
 * Something already occupying a calendar date — either an already-posted
 * event or a not-yet-posted scheduled publish. Shared by both the "skip a
 * taken weekday" prefill (`occupiedEventDates`) and the "warn about this
 * date" check (`findEventConflicts`) so the two rules never drift apart.
 */
export interface EventConflict {
  kind: "event" | "scheduledPublish";
  id: number;
  title: string;
  /** ISO UTC. */
  startsAt: string;
  /** ISO UTC — `scheduledPublish` only. */
  publishAt?: string;
  /** `event` only — lets a caller build a "jump to message" link. */
  channelId?: string;
  /** `event` only. */
  messageId?: string;
}

/** A pending publish that has exhausted its retries will never actually post, so it doesn't occupy its date. */
function isLivePendingPublish(entry: { attempts: number }): boolean {
  return entry.attempts < MAX_ATTEMPTS;
}

/**
 * The set of local (`tz`) `"YYYY-MM-DD"` dates already occupied by a
 * non-cancelled event or a still-retryable pending publish, from `fromMs`
 * onward (default now) — backs `nextWeekdayOccurrenceUtc`'s `isDateTaken`
 * option so a recurring template's prefill skips straight to the next free
 * occurrence instead of colliding with an already-planned one.
 */
export function occupiedEventDates(tz: string, fromMs: number = Date.now()): Set<string> {
  const fromIso = new Date(fromMs).toISOString();
  const dates = new Set<string>();

  for (const event of listNonCancelledEventsFrom(fromIso)) {
    dates.add(dateKeyInTimezone(event.startsAt, tz));
  }
  for (const publish of listPendingPublishes()) {
    if (!isLivePendingPublish(publish)) continue;
    dates.add(dateKeyInTimezone(publish.payload.startsAt, tz));
  }

  return dates;
}

export interface FindEventConflictsOptions {
  /** Exclude this scheduled-publish id — used when editing a pending publish so it doesn't flag itself. */
  ignoreScheduledPublishId?: number;
}

/**
 * Everything already occupying `startsAtIso`'s calendar date (in `tz`),
 * excluding `options.ignoreScheduledPublishId` — the non-blocking "this date
 * already has something planned" warning shown on event creation. Returns
 * both kinds of conflict (already-posted events and pending publishes)
 * without ranking or deduplicating between them; callers render both.
 */
export function findEventConflicts(startsAtIso: string, tz: string, options?: FindEventConflictsOptions): EventConflict[] {
  const targetDateKey = dateKeyInTimezone(startsAtIso, tz);
  const conflicts: EventConflict[] = [];

  for (const event of listNonCancelledEventsFrom(new Date(0).toISOString())) {
    if (dateKeyInTimezone(event.startsAt, tz) !== targetDateKey) continue;
    conflicts.push({
      kind: "event",
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      channelId: event.channelId,
      messageId: event.messageId,
    });
  }

  for (const publish of listPendingPublishes()) {
    if (publish.id === options?.ignoreScheduledPublishId) continue;
    if (!isLivePendingPublish(publish)) continue;
    if (dateKeyInTimezone(publish.payload.startsAt, tz) !== targetDateKey) continue;
    conflicts.push({
      kind: "scheduledPublish",
      id: publish.id,
      title: publish.payload.title,
      startsAt: publish.payload.startsAt,
      publishAt: publish.publishAt,
    });
  }

  return conflicts;
}
