import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { VoiceState } from "discord.js";

// Same DATA_DIR-before-dynamic-import harness as the other temp-voice test
// files — see tests/db/temporaryVoiceChannels.test.ts's header comment.
const dataDir = mkdtempSync(path.join(tmpdir(), "leb-test-tempvoice-isolation-"));
process.env.DATA_DIR = dataDir;
process.env.LOG_DIR = path.join(dataDir, "logs");

const { createEvent, setEventActive, listVoiceLog } = await import("../../src/db/eventAttendanceRepository.js");
const { insertTemporaryVoiceChannel } = await import("../../src/db/temporaryVoiceChannelsRepository.js");
const { handleVoiceStateUpdate } = await import("../../src/events/eventWatcher.js");

function makeVoiceState(overrides: { channelId: string | null; userId: string; isBot?: boolean }): VoiceState {
  return {
    channelId: overrides.channelId,
    id: overrides.userId,
    member: { user: { bot: overrides.isBot ?? false } },
  } as unknown as VoiceState;
}

function makeActiveEvent(voiceChannelId: string) {
  const event = createEvent({
    messageId: `msg-${Math.random()}`,
    channelId: "chan-event",
    title: "Isolation Test Event",
    description: "",
    startsAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    configuredVoiceChannelId: null,
    useFont: false,
  });
  setEventActive(event.id, voiceChannelId, new Date().toISOString());
  return event;
}

test("handleVoiceStateUpdate: logs a join when the tracked channel is a real (non-temporary) voice channel", async () => {
  const event = makeActiveEvent("real-attendance-channel");

  await handleVoiceStateUpdate(
    makeVoiceState({ channelId: null, userId: "user-1" }),
    makeVoiceState({ channelId: "real-attendance-channel", userId: "user-1" }),
  );

  const log = listVoiceLog(event.id);
  assert.equal(log.length, 1);
  assert.equal(log[0]!.action, "join");
  assert.equal(log[0]!.userId, "user-1");
});

test("handleVoiceStateUpdate: appends nothing when the event's tracked channel is a bot-managed temporary voice channel", async () => {
  const TEMP_CHANNEL_ID = "temp-attendance-channel";
  insertTemporaryVoiceChannel({ channelId: TEMP_CHANNEL_ID, guildId: "guild-1", eventId: null, createdAt: new Date().toISOString(), createdByUserId: "u" });
  const event = makeActiveEvent(TEMP_CHANNEL_ID);

  await handleVoiceStateUpdate(makeVoiceState({ channelId: null, userId: "user-2" }), makeVoiceState({ channelId: TEMP_CHANNEL_ID, userId: "user-2" }));

  assert.equal(listVoiceLog(event.id).length, 0);
});

test("handleVoiceStateUpdate: still ignores bot members and unrelated channel moves, exactly as before the isolation guard was added", async () => {
  const event = makeActiveEvent("real-attendance-channel-2");

  await handleVoiceStateUpdate(makeVoiceState({ channelId: null, userId: "bot-1", isBot: true }), makeVoiceState({ channelId: "real-attendance-channel-2", userId: "bot-1", isBot: true }));
  await handleVoiceStateUpdate(makeVoiceState({ channelId: "some-other-channel", userId: "user-3" }), makeVoiceState({ channelId: "yet-another-channel", userId: "user-3" }));

  assert.equal(listVoiceLog(event.id).length, 0);
});
