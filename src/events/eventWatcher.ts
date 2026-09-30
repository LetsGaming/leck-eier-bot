import type { VoiceState } from "discord.js";
import { listActiveEvents, appendVoiceLog } from "../db/eventAttendanceRepository.js";
import { cancelEventByMessageId, handleEventRsvpButton, publishDueScheduledEvents } from "../services/events.js";
import { catchUpEvents, sweepEvents } from "../services/eventAttendance.js";
import { cleanupFinishedEventChannels } from "../services/eventChannelCleanup.js";
import { sweepTemporaryVoiceChannels, sweepPendingVoiceChannelMoves } from "../services/temporaryVoiceChannels.js";
import { isTemporaryVoiceChannel } from "../db/temporaryVoiceChannelsRepository.js";
import { handleCreateModalSubmit } from "../commands/general/event.js";
import { EVENT_SWEEP_INTERVAL_MS } from "../constants.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { BotClient } from "../types.js";

// Exported for tests/seam/temporaryVoiceIsolation.test.ts — not called directly by any other module.
export async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
  // Cheap early exit — mute/deafen/stream/video updates fire far more often
  // than an actual channel move and don't touch channelId at all.
  if (oldState.channelId === newState.channelId) return;

  const activeEvents = listActiveEvents();
  if (activeEvents.length === 0) return;
  if (activeEvents.length > 1) {
    logger.warn(`Mehrere aktive Events gleichzeitig (${activeEvents.length}) — Events sollten sich laut Konfiguration nie überschneiden. Verwende das früheste.`);
  }
  const event = activeEvents[0]!;
  if (!event.voiceChannelId) return;
  if (oldState.channelId !== event.voiceChannelId && newState.channelId !== event.voiceChannelId) return;
  if (newState.member?.user.bot) return;
  // Defensive belt-and-braces: settings/template pickers already exclude
  // temporary voice channels (see discordData.ts, generalSettings.ts,
  // eventTemplates.ts, services/events.ts), so this should be unreachable —
  // but a bot-managed temp channel must never produce attendance data even
  // if it somehow ended up as an event's tracked channel.
  if (isTemporaryVoiceChannel(event.voiceChannelId)) return;

  const startsAtMs = new Date(event.startsAt).getTime();
  const endsAtMs = new Date(event.endsAt).getTime();
  const now = Date.now();
  if (now > endsAtMs) return; // the completion sweep owns everything from ends_at onward

  const at = new Date(Math.min(Math.max(now, startsAtMs), endsAtMs)).toISOString();
  const action = newState.channelId === event.voiceChannelId ? "join" : "leave";
  appendVoiceLog([{ eventId: event.id, userId: newState.id, action, at }]);
}

export default function registerEventWatcher(client: BotClient): void {
  // A still-'scheduled' event whose message gets deleted (e.g. the organizer
  // or a moderator removes it) is cancelled rather than left dangling
  // forever — an already-active/completed event's message being deleted
  // doesn't retroactively erase its attendance history.
  client.on("messageDelete", (message) => {
    cancelEventByMessageId(message.id);
  });

  client.on("voiceStateUpdate", (oldState, newState) => {
    handleVoiceStateUpdate(oldState, newState).catch((err) =>
      logger.error(`Event-Sprachstatus-Verarbeitung fehlgeschlagen: ${errorMessage(err)}`),
    );
  });

  client.on("interactionCreate", (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith("event:rsvp:")) {
      handleEventRsvpButton(interaction).catch((err) => logger.error(`Unhandled error in event RSVP button handler: ${errorMessage(err)}`));
    } else if (interaction.isModalSubmit() && interaction.customId.startsWith("event:create-modal:")) {
      handleCreateModalSubmit(interaction).catch((err) => logger.error(`Unhandled error in event creation modal handler: ${errorMessage(err)}`));
    }
  });

  // Deferred to clientReady (unlike the other watchers' immediate sweeps) —
  // this needs the live voice-channel member list, which isn't populated
  // until the gateway session and its voice states are up.
  client.once("clientReady", () => {
    catchUpEvents(client).catch((err) => logger.error(`Event Start-Abgleich fehlgeschlagen: ${errorMessage(err)}`));
    publishDueScheduledEvents(client).catch((err) => logger.error(`Geplante Veröffentlichungen fehlgeschlagen: ${errorMessage(err)}`));
    // Doubles as restart recovery for temporary voice channels — reconciles
    // the DB against reality on the very first tick, same as catchUpEvents()
    // does for attendance.
    sweepTemporaryVoiceChannels(client).catch((err) => logger.error(`Temporäre-Sprachkanäle-Aufräumen fehlgeschlagen: ${errorMessage(err)}`));
    setInterval(() => {
      sweepEvents(client).catch((err) => logger.error(`Event-Sweep fehlgeschlagen: ${errorMessage(err)}`));
      // Piggybacked onto the same tick rather than its own timer — same
      // convention as registerWatcher.ts's sweepExpiredSessions/archive pair.
      publishDueScheduledEvents(client).catch((err) => logger.error(`Geplante Veröffentlichungen fehlgeschlagen: ${errorMessage(err)}`));
      cleanupFinishedEventChannels(client).catch((err) => logger.error(`Event-Kanal-Aufräumen fehlgeschlagen: ${errorMessage(err)}`));
      sweepTemporaryVoiceChannels(client).catch((err) => logger.error(`Temporäre-Sprachkanäle-Aufräumen fehlgeschlagen: ${errorMessage(err)}`));
      sweepPendingVoiceChannelMoves(client).catch((err) => logger.error(`Geplantes Zurückholen der Sprachkanal-Mitglieder fehlgeschlagen: ${errorMessage(err)}`));
    }, EVENT_SWEEP_INTERVAL_MS);
  });
}
