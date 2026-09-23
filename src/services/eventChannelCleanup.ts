import { PermissionsBitField } from "discord.js";
import {
  listEventsDueForChannelCleanup,
  listProtectedEventsInChannel,
  setEventChannelCleared,
} from "../db/eventAttendanceRepository.js";
import { getSettings } from "../db/settingsRepository.js";
import { bulkDeleteWithPagination } from "./messageCleanup.js";
import { DISCORD_ERROR_CODE_TOO_OLD_TO_DELETE, MESSAGE_DELETE_DELAY_MS } from "../constants.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { BotClient, Event } from "../types.js";

/**
 * Opt-in cleanup (`settings.eventChannelCleanupEnabled`): once an event has
 * been `completed` for at least `eventChannelCleanupDelayHours`, every other
 * message in its channel is deleted — except messages belonging to events
 * still `scheduled`/`active` in that same channel. Deleting a still-
 * `scheduled` event's message would trip `eventWatcher.ts`'s `messageDelete`
 * handler and silently cancel that event, so the protected-id filter is load
 * -bearing, not cosmetic.
 *
 * Runs on the same interval as `sweepEvents()` — see `eventWatcher.ts`.
 */
export async function cleanupFinishedEventChannels(client: BotClient): Promise<void> {
  const settings = getSettings();
  if (!settings.eventChannelCleanupEnabled) return;

  const cutoffIso = new Date(Date.now() - settings.eventChannelCleanupDelayHours * 60 * 60 * 1000).toISOString();
  const due = listEventsDueForChannelCleanup(cutoffIso);
  if (due.length === 0) return;

  const byChannel = new Map<string, Event[]>();
  for (const event of due) {
    const group = byChannel.get(event.channelId);
    if (group) group.push(event);
    else byChannel.set(event.channelId, [event]);
  }

  for (const [channelId, events] of byChannel) {
    await cleanupChannel(client, channelId, events);
  }
}

async function cleanupChannel(client: BotClient, channelId: string, events: Event[]): Promise<void> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !("bulkDelete" in channel)) {
    logger.warn(`Event-Kanal-Aufräumen: Kanal ${channelId} nicht verfügbar oder kein Server-Textkanal — übersprungen.`);
    return;
  }

  const me = channel.guild?.members.me;
  if (!me?.permissionsIn(channel.id).has(PermissionsBitField.Flags.ManageMessages)) {
    logger.warn(`Event-Kanal-Aufräumen: Fehlende Berechtigung "Nachrichten verwalten" in Kanal ${channelId} — übersprungen.`);
    return;
  }

  const protectedIds = new Set(listProtectedEventsInChannel(channelId).map((e) => e.messageId));

  await bulkDeleteWithPagination(channel, {
    amount: Infinity,
    filter: (m) => !protectedIds.has(m.id),
    delayMs: MESSAGE_DELETE_DELAY_MS,
    onDeleteError: (msg, err) => {
      if ((err as { code?: number }).code !== DISCORD_ERROR_CODE_TOO_OLD_TO_DELETE) {
        logger.warn(`Event-Kanal-Aufräumen: Löschen von Nachricht ${msg.id} fehlgeschlagen: ${errorMessage(err)}`);
      }
    },
    onBulkDeleteError: (err) => {
      logger.warn(`Event-Kanal-Aufräumen: Bulk-Löschung in Kanal ${channelId} fehlgeschlagen: ${errorMessage(err)}`);
    },
  });

  // Stamped even on partial failure — a permanently-undeletable message
  // must not make this channel retry every sweep tick forever.
  const now = new Date().toISOString();
  for (const event of events) setEventChannelCleared(event.id, now);
}
