import { db } from "./index.js";
import type {
  ApolloEvent,
  ApolloEventSignup,
  ApolloEventStatus,
  ApolloEventVoiceLogRow,
  ApolloRsvpChoice,
  AttendanceStatus,
  SignupMatchSource,
} from "../types.js";

interface EventRow {
  id: number;
  apollo_event_id: string | null;
  message_id: string;
  channel_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  voice_channel_id: string | null;
  activated_at: string | null;
  completed_at: string | null;
  tracking_incomplete: 0 | 1;
  created_at: string;
  updated_at: string;
}

interface SignupRow {
  id: number;
  event_id: number;
  raw_name: string;
  normalized_name: string;
  choice: string;
  user_id: string | null;
  match_source: string;
  withdrawn_at: string | null;
  attendance_status: string | null;
  first_joined_at: string | null;
  last_left_at: string | null;
  late_minutes: number | null;
  early_minutes: number | null;
}

interface VoiceLogRow {
  id: number;
  event_id: number;
  user_id: string;
  action: string;
  at: string;
}

function rowToEvent(row: EventRow): ApolloEvent {
  return {
    id: row.id,
    apolloEventId: row.apollo_event_id,
    messageId: row.message_id,
    channelId: row.channel_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status as ApolloEventStatus,
    voiceChannelId: row.voice_channel_id,
    activatedAt: row.activated_at,
    completedAt: row.completed_at,
    trackingIncomplete: row.tracking_incomplete === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSignup(row: SignupRow): ApolloEventSignup {
  return {
    id: row.id,
    eventId: row.event_id,
    rawName: row.raw_name,
    normalizedName: row.normalized_name,
    choice: row.choice as ApolloRsvpChoice,
    userId: row.user_id,
    matchSource: row.match_source as SignupMatchSource,
    withdrawnAt: row.withdrawn_at,
    attendanceStatus: row.attendance_status as AttendanceStatus | null,
    firstJoinedAt: row.first_joined_at,
    lastLeftAt: row.last_left_at,
    lateMinutes: row.late_minutes,
    earlyMinutes: row.early_minutes,
  };
}

function rowToVoiceLog(row: VoiceLogRow): ApolloEventVoiceLogRow {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    action: row.action as ApolloEventVoiceLogRow["action"],
    at: row.at,
  };
}

const EVENT_COLUMNS = `id, apollo_event_id, message_id, channel_id, title, starts_at, ends_at, status,
  voice_channel_id, activated_at, completed_at, tracking_incomplete, created_at, updated_at`;
const SIGNUP_COLUMNS = `id, event_id, raw_name, normalized_name, choice, user_id, match_source, withdrawn_at,
  attendance_status, first_joined_at, last_left_at, late_minutes, early_minutes`;
const VOICE_LOG_COLUMNS = "id, event_id, user_id, action, at";

/**
 * A signup is "unresolved" when it still needs a manual member link and
 * hasn't been withdrawn. Shared verbatim between `countUnmatchedSignupsStmt`
 * (the Overview badge), `listEventsWithUnresolvedSignups` (the "problems"
 * list), and `summarizeSignupsForEvents`'s `unresolved` aggregate, so the
 * three can never drift out of sync with each other again.
 */
const UNRESOLVED_SIGNUP_PREDICATE = `match_source IN ('unmatched', 'ambiguous') AND withdrawn_at IS NULL`;

const countUnmatchedSignupsStmt = db.prepare<[], { total: number }>(
  `SELECT COUNT(*) AS total FROM apollo_event_signups WHERE ${UNRESOLVED_SIGNUP_PREDICATE}`,
);
const selectEventsInRangeStmt = db.prepare<{ from: string; to: string; query: string }, EventRow>(
  `SELECT ${EVENT_COLUMNS} FROM apollo_events
   WHERE starts_at >= @from AND starts_at < @to AND LOWER(title) LIKE @query
   ORDER BY starts_at DESC, title ASC`,
);
const selectEventsAllMonthsStmt = db.prepare<{ query: string; limit: number }, EventRow>(
  `SELECT ${EVENT_COLUMNS} FROM apollo_events
   WHERE LOWER(title) LIKE @query
   ORDER BY starts_at DESC, title ASC
   LIMIT @limit`,
);
const selectEventsWithUnresolvedSignupsStmt = db.prepare<{ query: string; limit: number }, EventRow>(
  `SELECT ${EVENT_COLUMNS} FROM apollo_events e
   WHERE LOWER(e.title) LIKE @query
     AND EXISTS (
       SELECT 1 FROM apollo_event_signups s
       WHERE s.event_id = e.id AND ${UNRESOLVED_SIGNUP_PREDICATE}
     )
   ORDER BY starts_at DESC, title ASC
   LIMIT @limit`,
);
const selectEventStartTimesStmt = db.prepare<[], { starts_at: string }>(`SELECT starts_at FROM apollo_events`);
const selectEventByIdStmt = db.prepare<[number], EventRow>(`SELECT ${EVENT_COLUMNS} FROM apollo_events WHERE id = ?`);
const selectEventByApolloIdStmt = db.prepare<[string], EventRow>(
  `SELECT ${EVENT_COLUMNS} FROM apollo_events WHERE apollo_event_id = ?`,
);
const selectEventByMessageIdStmt = db.prepare<[string], EventRow>(
  `SELECT ${EVENT_COLUMNS} FROM apollo_events WHERE message_id = ?`,
);
const selectDueScheduledEventsStmt = db.prepare<[string], EventRow>(
  `SELECT ${EVENT_COLUMNS} FROM apollo_events WHERE status = 'scheduled' AND starts_at <= ?`,
);
const selectDueActiveEventsStmt = db.prepare<[string], EventRow>(
  `SELECT ${EVENT_COLUMNS} FROM apollo_events WHERE status = 'active' AND ends_at <= ?`,
);
const selectActiveEventsStmt = db.prepare<[], EventRow>(
  `SELECT ${EVENT_COLUMNS} FROM apollo_events WHERE status = 'active' ORDER BY starts_at ASC`,
);

const insertEventStmt = db.prepare<{
  apolloEventId: string | null;
  messageId: string;
  channelId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
}>(
  `INSERT INTO apollo_events (apollo_event_id, message_id, channel_id, title, starts_at, ends_at, created_at, updated_at)
   VALUES (@apolloEventId, @messageId, @channelId, @title, @startsAt, @endsAt, @createdAt, @updatedAt)`,
);
const updateEventIntentStmt = db.prepare<{
  id: number;
  apolloEventId: string | null;
  messageId: string;
  channelId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
}>(
  `UPDATE apollo_events SET
     apollo_event_id = @apolloEventId, message_id = @messageId, channel_id = @channelId,
     title = @title, starts_at = @startsAt, ends_at = @endsAt, updated_at = @updatedAt
   WHERE id = @id`,
);
const setEventActiveStmt = db.prepare<{ id: number; voiceChannelId: string | null; activatedAt: string; updatedAt: string }>(
  `UPDATE apollo_events SET status = 'active', voice_channel_id = @voiceChannelId, activated_at = @activatedAt, updated_at = @updatedAt WHERE id = @id`,
);
const setEventCompletedStmt = db.prepare<{ id: number; completedAt: string; updatedAt: string }>(
  `UPDATE apollo_events SET status = 'completed', completed_at = @completedAt, updated_at = @updatedAt WHERE id = @id`,
);
const setEventCancelledStmt = db.prepare<{ id: number; updatedAt: string }>(
  `UPDATE apollo_events SET status = 'cancelled', updated_at = @updatedAt WHERE id = @id`,
);
const markTrackingIncompleteStmt = db.prepare<{ id: number; updatedAt: string }>(
  `UPDATE apollo_events SET tracking_incomplete = 1, updated_at = @updatedAt WHERE id = @id`,
);
const deleteEventStmt = db.prepare<[number]>("DELETE FROM apollo_events WHERE id = ?");

const selectSignupsByEventStmt = db.prepare<[number], SignupRow>(
  `SELECT ${SIGNUP_COLUMNS} FROM apollo_event_signups WHERE event_id = ?
   ORDER BY CASE choice WHEN 'accepted' THEN 0 WHEN 'tentative' THEN 1 WHEN 'declined' THEN 2 ELSE 3 END,
            raw_name COLLATE NOCASE`,
);
const selectSignupByIdStmt = db.prepare<[number], SignupRow>(
  `SELECT ${SIGNUP_COLUMNS} FROM apollo_event_signups WHERE id = ?`,
);
const insertSignupStmt = db.prepare<{
  eventId: number;
  rawName: string;
  normalizedName: string;
  choice: string;
  userId: string | null;
  matchSource: string;
}>(
  `INSERT INTO apollo_event_signups (event_id, raw_name, normalized_name, choice, user_id, match_source)
   VALUES (@eventId, @rawName, @normalizedName, @choice, @userId, @matchSource)`,
);
const updateSignupIntentStmt = db.prepare<{
  id: number;
  rawName: string;
  choice: string;
  userId: string | null;
  matchSource: string;
}>(
  `UPDATE apollo_event_signups SET
     raw_name = @rawName, choice = @choice, user_id = @userId, match_source = @matchSource, withdrawn_at = NULL
   WHERE id = @id`,
);
const setSignupWithdrawnStmt = db.prepare<{ id: number; withdrawnAt: string }>(
  `UPDATE apollo_event_signups SET withdrawn_at = @withdrawnAt WHERE id = @id`,
);
const deleteSignupStmt = db.prepare<[number]>("DELETE FROM apollo_event_signups WHERE id = ?");
const linkSignupStmt = db.prepare<{ id: number; userId: string | null; matchSource: string }>(
  `UPDATE apollo_event_signups SET user_id = @userId, match_source = @matchSource WHERE id = @id`,
);
const setSignupAttendanceStmt = db.prepare<{
  id: number;
  attendanceStatus: string | null;
  firstJoinedAt: string | null;
  lastLeftAt: string | null;
  lateMinutes: number | null;
  earlyMinutes: number | null;
}>(
  `UPDATE apollo_event_signups SET
     attendance_status = @attendanceStatus, first_joined_at = @firstJoinedAt, last_left_at = @lastLeftAt,
     late_minutes = @lateMinutes, early_minutes = @earlyMinutes
   WHERE id = @id`,
);

const selectVoiceLogStmt = db.prepare<[number], VoiceLogRow>(
  `SELECT ${VOICE_LOG_COLUMNS} FROM apollo_event_voice_log WHERE event_id = ? ORDER BY at ASC, id ASC`,
);
const selectVoiceLogForUserStmt = db.prepare<[number, string], VoiceLogRow>(
  `SELECT ${VOICE_LOG_COLUMNS} FROM apollo_event_voice_log WHERE event_id = ? AND user_id = ? ORDER BY at ASC, id ASC`,
);
const insertVoiceLogStmt = db.prepare<{ eventId: number; userId: string; action: string; at: string }>(
  `INSERT INTO apollo_event_voice_log (event_id, user_id, action, at) VALUES (@eventId, @userId, @action, @at)`,
);

export function getEventById(id: number): ApolloEvent | null {
  const row = selectEventByIdStmt.get(id);
  return row ? rowToEvent(row) : null;
}

/** `apolloEventId` (the numeric id parsed from an apollo.fyi link) is preferred; `messageId` is the fallback identity — see migration v28's doc comment. */
export function getEventByIdentity(apolloEventId: string | null, messageId: string): ApolloEvent | null {
  if (apolloEventId) {
    const row = selectEventByApolloIdStmt.get(apolloEventId);
    if (row) return rowToEvent(row);
  }
  const row = selectEventByMessageIdStmt.get(messageId);
  return row ? rowToEvent(row) : null;
}

export interface UpsertApolloEventInput {
  apolloEventId: string | null;
  messageId: string;
  channelId: string;
  title: string;
  /** ISO UTC. Ignored (frozen) once the existing event's status is no longer 'scheduled'. */
  startsAt: string;
  /** ISO UTC. Same freeze rule as `startsAt`. */
  endsAt: string;
}

/** Inserts a new event, or updates title/identity (and, only while still 'scheduled', start/end times) for an existing one. Never touches `status`/attendance fields. */
export function upsertApolloEvent(input: UpsertApolloEventInput): ApolloEvent {
  const now = new Date().toISOString();
  const existing = getEventByIdentity(input.apolloEventId, input.messageId);
  if (existing) {
    updateEventIntentStmt.run({
      id: existing.id,
      apolloEventId: input.apolloEventId ?? existing.apolloEventId,
      messageId: input.messageId,
      channelId: input.channelId,
      title: input.title,
      startsAt: existing.status === "scheduled" ? input.startsAt : existing.startsAt,
      endsAt: existing.status === "scheduled" ? input.endsAt : existing.endsAt,
      updatedAt: now,
    });
    return getEventById(existing.id)!;
  }
  const info = insertEventStmt.run({
    apolloEventId: input.apolloEventId,
    messageId: input.messageId,
    channelId: input.channelId,
    title: input.title,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    createdAt: now,
    updatedAt: now,
  });
  return getEventById(Number(info.lastInsertRowid))!;
}

/** Signups across every event still needing a manual member link — surfaced on Overview as an attention count (see docs/EVENT_ATTENDANCE.md). */
export function countUnmatchedSignups(): number {
  return countUnmatchedSignupsStmt.get()!.total;
}

export interface EventsInRangeQuery {
  /** ISO UTC, inclusive. */
  fromIso: string;
  /** ISO UTC, exclusive. */
  toIso: string;
  /** Case-insensitive substring match against the event title. Empty/omitted matches everything. */
  query?: string;
}

/**
 * Events whose `starts_at` falls in `[fromIso, toIso)`, newest-first —
 * intended for a month-scoped dashboard view. Served by
 * `idx_apollo_events_starts_at` (migration below). Returns bare events, not
 * hydrated with signups: list views use `summarizeSignupsForEvents`
 * aggregates instead of loading every signup row per event (N+1).
 */
export function listEventsInRange({ fromIso, toIso, query }: EventsInRangeQuery): ApolloEvent[] {
  const likeQuery = `%${(query ?? "").trim().toLowerCase()}%`;
  return selectEventsInRangeStmt.all({ from: fromIso, to: toIso, query: likeQuery }).map(rowToEvent);
}

export interface EventsAllMonthsQuery {
  /** Case-insensitive substring match against the event title. Empty/omitted matches everything. */
  query?: string;
  limit: number;
}

/**
 * Events across every month, newest-first, capped at `limit` — used when a
 * caller wants "everything matching this search" rather than one month at a
 * time (e.g. populating the month picker's fallback / a global search).
 * Bare events, not hydrated with signups — see `listEventsInRange`.
 */
export function listEventsAllMonths({ query, limit }: EventsAllMonthsQuery): ApolloEvent[] {
  const likeQuery = `%${(query ?? "").trim().toLowerCase()}%`;
  return selectEventsAllMonthsStmt.all({ query: likeQuery, limit }).map(rowToEvent);
}

/**
 * Events that have at least one unresolved signup (see
 * `UNRESOLVED_SIGNUP_PREDICATE`), newest-first, capped at `limit` — backs a
 * "problems" list scoped to the same predicate as `countUnmatchedSignups`'s
 * badge count, so the two can never disagree. Bare events, not hydrated
 * with signups — see `listEventsInRange`.
 */
export function listEventsWithUnresolvedSignups({ query, limit }: EventsAllMonthsQuery): ApolloEvent[] {
  const likeQuery = `%${(query ?? "").trim().toLowerCase()}%`;
  return selectEventsWithUnresolvedSignupsStmt.all({ query: likeQuery, limit }).map(rowToEvent);
}

/** Every event's `starts_at`, unfiltered — raw data for building a month picker (e.g. "which months have events"). Not paginated; caller derives distinct months in JS. */
export function listEventStartTimes(): string[] {
  return selectEventStartTimesStmt.all().map((row) => row.starts_at);
}

export interface EventSignupCounts {
  total: number;
  accepted: number;
  tentative: number;
  declined: number;
  /** Same predicate as `countUnmatchedSignups`/`listEventsWithUnresolvedSignups` — see `UNRESOLVED_SIGNUP_PREDICATE`. */
  unresolved: number;
  onTime: number;
  late: number;
  noShow: number;
  leftEarly: number;
  notTracked: number;
  /** `attendance_status = 'on_time'` but `late_minutes > 0` — arrived within the on-time grace window but not exactly on the dot. A subset of `onTime`, not an alternative to it. */
  lateWithinGrace: number;
  /** `early_minutes > 0` and NOT flagged `left_early` — final departure was within the early-leave grace window of the end but not exactly at it. Independent of `leftEarly`/`onTime`/etc; a signup can be both `onTime` and `earlyWithinGrace`. */
  earlyWithinGrace: number;
  /** Sum of `late_minutes` across all signups (NULLs treated as 0) — total person-minutes of lateness for the event. */
  lateMinutesTotal: number;
}

interface SignupSummaryRow {
  eventId: number;
  total: number;
  accepted: number;
  tentative: number;
  declined: number;
  unresolved: number;
  onTime: number;
  late: number;
  noShow: number;
  leftEarly: number;
  notTracked: number;
  lateWithinGrace: number;
  earlyWithinGrace: number;
  lateMinutesTotal: number;
}

/**
 * Aggregate signup counts (RSVP breakdown + attendance breakdown) per event,
 * for the given event ids. One `SUM(CASE ...) ... GROUP BY event_id` query —
 * far cheaper than loading every signup row per event just to tally them in
 * JS one event at a time (the N+1 pattern the now-removed `listEventsPage`
 * used).
 *
 * Reads persisted attendance_status/late_minutes/early_minutes columns
 * directly — these are NOT settled for an event with status 'active' (see
 * deriveAttendance()/serializeSignup() in routes/eventAttendance.ts).
 * Callers MUST NOT use this aggregate for an active event; recompute counts
 * in JS from listSignups()+serializeSignup() instead. At most one event is
 * ever active at a time, so that fallback is cheap.
 *
 * better-sqlite3 cannot bind a JS array to a single `?` placeholder, so
 * unlike every other statement in this file (which is prepared once at
 * module load), this statement is prepared fresh on every call with one `?`
 * generated per id — the placeholder count varies per call, so it can't be
 * a fixed module-level statement.
 */
export function summarizeSignupsForEvents(eventIds: number[]): Map<number, EventSignupCounts> {
  const result = new Map<number, EventSignupCounts>();
  if (eventIds.length === 0) return result;

  const placeholders = eventIds.map(() => "?").join(",");
  const stmt = db.prepare<number[], SignupSummaryRow>(
    `SELECT
       event_id AS eventId,
       COUNT(*) AS total,
       SUM(CASE WHEN choice = 'accepted' THEN 1 ELSE 0 END) AS accepted,
       SUM(CASE WHEN choice = 'tentative' THEN 1 ELSE 0 END) AS tentative,
       SUM(CASE WHEN choice = 'declined' THEN 1 ELSE 0 END) AS declined,
       SUM(CASE WHEN ${UNRESOLVED_SIGNUP_PREDICATE} THEN 1 ELSE 0 END) AS unresolved,
       SUM(CASE WHEN attendance_status = 'on_time' THEN 1 ELSE 0 END) AS onTime,
       SUM(CASE WHEN attendance_status = 'late' THEN 1 ELSE 0 END) AS late,
       SUM(CASE WHEN attendance_status = 'no_show' THEN 1 ELSE 0 END) AS noShow,
       SUM(CASE WHEN attendance_status = 'left_early' THEN 1 ELSE 0 END) AS leftEarly,
       SUM(CASE WHEN attendance_status = 'not_tracked' THEN 1 ELSE 0 END) AS notTracked,
       SUM(CASE WHEN attendance_status = 'on_time' AND late_minutes > 0 THEN 1 ELSE 0 END) AS lateWithinGrace,
       SUM(CASE WHEN early_minutes > 0 AND attendance_status IS NOT 'left_early' THEN 1 ELSE 0 END) AS earlyWithinGrace,
       SUM(COALESCE(late_minutes, 0)) AS lateMinutesTotal
     FROM apollo_event_signups
     WHERE event_id IN (${placeholders})
     GROUP BY event_id`,
  );

  for (const row of stmt.all(...eventIds)) {
    result.set(row.eventId, {
      total: row.total,
      accepted: row.accepted,
      tentative: row.tentative,
      declined: row.declined,
      unresolved: row.unresolved,
      onTime: row.onTime,
      late: row.late,
      noShow: row.noShow,
      leftEarly: row.leftEarly,
      notTracked: row.notTracked,
      lateWithinGrace: row.lateWithinGrace,
      earlyWithinGrace: row.earlyWithinGrace,
      lateMinutesTotal: row.lateMinutesTotal,
    });
  }
  return result;
}

/** 'scheduled' events whose start time has passed — sweepApolloEvents() activates these. */
export function listDueScheduledEvents(nowIso: string): ApolloEvent[] {
  return selectDueScheduledEventsStmt.all(nowIso).map(rowToEvent);
}

/** 'active' events whose end time has passed — sweepApolloEvents() finalizes/completes these. */
export function listDueActiveEvents(nowIso: string): ApolloEvent[] {
  return selectDueActiveEventsStmt.all(nowIso).map(rowToEvent);
}

/** All currently-'active' events, earliest first. Events are assumed never to overlap (one fixed voice channel) — a caller seeing more than one should warn and use the first. */
export function listActiveEvents(): ApolloEvent[] {
  return selectActiveEventsStmt.all().map(rowToEvent);
}

export function setEventActive(id: number, voiceChannelId: string | null, activatedAt: string): void {
  const now = new Date().toISOString();
  setEventActiveStmt.run({ id, voiceChannelId, activatedAt, updatedAt: now });
}

export function setEventCompleted(id: number, completedAt: string): void {
  const now = new Date().toISOString();
  setEventCompletedStmt.run({ id, completedAt, updatedAt: now });
}

export function setEventCancelled(id: number): void {
  setEventCancelledStmt.run({ id, updatedAt: new Date().toISOString() });
}

export function markTrackingIncomplete(id: number): void {
  markTrackingIncompleteStmt.run({ id, updatedAt: new Date().toISOString() });
}

export function deleteEvent(id: number): void {
  deleteEventStmt.run(id);
}

export interface ParsedSignupInput {
  rawName: string;
  normalizedName: string;
  choice: ApolloRsvpChoice;
  userId: string | null;
  matchSource: SignupMatchSource;
}

/**
 * The only function that writes signup *intent* (raw_name/choice/user_id/
 * match_source/withdrawn_at) — never touches attendance_status/
 * first_joined_at/last_left_at. Upserts by (event_id, normalized_name);
 * never overwrites a `manual` match_source (a human link is never undone by
 * a re-parse). A previously-seen name missing from `parsed` is deleted
 * outright while `eventStatus === 'scheduled'` (a clean un-RSVP), or marked
 * `withdrawn_at` otherwise (its attendance history must survive).
 */
export const replaceEventSignups = db.transaction(
  (eventId: number, parsed: ParsedSignupInput[], eventStatus: ApolloEventStatus): void => {
    const now = new Date().toISOString();
    const existing = selectSignupsByEventStmt.all(eventId).map(rowToSignup);
    const existingByName = new Map(existing.map((s) => [s.normalizedName, s]));
    const parsedNames = new Set(parsed.map((p) => p.normalizedName));

    for (const p of parsed) {
      const current = existingByName.get(p.normalizedName);
      if (current) {
        const protectManualLink = current.matchSource === "manual";
        updateSignupIntentStmt.run({
          id: current.id,
          rawName: p.rawName,
          choice: p.choice,
          userId: protectManualLink ? current.userId : p.userId,
          matchSource: protectManualLink ? "manual" : p.matchSource,
        });
      } else {
        insertSignupStmt.run({
          eventId,
          rawName: p.rawName,
          normalizedName: p.normalizedName,
          choice: p.choice,
          userId: p.userId,
          matchSource: p.matchSource,
        });
      }
    }

    for (const current of existing) {
      if (parsedNames.has(current.normalizedName)) continue;
      if (eventStatus === "scheduled") {
        deleteSignupStmt.run(current.id);
      } else if (!current.withdrawnAt) {
        setSignupWithdrawnStmt.run({ id: current.id, withdrawnAt: now });
      }
    }
  },
);

export function listSignups(eventId: number): ApolloEventSignup[] {
  return selectSignupsByEventStmt.all(eventId).map(rowToSignup);
}

export function getSignup(id: number): ApolloEventSignup | null {
  const row = selectSignupByIdStmt.get(id);
  return row ? rowToSignup(row) : null;
}

/** Manual reconciliation from the dashboard. `userId: null` unlinks (back to 'unmatched'); a non-null value always sets `matchSource: 'manual'`, protecting it from being overwritten by a later re-parse. */
export function linkSignupToUser(signupId: number, userId: string | null): void {
  linkSignupStmt.run({ id: signupId, userId, matchSource: userId ? "manual" : "unmatched" });
}

export interface SignupAttendanceUpdate {
  attendanceStatus: AttendanceStatus | null;
  firstJoinedAt: string | null;
  lastLeftAt: string | null;
  lateMinutes: number | null;
  earlyMinutes: number | null;
}

/** The only function that writes attendance fields — never touches signup intent. Called from `finalizeAttendance()`/`recomputeAttendanceForEvent()` in `services/eventAttendance.ts`, never from a re-parse. */
export function setSignupAttendance(signupId: number, update: SignupAttendanceUpdate): void {
  setSignupAttendanceStmt.run({ id: signupId, ...update });
}

export function listVoiceLog(eventId: number): ApolloEventVoiceLogRow[] {
  return selectVoiceLogStmt.all(eventId).map(rowToVoiceLog);
}

export function listVoiceLogForUser(eventId: number, userId: string): ApolloEventVoiceLogRow[] {
  return selectVoiceLogForUserStmt.all(eventId, userId).map(rowToVoiceLog);
}

export interface VoiceLogEntryInput {
  eventId: number;
  userId: string;
  action: ApolloEventVoiceLogRow["action"];
  at: string;
}

/** Appends one or more rows to the append-only voice log — the source of truth `deriveAttendance()` replays. */
export const appendVoiceLog = db.transaction((rows: VoiceLogEntryInput[]): void => {
  for (const row of rows) insertVoiceLogStmt.run(row);
});
