import type { Message, PartialMessage, VoiceState } from "discord.js";
import { getSettings } from "../db/settingsRepository.js";
import {
  upsertApolloEvent,
  replaceEventSignups,
  listActiveEvents,
  appendVoiceLog,
  getEventByIdentity,
  setEventCancelled,
  type ParsedSignupInput,
} from "../db/eventAttendanceRepository.js";
import { parseApolloEventEmbed } from "../services/apolloEventParser.js";
import { resolveMemberByExactName, normalizeSignupName } from "../services/memberSearch.js";
import { catchUpApolloEvents, sweepApolloEvents } from "../services/eventAttendance.js";
import { APOLLO_EVENT_SWEEP_INTERVAL_MS } from "../constants.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { BotClient } from "../types.js";

// Opt-in raw-embed logging for validating/fixing the parser against a real
// Apollo message — see docs/EVENT_ATTENDANCE.md#verifying-against-a-real-embed.
// A plain env var (like LOG_DIR/LOG_LEVEL — see CONFIGURATION.md), not part
// of the validated bootstrap schema, since it's a debug toggle rather than a
// value the app needs to start: `LOG_APOLLO_EMBEDS=true` in `.env`, restart,
// no code edit required.
const LOG_APOLLO_EMBEDS = process.env.LOG_APOLLO_EMBEDS === "true";

async function tryHandleApolloMessage(client: BotClient, message: Message | PartialMessage): Promise<void> {
  // Deliberately independent of settings.apolloEventChannelId and every
  // other gate below — the whole point of this debug switch is to see a
  // message's raw shape *before* the channel/settings are configured
  // correctly, so it can't be gated behind the very configuration it's
  // meant to help verify. Any bot-authored message with an embed, in any
  // channel, gets logged while this is on.
  if (LOG_APOLLO_EMBEDS && message.author?.bot && message.embeds.length > 0) {
    logger.info(
      `Apollo-Debug (Kanal ${message.channelId}, Nachricht ${message.id}): embeds=${JSON.stringify(message.embeds)} components=${JSON.stringify(message.components)}`,
    );
  }

  const settings = getSettings();
  if (!settings.apolloEventChannelId || message.channelId !== settings.apolloEventChannelId) return;
  if (message.author?.id === client.user?.id) return;
  // Apollo posts as a bot/app — a human message in the same channel is just chat, not an event embed.
  if (!message.author?.bot) return;

  const parsed = parseApolloEventEmbed(message);
  if (!parsed) return;

  const event = upsertApolloEvent({
    apolloEventId: parsed.apolloEventId,
    messageId: message.id,
    channelId: message.channelId,
    title: parsed.title,
    startsAt: parsed.startsAt,
    endsAt: parsed.endsAt,
  });

  const signupInputs: ParsedSignupInput[] = parsed.signups.map((signup) => {
    const normalizedName = normalizeSignupName(signup.rawName);
    if (signup.mentionUserId) {
      return { rawName: signup.rawName, normalizedName, choice: signup.choice, userId: signup.mentionUserId, matchSource: "auto" };
    }
    const resolution = resolveMemberByExactName(signup.rawName);
    if (resolution.status === "matched") {
      return { rawName: signup.rawName, normalizedName, choice: signup.choice, userId: resolution.userId, matchSource: "auto" };
    }
    return { rawName: signup.rawName, normalizedName, choice: signup.choice, userId: null, matchSource: resolution.status };
  });

  replaceEventSignups(event.id, signupInputs, event.status);
  logger.info(`Apollo-Event "${event.title}" (#${event.id}) aktualisiert: ${signupInputs.length} Anmeldungen.`);
}

async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
  // Cheap early exit — mute/deafen/stream/video updates fire far more often
  // than an actual channel move and don't touch channelId at all.
  if (oldState.channelId === newState.channelId) return;

  const activeEvents = listActiveEvents();
  if (activeEvents.length === 0) return;
  if (activeEvents.length > 1) {
    logger.warn(
      `Mehrere aktive Apollo-Events gleichzeitig (${activeEvents.length}) — Events sollten sich laut Konfiguration nie überschneiden. Verwende das früheste.`,
    );
  }
  const event = activeEvents[0]!;
  if (!event.voiceChannelId) return;
  if (oldState.channelId !== event.voiceChannelId && newState.channelId !== event.voiceChannelId) return;
  if (newState.member?.user.bot) return;

  const startsAtMs = new Date(event.startsAt).getTime();
  const endsAtMs = new Date(event.endsAt).getTime();
  const now = Date.now();
  if (now > endsAtMs) return; // the completion sweep owns everything from ends_at onward

  const at = new Date(Math.min(Math.max(now, startsAtMs), endsAtMs)).toISOString();
  const action = newState.channelId === event.voiceChannelId ? "join" : "leave";
  appendVoiceLog([{ eventId: event.id, userId: newState.id, action, at }]);
}

export default function registerApolloEventWatcher(client: BotClient): void {
  const triggerUpdate = (message: Message | PartialMessage): void => {
    tryHandleApolloMessage(client, message).catch((err) =>
      logger.error(`Apollo-Event-Verarbeitung fehlgeschlagen: ${errorMessage(err)}`),
    );
  };

  client.on("messageCreate", triggerUpdate);
  client.on("messageUpdate", (_oldMessage, newMessage) => triggerUpdate(newMessage));

  // A still-'scheduled' event whose Apollo message gets deleted (e.g. the
  // organizer cancels it) is cancelled rather than left dangling forever —
  // an already-active/completed event's message being deleted doesn't
  // retroactively erase its attendance history.
  client.on("messageDelete", (message) => {
    const settings = getSettings();
    if (!settings.apolloEventChannelId || message.channelId !== settings.apolloEventChannelId) return;
    const event = getEventByIdentity(null, message.id);
    if (event && event.status === "scheduled") {
      setEventCancelled(event.id);
      logger.info(`Apollo-Event "${event.title}" (#${event.id}) storniert: Nachricht wurde gelöscht.`);
    }
  });

  client.on("voiceStateUpdate", (oldState, newState) => {
    handleVoiceStateUpdate(oldState, newState).catch((err) =>
      logger.error(`Apollo-Event Sprachstatus-Verarbeitung fehlgeschlagen: ${errorMessage(err)}`),
    );
  });

  // Deferred to clientReady (unlike the other watchers' immediate sweeps) —
  // this needs the live voice-channel member list, which isn't populated
  // until the gateway session and its voice states are up.
  client.once("clientReady", () => {
    catchUpApolloEvents(client).catch((err) => logger.error(`Apollo-Event Start-Abgleich fehlgeschlagen: ${errorMessage(err)}`));
    setInterval(() => {
      sweepApolloEvents(client).catch((err) => logger.error(`Apollo-Event-Sweep fehlgeschlagen: ${errorMessage(err)}`));
    }, APOLLO_EVENT_SWEEP_INTERVAL_MS);
  });
}
