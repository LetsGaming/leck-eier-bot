/**
 * Pure rules for temporary group voice channels (`/voice-channel`) — name
 * building, argument validation, category/event resolution. No `discord.js`,
 * no database access, so these are exercised directly from `tests/bot/`
 * without mocking anything. Orchestration (calling Discord, writing rows)
 * lives in `services/temporaryVoiceChannels.ts`, which calls into this
 * module for every decision rather than deciding anything itself.
 */

import { TEMP_VOICE_HARD_MAX_AMOUNT, TEMP_VOICE_GROUP_SIZE_MAX, DISCORD_CHANNEL_NAME_MAX_LENGTH } from "../constants.js";
import type { Event } from "../types.js";

const PLACEHOLDER_PATTERN = /\{n\}|\{event\}/g;

/**
 * Renders a channel's name from the configured format string. `{n}` (the
 * channel's 1-based index within the set) and `{event}` (the bound event's
 * title, or an empty string when the set is unbound) are the only
 * placeholders. If the format has no `{n}` at all, the index is appended so
 * two channels in the same set are never accidentally given the same name.
 * Collapses whitespace left behind by an empty `{event}` substitution, then
 * truncates to Discord's channel-name length cap — falling back to the bare
 * index if that leaves nothing usable.
 */
export function buildTempVoiceChannelName(format: string, ctx: { index: number; eventTitle: string | null }): string {
  const hasIndexPlaceholder = format.includes("{n}");
  let rendered = format.replace(PLACEHOLDER_PATTERN, (token) => (token === "{n}" ? String(ctx.index) : ctx.eventTitle ?? ""));
  if (!hasIndexPlaceholder) rendered = `${rendered} ${ctx.index}`;

  rendered = rendered.replace(/\s+/g, " ").trim().slice(0, DISCORD_CHANNEL_NAME_MAX_LENGTH);
  return rendered.length > 0 ? rendered : String(ctx.index);
}

export interface TempVoiceValidationInput {
  amount: number;
  groupSize: number;
  /** `settings.tempVoiceMaxAmount` — always `<= TEMP_VOICE_HARD_MAX_AMOUNT`, but re-validated here since the command builder's own `maxValue` is fixed at registration time and can't reflect a later dashboard change. */
  configuredMax: number;
}

export type TempVoiceValidationResult = { ok: true } | { ok: false; message: string };

/** Validates `/voice-channel create`'s arguments against Discord's own limits plus the dashboard-configured (and hard) ceiling on `amount`. Returns a German, user-facing message on failure. */
export function validateTempVoiceRequest({ amount, groupSize, configuredMax }: TempVoiceValidationInput): TempVoiceValidationResult {
  if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > TEMP_VOICE_GROUP_SIZE_MAX) {
    return { ok: false, message: `Die Gruppengröße muss zwischen 1 und ${TEMP_VOICE_GROUP_SIZE_MAX} liegen.` };
  }
  const effectiveMax = Math.min(configuredMax, TEMP_VOICE_HARD_MAX_AMOUNT);
  if (!Number.isInteger(amount) || amount < 1 || amount > effectiveMax) {
    return { ok: false, message: `Die Anzahl der Kanäle muss zwischen 1 und ${effectiveMax} liegen.` };
  }
  return { ok: true };
}

/** The dashboard-configured category, else the invoking channel's own parent category, else `null` (guild root). */
export function resolveCategoryId(configuredCategoryId: string | null, invokingChannelParentId: string | null): string | null {
  return configuredCategoryId ?? invokingChannelParentId ?? null;
}

/**
 * Which event a newly-created set of channels binds to: the currently
 * active event, else the soonest-starting still-scheduled one, else `null`
 * (an unbound set — cleared only by `/voice-channel clear`). `activeEvents`
 * is expected already in the repository's natural order (there should only
 * ever be one, per the "events never overlap" assumption elsewhere in the
 * event system); `upcomingScheduled` need not be pre-sorted.
 */
export function selectBindingEvent(activeEvents: Event[], upcomingScheduled: Event[]): Event | null {
  if (activeEvents.length > 0) return activeEvents[0]!;
  if (upcomingScheduled.length === 0) return null;
  return upcomingScheduled.reduce((soonest, e) => (e.startsAt < soonest.startsAt ? e : soonest));
}

/**
 * Whether a managed channel bound to `boundEventId` is due for cleanup.
 * Unbound (`boundEventId === null`) is never due automatically — by design,
 * those only go away via `/voice-channel clear`. A bound set whose event row
 * has since vanished (`event === null`) is due — a missing event can't mean
 * "still running", and `temporary_voice_channels.event_id` deliberately
 * carries no foreign key so this case is reachable instead of silently
 * nulled out. Otherwise due once the event is no longer live.
 */
export function isTempChannelDue(event: Event | null, boundEventId: number | null): boolean {
  if (boundEventId === null) return false;
  if (event === null) return true;
  return event.status === "completed" || event.status === "cancelled";
}

export type ResolveMoveTargetResult = { ok: true; channelId: string } | { ok: false; message: string };

/**
 * Which channel `/voice-channel move` moves members into: the bound event's
 * resolved main voice channel. Every row in a temp-channel set shares the
 * same `eventId` (set once at creation — see `selectBindingEvent`), so a
 * mismatch here would mean data corruption rather than a normal user state;
 * still checked defensively since this table carries no foreign key.
 */
export function resolveMoveTargetChannelId(boundEventIds: (number | null)[], event: Event | null): ResolveMoveTargetResult {
  if (boundEventIds.length === 0) return { ok: false, message: "Es gibt aktuell keine temporären Sprachkanäle." };
  const eventId = boundEventIds[0]!;
  if (eventId === null || boundEventIds.some((id) => id !== eventId)) {
    return { ok: false, message: "Die temporären Sprachkanäle sind keinem einzelnen Event eindeutig zugeordnet — automatisches Zurückholen ist nicht möglich." };
  }
  if (event === null || event.status !== "active" || !event.voiceChannelId) {
    return { ok: false, message: "Für das gebundene Event ist aktuell kein aktiver Haupt-Sprachkanal bekannt." };
  }
  return { ok: true, channelId: event.voiceChannelId };
}
