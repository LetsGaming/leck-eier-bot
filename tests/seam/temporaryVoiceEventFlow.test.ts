import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Collection, ChannelType } from "discord.js";
import type { VoiceState } from "discord.js";

// Realistic end-to-end flow, not just isolated unit behavior — an event
// activates, temporary group voice channels are created for it, members
// interact with both the real attendance channel and a temp channel, the
// event completes, and the temp channels are auto-cleaned. Same
// DATA_DIR-before-dynamic-import harness as the other temp-voice test files.
const dataDir = mkdtempSync(path.join(tmpdir(), "leb-test-tempvoice-flow-"));
process.env.DATA_DIR = dataDir;
process.env.LOG_DIR = path.join(dataDir, "logs");

const { db } = await import("../../src/db/index.js");
const { createEvent, getEventById, listVoiceLog } = await import("../../src/db/eventAttendanceRepository.js");
const { sweepEvents } = await import("../../src/services/eventAttendance.js");
const { createTemporaryVoiceChannels, clearTemporaryVoiceChannels, sweepTemporaryVoiceChannels } = await import(
  "../../src/services/temporaryVoiceChannels.js"
);
const { listTemporaryVoiceChannels, countTemporaryVoiceChannels } = await import("../../src/db/temporaryVoiceChannelsRepository.js");
const { handleVoiceStateUpdate } = await import("../../src/events/eventWatcher.js");

const GUILD_ID = "flow-guild";
const REAL_ATTENDANCE_CHANNEL_ID = "flow-real-vc";

function makeVoiceState(overrides: { channelId: string | null; userId: string }): VoiceState {
  return { channelId: overrides.channelId, id: overrides.userId, member: { user: { bot: false } } } as unknown as VoiceState;
}

test("realistic flow: event activates, temp channels are created and used, event completes, temp channels auto-clean without touching attendance", async () => {
  // --- setup: a scheduled event, due to activate immediately ---------------
  const event = createEvent({
    messageId: `msg-flow`,
    channelId: "flow-announce-channel",
    title: "Flow-Turnier",
    description: "",
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 2 * 60_000).toISOString(),
    configuredVoiceChannelId: REAL_ATTENDANCE_CHANNEL_ID,
    useFont: false,
  });

  // The one fake client + guild the whole flow shares.
  const tempChannels = new Collection<string, { id: string; type: ChannelType; delete: () => Promise<void> }>();
  const guild = {
    id: GUILD_ID,
    channels: {
      cache: tempChannels,
      create: async (opts: { type: ChannelType }) => {
        const channel = { id: `flow-temp-${tempChannels.size + 1}`, type: opts.type, delete: async () => void tempChannels.delete(channel.id) };
        tempChannels.set(channel.id, channel);
        return channel;
      },
    },
  };
  const attendanceMembers = new Collection([
    ["user-a", { user: { bot: false } }],
    ["user-b", { user: { bot: false } }],
  ]);
  const client = {
    channels: {
      fetch: async (id: string) => {
        if (id === REAL_ATTENDANCE_CHANNEL_ID) {
          return { isVoiceBased: () => true, isTextBased: () => false, members: attendanceMembers };
        }
        return null;
      },
    },
    guilds: { cache: new Collection([[GUILD_ID, guild]]) },
  } as never;

  // --- activate: sweepEvents snapshots user-a/user-b as present at start ---
  await sweepEvents(client);
  assert.equal(getEventById(event.id)!.status, "active");
  const afterActivation = listVoiceLog(event.id);
  assert.equal(afterActivation.length, 2);
  assert.ok(afterActivation.every((r) => r.action === "present_at_start"));

  // --- create the group voice channels, bound to the now-active event -----
  const created = await createTemporaryVoiceChannels({ guild: guild as never, invokingChannelParentId: null, amount: 3, groupSize: 5, actorId: "admin-1" });
  assert.equal(created.ok, true);
  assert.ok(created.ok && created.eventTitle === "Flow-Turnier");
  assert.equal(countTemporaryVoiceChannels(), 3);
  const [firstTempChannelId] = listTemporaryVoiceChannels().map((r) => r.channelId);

  // --- live voice activity: a join on the real channel is tracked, a join on a temp channel is not ---
  await handleVoiceStateUpdate(makeVoiceState({ channelId: null, userId: "user-c" }), makeVoiceState({ channelId: REAL_ATTENDANCE_CHANNEL_ID, userId: "user-c" }));
  await handleVoiceStateUpdate(makeVoiceState({ channelId: null, userId: "user-d" }), makeVoiceState({ channelId: firstTempChannelId!, userId: "user-d" }));

  const midEventLog = listVoiceLog(event.id);
  assert.equal(midEventLog.length, 3); // 2 present_at_start + user-c's join; nothing from user-d's temp-channel join
  assert.ok(midEventLog.some((r) => r.userId === "user-c" && r.action === "join"));
  assert.ok(!midEventLog.some((r) => r.userId === "user-d"));

  // --- repeated sweeps while still active: temp channels untouched --------
  await sweepTemporaryVoiceChannels(client);
  await sweepTemporaryVoiceChannels(client);
  assert.equal(countTemporaryVoiceChannels(), 3);

  // --- simulate time passing: move ends_at into the past, then complete ---
  db.prepare("UPDATE events SET ends_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), event.id);
  await sweepEvents(client);
  assert.equal(getEventById(event.id)!.status, "completed");

  // --- the next sweep deletes all 3 now-orphaned temp channels -------------
  await sweepTemporaryVoiceChannels(client);
  assert.equal(countTemporaryVoiceChannels(), 0);
  assert.equal(tempChannels.size, 0);

  // --- further sweeps and a manual clear are both no-ops --------------------
  await sweepTemporaryVoiceChannels(client);
  const clearResult = await clearTemporaryVoiceChannels(client);
  assert.deepEqual(clearResult, { deleted: 0, alreadyGone: 0, failed: 0 });

  // --- final check: the temp-channel activity never touched the attendance log ---
  const finalLog = listVoiceLog(event.id);
  assert.ok(!finalLog.some((r) => r.userId === "user-d"));
});
