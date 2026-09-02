import { getSettings } from "../db/settingsRepository.js";
import {
  listDueScheduledEvents,
  listDueActiveEvents,
  listActiveEvents,
  setEventActive,
  setEventCompleted,
  markTrackingIncomplete,
  listSignups,
  listVoiceLog,
  listVoiceLogForUser,
  appendVoiceLog,
  setSignupAttendance,
  getEventById,
} from "../db/eventAttendanceRepository.js";
import { APOLLO_EVENT_ON_TIME_GRACE_MS } from "../constants.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { ApolloEvent, ApolloEventVoiceLogRow, AttendanceStatus, BotClient } from "../types.js";

export interface DerivedAttendance {
  status: "on_time" | "late" | "no_show" | "left_early";
  firstJoinedAt: string | null;
  lastLeftAt: string | null;
}

/**
 * Replays one user's voice-log rows for an event into a final attendance
 * status. Pure and side-effect-free — this is the single place the
 * on_time/late/no_show/left_early rules live, used both to finalize a
 * completed event and to recompute after a manual name-link.
 *
 * A rejoin naturally un-flags "left early": presence is recomputed from the
 * full replay rather than latched on the first leave.
 */
export function deriveAttendance(log: ApolloEventVoiceLogRow[], startsAt: string, endsAt: string): DerivedAttendance {
  const sorted = [...log].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const onTimeCutoff = new Date(new Date(startsAt).getTime() + APOLLO_EVENT_ON_TIME_GRACE_MS).toISOString();

  let present = false;
  let firstJoinedAt: string | null = null;
  let lastLeftAt: string | null = null;
  let baseStatus: "on_time" | "late" | null = null;

  for (const row of sorted) {
    if (row.action === "present_at_start" || row.action === "join") {
      present = true;
      if (firstJoinedAt === null) {
        firstJoinedAt = row.at;
        baseStatus = row.action === "present_at_start" || row.at <= onTimeCutoff ? "on_time" : "late";
      }
    } else if (row.action === "leave") {
      present = false;
      lastLeftAt = row.at;
    } else if (row.action === "present_at_end") {
      present = true;
    }
  }

  if (firstJoinedAt === null) return { status: "no_show", firstJoinedAt: null, lastLeftAt: null };
  if (!present) return { status: "left_early", firstJoinedAt, lastLeftAt };
  return { status: baseStatus!, firstJoinedAt, lastLeftAt };
}

/** Users whose most recent voice-log action leaves them "present" per a straight replay — used by `catchUpApolloEvents()` to diff against who's actually in the channel after a restart. */
function computeOpenPresence(log: ApolloEventVoiceLogRow[]): Set<string> {
  const sorted = [...log].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const present = new Set<string>();
  for (const row of sorted) {
    if (row.action === "present_at_start" || row.action === "join") present.add(row.userId);
    else if (row.action === "leave") present.delete(row.userId);
  }
  return present;
}

/** (choice !== 'declined') — the only signups ever tracked/finalized. Declined stays `attendanceStatus: null` forever, rendered "—" on the dashboard. */
function trackableSignups(eventId: number) {
  return listSignups(eventId).filter((s) => s.choice !== "declined");
}

async function markAllNotTracked(eventId: number, reason: string): Promise<void> {
  markTrackingIncomplete(eventId);
  for (const signup of trackableSignups(eventId)) {
    setSignupAttendance(signup.id, { attendanceStatus: "not_tracked" as AttendanceStatus, firstJoinedAt: null, lastLeftAt: null });
  }
  logger.warn(reason);
}

/**
 * Recomputes and persists attendance for every trackable signup on an
 * event, from its voice log. Safe to call any time after activation —
 * called at completion (`completeEvent`) and again after a manual
 * name-link, so a link made after the fact still reconstructs real
 * attendance from the log (which records every non-bot channel member, not
 * just resolved signups — see `apolloEventWatcher.ts`'s voiceStateUpdate
 * handler).
 */
export function recomputeAttendanceForEvent(eventId: number): void {
  const event = getEventById(eventId);
  if (!event) return;
  for (const signup of trackableSignups(eventId)) {
    if (!signup.userId) continue; // still unmatched — nothing to derive yet
    const log = listVoiceLogForUser(eventId, signup.userId);
    const derived = deriveAttendance(log, event.startsAt, event.endsAt);
    setSignupAttendance(signup.id, {
      attendanceStatus: derived.status,
      firstJoinedAt: derived.firstJoinedAt,
      lastLeftAt: derived.lastLeftAt,
    });
  }
}

async function fetchVoiceChannelMembers(client: BotClient, channelId: string): Promise<string[] | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isVoiceBased()) return null;
  return [...channel.members.filter((m) => !m.user.bot).keys()];
}

async function activateEvent(client: BotClient, event: ApolloEvent, now: Date): Promise<void> {
  const nowIso = now.toISOString();

  if (new Date(event.endsAt).getTime() <= now.getTime()) {
    await markAllNotTracked(
      event.id,
      `Apollo-Event "${event.title}" (#${event.id}): komplettes Zeitfenster verpasst (Bot war offline) — als nicht getrackt markiert.`,
    );
    setEventCompleted(event.id, nowIso);
    return;
  }

  const vcId = getSettings().eventVoiceChannelId;
  const occupantIds = vcId ? await fetchVoiceChannelMembers(client, vcId) : null;
  if (!vcId || occupantIds === null) {
    await markAllNotTracked(
      event.id,
      `Apollo-Event "${event.title}" (#${event.id}) konnte nicht getrackt werden: ${
        vcId ? `Sprachkanal ${vcId} nicht sichtbar oder kein Sprachkanal` : "kein Event-Sprachkanal konfiguriert"
      }.`,
    );
    setEventCompleted(event.id, nowIso);
    return;
  }

  setEventActive(event.id, vcId, nowIso);
  if (occupantIds.length > 0) {
    appendVoiceLog(
      occupantIds.map((userId) => ({ eventId: event.id, userId, action: "present_at_start" as const, at: event.startsAt })),
    );
  }
}

async function completeEvent(client: BotClient, event: ApolloEvent, now: Date): Promise<void> {
  if (event.voiceChannelId) {
    const occupantIds = await fetchVoiceChannelMembers(client, event.voiceChannelId);
    if (occupantIds && occupantIds.length > 0) {
      appendVoiceLog(
        occupantIds.map((userId) => ({ eventId: event.id, userId, action: "present_at_end" as const, at: event.endsAt })),
      );
    }
  }
  recomputeAttendanceForEvent(event.id);
  setEventCompleted(event.id, now.toISOString());
}

/** One sweep tick: activates due 'scheduled' events, completes due 'active' ones. Called once at startup (after `catchUpApolloEvents()`) and then on `APOLLO_EVENT_SWEEP_INTERVAL_MS`. */
export async function sweepApolloEvents(client: BotClient): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();

  for (const event of listDueScheduledEvents(nowIso)) {
    await activateEvent(client, event, now);
  }
  for (const event of listDueActiveEvents(nowIso)) {
    await completeEvent(client, event, now);
  }
}

/**
 * Startup-only healing for an event left 'active' by a crash/restart: the
 * exact moment of any join/leave that happened while the bot was down is
 * unknowable, so this approximates by diffing the log's "who's currently
 * present per a replay" against who's actually in the channel right now,
 * appending a synthetic join/leave at `now` for anyone who disagrees, and
 * flags the event `tracking_incomplete` so the dashboard shows a warning
 * rather than presenting the resulting timestamps as exact. Must run after
 * `initMemberCache()`/guild-ready, since it needs the live voice-channel
 * member list — see `apolloEventWatcher.ts`.
 */
export async function catchUpApolloEvents(client: BotClient): Promise<void> {
  const nowIso = new Date().toISOString();

  for (const event of listActiveEvents()) {
    if (new Date(event.endsAt).getTime() <= Date.now()) continue; // sweepApolloEvents() below will complete it
    if (!event.voiceChannelId) continue;

    const occupantIds = await fetchVoiceChannelMembers(client, event.voiceChannelId);
    if (occupantIds === null) continue;

    markTrackingIncomplete(event.id);
    const present = new Set(occupantIds);
    const openPresence = computeOpenPresence(listVoiceLog(event.id));

    const toAppend: Array<{ eventId: number; userId: string; action: "join" | "leave"; at: string }> = [];
    for (const userId of openPresence) {
      if (!present.has(userId)) toAppend.push({ eventId: event.id, userId, action: "leave", at: nowIso });
    }
    for (const userId of present) {
      if (!openPresence.has(userId)) toAppend.push({ eventId: event.id, userId, action: "join", at: nowIso });
    }
    if (toAppend.length > 0) appendVoiceLog(toAppend);

    logger.warn(
      `Apollo-Event "${event.title}" (#${event.id}) war beim Neustart noch aktiv — Anwesenheit für die Ausfallzeit angenähert.`,
    );
  }

  await sweepApolloEvents(client).catch((err) => logger.error(`Apollo-Event-Sweep fehlgeschlagen: ${errorMessage(err)}`));
}
