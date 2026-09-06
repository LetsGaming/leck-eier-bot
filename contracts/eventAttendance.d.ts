/**
 * Response shape of `GET /api/events/attendance/months` — see
 * `src/web/routes/eventAttendance.ts`.
 */
export interface EventAttendanceMonthsResponse {
  months: string[];
  /** Event count per month key ("YYYY-MM"), for highlighting/badging months that hold data in the month picker. */
  counts: Record<string, number>;
  current: string;
  timezone: string;
}

/**
 * One signed-up member on an `EventAttendanceEntry`. `choice`,
 * `matchSource`, and `attendanceStatus`'s literal unions mirror the bot's
 * `ApolloRsvpChoice`/`SignupMatchSource`/`AttendanceStatus` types
 * (`src/types.ts`) inline, keeping this contract free of any import into the
 * bot's own module graph:
 * - `matchSource`: how `rawName` was resolved to a guild member.
 * - `attendanceStatus`: on_time/late/no_show/left_early are derived from the
 *   tracked voice channel; not_tracked means the bot missed the whole window
 *   or the voice channel wasn't configured/visible. Null means not yet
 *   computed — still scheduled, or the signup is 'declined' (never tracked).
 */
export interface EventSignupEntry {
  id: number;
  /** As it appeared in Apollo's embed, exactly. */
  rawName: string;
  choice: "accepted" | "declined" | "tentative";
  userId: string | null;
  displayName: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  matchSource: "auto" | "manual" | "unmatched" | "ambiguous";
  /** Null while the event is 'scheduled' and always for a 'declined' choice. Computed live (not read from the DB cache) while the event is 'active'. */
  attendanceStatus: "on_time" | "late" | "no_show" | "left_early" | "not_tracked" | null;
  firstJoinedAt: string | null;
  lastLeftAt: string | null;
  /** Minutes late arriving — independent of `earlyMinutes` (both can be set at once). Computed live for an 'active' event, same as `attendanceStatus`. */
  lateMinutes: number | null;
  /** Minutes their final departure was before the event ended, only when they never returned. Independent of `lateMinutes`. */
  earlyMinutes: number | null;
  /** ISO UTC — set when this name disappears from a re-parsed embed after the event has gone active/completed. Null while still present. */
  withdrawnAt: string | null;
}

/**
 * `status`'s literal union mirrors the bot's `ApolloEventStatus` type
 * (`src/types.ts`) inline: scheduled -> active -> completed, or -> cancelled
 * if the Apollo message is deleted while still scheduled.
 */
export type EventAttendanceStatus = "scheduled" | "active" | "completed" | "cancelled";

/**
 * One Apollo-managed event with its full sign-up/attendance list — see
 * `src/services/eventAttendance.ts` on the backend for the state machine and
 * derivation rules. Response shape of `GET /api/events/attendance/:id` and
 * `PATCH /api/events/attendance/signups/:signupId`.
 */
export interface EventAttendanceEntry {
  id: number;
  apolloEventId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  status: EventAttendanceStatus;
  /** The bot was offline for some/all of this event's tracking window — timestamps may be approximate. */
  trackingIncomplete: boolean;
  /** Jump link to the original Apollo message. */
  messageUrl: string;
  voiceChannelId: string | null;
  signups: EventSignupEntry[];
}

/**
 * Per-event signup/attendance tallies — see `EventSignupCounts` on the
 * backend (`src/db/eventAttendanceRepository.ts`).
 */
export interface EventSignupCounts {
  total: number;
  accepted: number;
  tentative: number;
  declined: number;
  /** Same predicate as the backend's `listEventsWithUnresolvedSignups`/`countUnmatchedSignups`. */
  unresolved: number;
  onTime: number;
  late: number;
  noShow: number;
  leftEarly: number;
  notTracked: number;
  /** `attendanceStatus = 'on_time'` but `lateMinutes > 0` — a subset of `onTime`, not an alternative to it. */
  lateWithinGrace: number;
  /** `earlyMinutes > 0` and NOT flagged `left_early`. Independent of `leftEarly`/`onTime`/etc. */
  earlyWithinGrace: number;
  /** Sum of `lateMinutes` across all signups (nulls treated as 0). */
  lateMinutesTotal: number;
}

/**
 * One row in the event-attendance list view — see `GET /api/events/attendance`.
 * Same event-level fields as `EventAttendanceEntry`, but with aggregate
 * `counts` instead of the full `signups` array.
 */
export interface EventAttendanceSummary {
  id: number;
  apolloEventId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  status: EventAttendanceStatus;
  trackingIncomplete: boolean;
  messageUrl: string;
  voiceChannelId: string | null;
  counts: EventSignupCounts;
}

/** Response shape of `GET /api/events/attendance`. */
export interface EventAttendanceListResponse {
  mode: "month" | "all" | "problems";
  /** Echoed "YYYY-MM" for mode "month"; null for "all"/"problems". */
  month: string | null;
  timezone: string;
  events: EventAttendanceSummary[];
  total: number;
  truncated: boolean;
}
