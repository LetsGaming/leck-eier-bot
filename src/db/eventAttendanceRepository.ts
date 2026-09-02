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

const selectEventsPageStmt = db.prepare<{ query: string; pageSize: number; offset: number }, EventRow>(
  `SELECT ${EVENT_COLUMNS} FROM apollo_events
   WHERE LOWER(title) LIKE @query
   ORDER BY starts_at DESC, title ASC
   LIMIT @pageSize OFFSET @offset`,
);
const countEventsStmt = db.prepare<{ query: string }, { total: number }>(
  `SELECT COUNT(*) AS total FROM apollo_events WHERE LOWER(title) LIKE @query`,
);
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

function withSignups(event: ApolloEvent): ApolloEvent & { signups: ApolloEventSignup[] } {
  return { ...event, signups: listSignups(event.id) };
}

export interface EventsPageQuery {
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Case-insensitive substring match against the event title. Empty/omitted matches everything. */
  query?: string;
}

export interface EventsPage {
  events: Array<ApolloEvent & { signups: ApolloEventSignup[] }>;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * A page of events, newest-first, optionally title-filtered — the only way
 * the dashboard's event list is ever read. Deliberately not "date search"
 * too: `starts_at` is stored as ISO UTC, not text a typed date like "12.09"
 * would substring-match against, and newest-first pagination already covers
 * "find a recent event" well enough for a first pass.
 */
export function listEventsPage({ page, pageSize, query }: EventsPageQuery): EventsPage {
  const likeQuery = `%${(query ?? "").trim().toLowerCase()}%`;
  const offset = Math.max(0, page - 1) * pageSize;
  const events = selectEventsPageStmt.all({ query: likeQuery, pageSize, offset }).map(rowToEvent).map(withSignups);
  const total = countEventsStmt.get({ query: likeQuery })!.total;
  return { events, total, page, pageSize };
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
