import { ChannelType, type Client, type Guild } from "discord.js";
import {
  insertTemporaryVoiceChannel,
  listTemporaryVoiceChannels,
  countTemporaryVoiceChannels,
  deleteTemporaryVoiceChannel,
  type TemporaryVoiceChannel,
} from "../db/temporaryVoiceChannelsRepository.js";
import { listActiveEvents, listUpcomingScheduledEvents, getEventById } from "../db/eventAttendanceRepository.js";
import { getSettings } from "../db/settingsRepository.js";
import {
  buildTempVoiceChannelName,
  validateTempVoiceRequest,
  resolveCategoryId,
  selectBindingEvent,
  isTempChannelDue,
} from "../shared/temporaryVoiceChannels.js";
import { DISCORD_ERROR_CODE_UNKNOWN_CHANNEL } from "../constants.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { Event } from "../types.js";

export interface CreateTempVoiceChannelsInput {
  guild: Guild;
  /** The category of the channel `/voice-channel create` was invoked from — the fallback placement when no category is configured on the dashboard. */
  invokingChannelParentId: string | null;
  amount: number;
  groupSize: number;
  actorId: string;
}

export type CreateTempVoiceChannelsResult =
  | { ok: true; created: number; groupSize: number; categoryId: string | null; categoryFellBackToRoot: boolean; eventTitle: string | null }
  | { ok: false; message: string };

export interface ClearTempVoiceChannelsResult {
  deleted: number;
  alreadyGone: number;
  failed: number;
}

// Logs a channel-deletion failure at most once per channel per process —
// the sweep retries a failed delete every tick, and a persistent failure
// (e.g. a revoked permission) would otherwise spam the log forever.
const warnedChannelIds = new Set<string>();

function warnOnce(channelId: string, context: string, err: unknown): void {
  if (warnedChannelIds.has(channelId)) return;
  warnedChannelIds.add(channelId);
  logger.warn(`Temporärer Sprachkanal ${channelId}: ${context} fehlgeschlagen: ${errorMessage(err)}`);
}

/**
 * Deletes one managed channel, or drops its row if the channel is already
 * gone. The single idempotency point both `clearTemporaryVoiceChannels()`
 * and `sweepTemporaryVoiceChannels()` route through — never call
 * `channel.delete()` directly elsewhere for a row in this table.
 */
async function deleteManagedChannel(guild: Guild, row: TemporaryVoiceChannel): Promise<"deleted" | "already-gone" | "failed"> {
  const channel = guild.channels.cache.get(row.channelId);
  if (!channel) {
    deleteTemporaryVoiceChannel(row.channelId);
    return "already-gone";
  }
  try {
    await channel.delete("Temporärer Event-Sprachkanal");
  } catch (err) {
    if ((err as { code?: number }).code === DISCORD_ERROR_CODE_UNKNOWN_CHANNEL) {
      deleteTemporaryVoiceChannel(row.channelId);
      return "already-gone";
    }
    // Deliberately keep the row on any other failure (permission revoked,
    // rate limit, ...) — most of these are transient, and giving up would
    // mean a permanently orphaned voice channel, which the feature must
    // never produce. The next sweep tick retries it.
    warnOnce(row.channelId, "Löschen", err);
    return "failed";
  }
  deleteTemporaryVoiceChannel(row.channelId);
  return "deleted";
}

/**
 * Creates `amount` temporary group voice channels, each limited to
 * `groupSize` users, and binds the set to the current/soonest event (or
 * leaves it unbound). Every channel is recorded in the DB immediately after
 * its Discord-side creation, one at a time — never batched at the end — so
 * a crash mid-loop leaves at most the one in-flight channel untracked; any
 * channel already created *and* recorded before a later failure is rolled
 * back (deleted, best-effort) rather than left as a half-created set. A
 * rollback delete that itself fails keeps its row rather than losing track
 * of the channel — the next `/voice-channel clear` or sweep tick cleans it
 * up.
 */
export async function createTemporaryVoiceChannels({
  guild,
  invokingChannelParentId,
  amount,
  groupSize,
  actorId,
}: CreateTempVoiceChannelsInput): Promise<CreateTempVoiceChannelsResult> {
  const settings = getSettings();
  const validation = validateTempVoiceRequest({ amount, groupSize, configuredMax: settings.tempVoiceMaxAmount });
  if (!validation.ok) return { ok: false, message: validation.message };

  if (countTemporaryVoiceChannels() > 0) {
    return { ok: false, message: "Es existiert bereits ein Satz temporärer Sprachkanäle. Nutze zuerst `/voice-channel clear`." };
  }

  const event = selectBindingEvent(listActiveEvents(), listUpcomingScheduledEvents());

  const configuredCategoryId = settings.tempVoiceCategoryId;
  const configuredCategoryExists = configuredCategoryId !== null && guild.channels.cache.get(configuredCategoryId)?.type === ChannelType.GuildCategory;
  // A stale dashboard setting (category deleted since) must not block the
  // command — silently fall back to root instead, and say so in the reply.
  const categoryFellBackToRoot = configuredCategoryId !== null && !configuredCategoryExists;
  const categoryId = resolveCategoryId(configuredCategoryExists ? configuredCategoryId : null, invokingChannelParentId);

  const createdChannelIds: string[] = [];
  const now = new Date().toISOString();

  for (let i = 1; i <= amount; i++) {
    const name = buildTempVoiceChannelName(settings.tempVoiceNameFormat, { index: i, eventTitle: event?.title ?? null });
    try {
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        userLimit: groupSize,
        parent: categoryId ?? undefined,
      });
      insertTemporaryVoiceChannel({ channelId: channel.id, guildId: guild.id, eventId: event?.id ?? null, createdAt: now, createdByUserId: actorId });
      createdChannelIds.push(channel.id);
    } catch (err) {
      logger.error(`/voice-channel create: Kanal ${i}/${amount} fehlgeschlagen, räume bereits erstellte Kanäle auf: ${errorMessage(err)}`);
      for (const channelId of createdChannelIds.reverse()) {
        await deleteManagedChannel(guild, { channelId, guildId: guild.id, eventId: event?.id ?? null, createdAt: now, createdByUserId: actorId });
      }
      return {
        ok: false,
        message: `Erstellung nach ${createdChannelIds.length} von ${amount} Kanälen fehlgeschlagen (${errorMessage(err)}). Bereits erstellte Kanäle wurden wieder entfernt.`,
      };
    }
  }

  return { ok: true, created: createdChannelIds.length, groupSize, categoryId, categoryFellBackToRoot, eventTitle: event?.title ?? null };
}

/** Deletes every currently-managed temporary voice channel immediately, regardless of binding. Safe to run repeatedly or concurrently with the sweep — each channel is only ever deleted once via `deleteManagedChannel()`. */
export async function clearTemporaryVoiceChannels(client: Client): Promise<ClearTempVoiceChannelsResult> {
  const rows = listTemporaryVoiceChannels();
  const result: ClearTempVoiceChannelsResult = { deleted: 0, alreadyGone: 0, failed: 0 };
  if (rows.length === 0) return result;

  const guild = client.guilds.cache.get(rows[0]!.guildId);
  if (!guild) {
    logger.warn("Temporäre Sprachkanäle können nicht gelöscht werden: Server nicht im Cache.");
    return { ...result, failed: rows.length };
  }

  for (const row of rows) {
    const outcome = await deleteManagedChannel(guild, row);
    if (outcome === "deleted") result.deleted++;
    else if (outcome === "already-gone") result.alreadyGone++;
    else result.failed++;
  }
  return result;
}

/**
 * Also serves as restart recovery — the exact same reconciliation applies
 * whether it's the first run after a crash or the 500th tick since. Cheap
 * to run every tick: returns immediately with no rows or an uncached guild,
 * and every other check is a `Collection` lookup, no Discord API call.
 */
export async function sweepTemporaryVoiceChannels(client: Client): Promise<void> {
  const rows = listTemporaryVoiceChannels();
  if (rows.length === 0) return;

  const guild = client.guilds.cache.get(rows[0]!.guildId);
  if (!guild) return;

  for (const row of rows) {
    if (!guild.channels.cache.has(row.channelId)) {
      // Reality has already diverged from our record (manually deleted,
      // Discord outage, ...) — drop the row rather than attempting a delete
      // that would only fail.
      deleteTemporaryVoiceChannel(row.channelId);
      continue;
    }
    const event: Event | null = row.eventId === null ? null : getEventById(row.eventId);
    if (isTempChannelDue(event, row.eventId)) {
      await deleteManagedChannel(guild, row);
    }
  }
}

