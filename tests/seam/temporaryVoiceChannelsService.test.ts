import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Collection, ChannelType } from "discord.js";

// Same DATA_DIR-before-dynamic-import harness as tests/db/temporaryVoiceChannels.test.ts
// — see that file's header comment for why this is safe. This file additionally
// hand-rolls minimal discord.js-shaped `guild`/`channel` objects (real `Collection`,
// real `ChannelType`), matching the style of tests/seam/commandPermissions.test.ts.
const dataDir = mkdtempSync(path.join(tmpdir(), "leb-test-tempvoice-svc-"));
process.env.DATA_DIR = dataDir;
process.env.LOG_DIR = path.join(dataDir, "logs");

const { updateSettings } = await import("../../src/db/settingsRepository.js");
const { createEvent, setEventActive, setEventCompleted, setEventCancelled } = await import("../../src/db/eventAttendanceRepository.js");
const { listTemporaryVoiceChannels, countTemporaryVoiceChannels, insertTemporaryVoiceChannel } = await import(
  "../../src/db/temporaryVoiceChannelsRepository.js"
);
const { createTemporaryVoiceChannels, clearTemporaryVoiceChannels, sweepTemporaryVoiceChannels } = await import(
  "../../src/services/temporaryVoiceChannels.js"
);

const GUILD_ID = "guild-1";
const UNKNOWN_CHANNEL_ERROR = Object.assign(new Error("Unknown Channel"), { code: 10003 });

interface FakeChannel {
  id: string;
  type: ChannelType;
  parentId: string | null;
  deleteImpl: () => Promise<void>;
  delete(reason?: string): Promise<void>;
}

function makeChannel(id: string, opts: { type?: ChannelType; parentId?: string | null; deleteImpl?: () => Promise<void> } = {}): FakeChannel {
  const channel: FakeChannel = {
    id,
    type: opts.type ?? ChannelType.GuildVoice,
    parentId: opts.parentId ?? null,
    deleteImpl: opts.deleteImpl ?? (async () => {}),
    async delete() {
      await this.deleteImpl();
    },
  };
  return channel;
}

/** A minimal `Guild`-shaped object: a real `Collection` cache plus a configurable `create()`. */
function makeGuild(opts: { initialChannels?: FakeChannel[]; createImpl?: (opts: { name: string; type: ChannelType; userLimit: number; parent?: string }) => Promise<FakeChannel> } = {}) {
  const cache = new Collection<string, FakeChannel>();
  for (const ch of opts.initialChannels ?? []) cache.set(ch.id, ch);
  let nextId = 1;
  const defaultCreate = async (createOpts: { name: string; type: ChannelType; userLimit: number; parent?: string }) => {
    const channel = makeChannel(`created-${nextId++}`, { type: createOpts.type, parentId: createOpts.parent ?? null });
    channel.deleteImpl = async () => {
      cache.delete(channel.id);
    };
    cache.set(channel.id, channel);
    return channel;
  };
  return {
    id: GUILD_ID,
    channels: {
      cache,
      create: opts.createImpl ?? defaultCreate,
    },
  };
}

function resetTempVoiceSettings() {
  updateSettings({ tempVoiceCategoryId: null, tempVoiceMaxAmount: 15, tempVoiceNameFormat: "Gruppe {n}" });
}

function makeScheduledEvent(overrides: Partial<{ startsAt: string }> = {}) {
  return createEvent({
    messageId: `msg-${Math.random()}`,
    channelId: "chan-event",
    title: "Turnier",
    description: "",
    startsAt: overrides.startsAt ?? new Date(Date.now() + 10 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 70 * 60_000).toISOString(),
    configuredVoiceChannelId: null,
    useFont: false,
  });
}

async function clearAllTempVoiceRows() {
  for (const row of listTemporaryVoiceChannels()) {
    // Bypass the service for cleanup between tests — direct repository access.
    const { deleteTemporaryVoiceChannel } = await import("../../src/db/temporaryVoiceChannelsRepository.js");
    deleteTemporaryVoiceChannel(row.channelId);
  }
}

// --- create: channel count + user limit -------------------------------------

test("createTemporaryVoiceChannels: creates the requested number of channels with the requested user limit", async () => {
  resetTempVoiceSettings();
  const guild = makeGuild();
  const calls: { userLimit: number; type: ChannelType }[] = [];
  guild.channels.create = async (opts) => {
    calls.push({ userLimit: opts.userLimit, type: opts.type });
    const channel = makeChannel(`c${calls.length}`, { type: opts.type });
    channel.deleteImpl = async () => guild.channels.cache.delete(channel.id);
    guild.channels.cache.set(channel.id, channel);
    return channel;
  };

  const result = await createTemporaryVoiceChannels({ guild: guild as never, invokingChannelParentId: null, amount: 4, groupSize: 6, actorId: "user-1" });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.userLimit === 6 && c.type === ChannelType.GuildVoice));
  assert.equal(countTemporaryVoiceChannels(), 4);

  await clearAllTempVoiceRows();
});

// --- category placement ------------------------------------------------------

test("createTemporaryVoiceChannels: uses the configured category over the invoking channel's parent", async () => {
  resetTempVoiceSettings();
  const category = makeChannel("cat-configured", { type: ChannelType.GuildCategory });
  updateSettings({ tempVoiceCategoryId: category.id });
  const guild = makeGuild({ initialChannels: [category] });

  const result = await createTemporaryVoiceChannels({ guild: guild as never, invokingChannelParentId: "cat-invoking", amount: 1, groupSize: 2, actorId: "u" });

  assert.equal(result.ok, true);
  assert.ok(result.ok && result.categoryId === "cat-configured");
  await clearAllTempVoiceRows();
  resetTempVoiceSettings();
});

test("createTemporaryVoiceChannels: falls back to the invoking channel's parent when no category is configured", async () => {
  resetTempVoiceSettings();
  const guild = makeGuild();
  const result = await createTemporaryVoiceChannels({ guild: guild as never, invokingChannelParentId: "cat-invoking", amount: 1, groupSize: 2, actorId: "u" });
  assert.ok(result.ok && result.categoryId === "cat-invoking");
  await clearAllTempVoiceRows();
});

test("createTemporaryVoiceChannels: falls back to the guild root when neither is set", async () => {
  resetTempVoiceSettings();
  const guild = makeGuild();
  const result = await createTemporaryVoiceChannels({ guild: guild as never, invokingChannelParentId: null, amount: 1, groupSize: 2, actorId: "u" });
  assert.ok(result.ok && result.categoryId === null && result.categoryFellBackToRoot === false);
  await clearAllTempVoiceRows();
});

test("createTemporaryVoiceChannels: a configured-but-vanished category falls back to root instead of blocking the command", async () => {
  resetTempVoiceSettings();
  updateSettings({ tempVoiceCategoryId: "cat-does-not-exist" });
  const guild = makeGuild(); // the category is not in the cache
  const result = await createTemporaryVoiceChannels({ guild: guild as never, invokingChannelParentId: null, amount: 1, groupSize: 2, actorId: "u" });
  assert.ok(result.ok && result.categoryFellBackToRoot === true);
  await clearAllTempVoiceRows();
  resetTempVoiceSettings();
});

// --- partial API failure + rollback ------------------------------------------

test("createTemporaryVoiceChannels: a failure partway through rolls back every channel already created", async () => {
  resetTempVoiceSettings();
  const guild = makeGuild();
  let calls = 0;
  const deletedIds: string[] = [];
  guild.channels.create = async (opts) => {
    calls++;
    if (calls === 3) throw new Error("rate limited");
    const channel = makeChannel(`c${calls}`, { type: opts.type });
    channel.deleteImpl = async () => {
      deletedIds.push(channel.id);
      guild.channels.cache.delete(channel.id);
    };
    guild.channels.cache.set(channel.id, channel);
    return channel;
  };

  const result = await createTemporaryVoiceChannels({ guild: guild as never, invokingChannelParentId: null, amount: 4, groupSize: 2, actorId: "u" });

  assert.equal(result.ok, false);
  assert.equal(countTemporaryVoiceChannels(), 0);
  assert.deepEqual(deletedIds.sort(), ["c1", "c2"]);
});

test("createTemporaryVoiceChannels: a rollback delete that itself fails keeps that channel's row, cleaned up by a later clear()", async () => {
  resetTempVoiceSettings();
  const guild = makeGuild();
  let calls = 0;
  guild.channels.create = async (opts) => {
    calls++;
    if (calls === 3) throw new Error("boom");
    const channel = makeChannel(`c${calls}`, { type: opts.type });
    channel.deleteImpl = calls === 1 ? async () => Promise.reject(new Error("permission revoked")) : async () => guild.channels.cache.delete(channel.id);
    guild.channels.cache.set(channel.id, channel);
    return channel;
  };

  const result = await createTemporaryVoiceChannels({ guild: guild as never, invokingChannelParentId: null, amount: 4, groupSize: 2, actorId: "u" });
  assert.equal(result.ok, false);
  // c1's rollback delete failed -> its row survives; c2's succeeded.
  assert.equal(countTemporaryVoiceChannels(), 1);
  assert.equal(listTemporaryVoiceChannels()[0]!.channelId, "c1");

  // A later clear() with a working delete cleans it up.
  guild.channels.cache.get("c1")!.deleteImpl = async () => guild.channels.cache.delete("c1");
  const clearResult = await clearTemporaryVoiceChannels({ guilds: { cache: new Collection([[GUILD_ID, guild]]) } } as never);
  assert.equal(clearResult.deleted, 1);
  assert.equal(countTemporaryVoiceChannels(), 0);
});

// --- reject a second create while a set is live ------------------------------

test("createTemporaryVoiceChannels: rejects a new set while one already exists", async () => {
  resetTempVoiceSettings();
  insertTemporaryVoiceChannel({ channelId: "existing", guildId: GUILD_ID, eventId: null, createdAt: new Date().toISOString(), createdByUserId: "u" });
  const guild = makeGuild();
  let createCalls = 0;
  guild.channels.create = async (opts) => {
    createCalls++;
    return makeChannel("should-not-be-created", { type: opts.type });
  };

  const result = await createTemporaryVoiceChannels({ guild: guild as never, invokingChannelParentId: null, amount: 2, groupSize: 2, actorId: "u" });
  assert.equal(result.ok, false);
  assert.equal(createCalls, 0);

  await clearAllTempVoiceRows();
});

// --- clear --------------------------------------------------------------------

test("clearTemporaryVoiceChannels: deletes every managed channel including unbound ones, and reports accurate counts", async () => {
  resetTempVoiceSettings();
  const event = makeScheduledEvent();
  const bound = makeChannel("bound-1");
  const unbound = makeChannel("unbound-1");
  const guild = makeGuild({ initialChannels: [bound, unbound] });
  bound.deleteImpl = async () => guild.channels.cache.delete(bound.id);
  unbound.deleteImpl = async () => guild.channels.cache.delete(unbound.id);
  insertTemporaryVoiceChannel({ channelId: bound.id, guildId: GUILD_ID, eventId: event.id, createdAt: new Date().toISOString(), createdByUserId: "u" });
  insertTemporaryVoiceChannel({ channelId: unbound.id, guildId: GUILD_ID, eventId: null, createdAt: new Date().toISOString(), createdByUserId: "u" });

  const result = await clearTemporaryVoiceChannels({ guilds: { cache: new Collection([[GUILD_ID, guild]]) } } as never);
  assert.equal(result.deleted, 2);
  assert.equal(countTemporaryVoiceChannels(), 0);
});

// --- repeated / idempotent cleanup --------------------------------------------

test("clearTemporaryVoiceChannels: running it twice in a row does nothing the second time and throws nothing", async () => {
  resetTempVoiceSettings();
  const channel = makeChannel("solo");
  const guild = makeGuild({ initialChannels: [channel] });
  channel.deleteImpl = async () => guild.channels.cache.delete(channel.id);
  insertTemporaryVoiceChannel({ channelId: channel.id, guildId: GUILD_ID, eventId: null, createdAt: new Date().toISOString(), createdByUserId: "u" });

  const client = { guilds: { cache: new Collection([[GUILD_ID, guild]]) } } as never;
  const first = await clearTemporaryVoiceChannels(client);
  assert.equal(first.deleted, 1);
  const second = await clearTemporaryVoiceChannels(client);
  assert.deepEqual(second, { deleted: 0, alreadyGone: 0, failed: 0 });
});

test("sweepTemporaryVoiceChannels: running it repeatedly after the bound event completes is idempotent", async () => {
  resetTempVoiceSettings();
  const event = makeScheduledEvent();
  setEventActive(event.id, "chan-voice", new Date().toISOString());
  setEventCompleted(event.id, new Date().toISOString());

  const channel = makeChannel("swept");
  const guild = makeGuild({ initialChannels: [channel] });
  channel.deleteImpl = async () => guild.channels.cache.delete(channel.id);
  insertTemporaryVoiceChannel({ channelId: channel.id, guildId: GUILD_ID, eventId: event.id, createdAt: new Date().toISOString(), createdByUserId: "u" });

  const client = { guilds: { cache: new Collection([[GUILD_ID, guild]]) } } as never;
  await sweepTemporaryVoiceChannels(client);
  assert.equal(countTemporaryVoiceChannels(), 0);
  // Two more sweeps with nothing left: no throw, no change.
  await sweepTemporaryVoiceChannels(client);
  await sweepTemporaryVoiceChannels(client);
  assert.equal(countTemporaryVoiceChannels(), 0);
});

// --- missing channel / already-gone -------------------------------------------

test("sweep/clear: a row whose channel is absent from the guild cache is dropped without attempting a delete", async () => {
  resetTempVoiceSettings();
  const guild = makeGuild(); // channel deliberately not in the cache
  insertTemporaryVoiceChannel({ channelId: "ghost", guildId: GUILD_ID, eventId: null, createdAt: new Date().toISOString(), createdByUserId: "u" });

  const client = { guilds: { cache: new Collection([[GUILD_ID, guild]]) } } as never;
  const result = await clearTemporaryVoiceChannels(client);
  assert.equal(result.alreadyGone, 1);
  assert.equal(result.deleted, 0);
  assert.equal(countTemporaryVoiceChannels(), 0);
});

test("clear: a delete() rejecting with Discord's Unknown Channel code counts as already-gone, not a failure", async () => {
  resetTempVoiceSettings();
  const channel = makeChannel("vanishing");
  channel.deleteImpl = async () => Promise.reject(UNKNOWN_CHANNEL_ERROR);
  const guild = makeGuild({ initialChannels: [channel] });
  insertTemporaryVoiceChannel({ channelId: channel.id, guildId: GUILD_ID, eventId: null, createdAt: new Date().toISOString(), createdByUserId: "u" });

  const result = await clearTemporaryVoiceChannels({ guilds: { cache: new Collection([[GUILD_ID, guild]]) } } as never);
  assert.equal(result.alreadyGone, 1);
  assert.equal(result.failed, 0);
  assert.equal(countTemporaryVoiceChannels(), 0);
});

// --- automatic event-end cleanup ----------------------------------------------

test("sweepTemporaryVoiceChannels: deletes channels bound to a completed or cancelled event, leaves active and unbound rows alone", async () => {
  resetTempVoiceSettings();
  const completedEvent = makeScheduledEvent();
  setEventActive(completedEvent.id, "chan-voice", new Date().toISOString());
  setEventCompleted(completedEvent.id, new Date().toISOString());

  const cancelledEvent = makeScheduledEvent();
  setEventCancelled(cancelledEvent.id);

  const activeEvent = makeScheduledEvent();
  setEventActive(activeEvent.id, "chan-voice-2", new Date().toISOString());

  const completedChannel = makeChannel("ch-completed");
  const cancelledChannel = makeChannel("ch-cancelled");
  const activeChannel = makeChannel("ch-active");
  const unboundChannel = makeChannel("ch-unbound");
  const guild = makeGuild({ initialChannels: [completedChannel, cancelledChannel, activeChannel, unboundChannel] });
  for (const ch of [completedChannel, cancelledChannel, activeChannel, unboundChannel]) {
    ch.deleteImpl = async () => guild.channels.cache.delete(ch.id);
  }
  const now = new Date().toISOString();
  insertTemporaryVoiceChannel({ channelId: completedChannel.id, guildId: GUILD_ID, eventId: completedEvent.id, createdAt: now, createdByUserId: "u" });
  insertTemporaryVoiceChannel({ channelId: cancelledChannel.id, guildId: GUILD_ID, eventId: cancelledEvent.id, createdAt: now, createdByUserId: "u" });
  insertTemporaryVoiceChannel({ channelId: activeChannel.id, guildId: GUILD_ID, eventId: activeEvent.id, createdAt: now, createdByUserId: "u" });
  insertTemporaryVoiceChannel({ channelId: unboundChannel.id, guildId: GUILD_ID, eventId: null, createdAt: now, createdByUserId: "u" });

  await sweepTemporaryVoiceChannels({ guilds: { cache: new Collection([[GUILD_ID, guild]]) } } as never);

  const remaining = new Set(listTemporaryVoiceChannels().map((r) => r.channelId));
  assert.deepEqual(remaining, new Set([activeChannel.id, unboundChannel.id]));

  await clearAllTempVoiceRows();
});

test("sweepTemporaryVoiceChannels: a row bound to a since-deleted event row is due (no foreign key survives the dangling id)", async () => {
  resetTempVoiceSettings();
  const channel = makeChannel("ch-orphan-event");
  const guild = makeGuild({ initialChannels: [channel] });
  channel.deleteImpl = async () => guild.channels.cache.delete(channel.id);
  insertTemporaryVoiceChannel({ channelId: channel.id, guildId: GUILD_ID, eventId: 987654, createdAt: new Date().toISOString(), createdByUserId: "u" });

  await sweepTemporaryVoiceChannels({ guilds: { cache: new Collection([[GUILD_ID, guild]]) } } as never);
  assert.equal(countTemporaryVoiceChannels(), 0);
});

// --- restart recovery ----------------------------------------------------------

test("sweepTemporaryVoiceChannels (restart recovery): reconciles rows left over from before a restart with no orphans and no spurious deletes", async () => {
  resetTempVoiceSettings();
  const stillCompletedEvent = makeScheduledEvent();
  setEventActive(stillCompletedEvent.id, "chan-voice-3", new Date().toISOString());
  setEventCompleted(stillCompletedEvent.id, new Date().toISOString());
  const stillActiveEvent = makeScheduledEvent();
  setEventActive(stillActiveEvent.id, "chan-voice-4", new Date().toISOString());

  // Simulate three rows written before a "restart" — one channel already
  // manually deleted while the bot was down (absent from the fresh guild
  // cache), one bound to a now-completed event, one bound to a still-active
  // event.
  const survivingCompletedChannel = makeChannel("recovered-completed");
  const survivingActiveChannel = makeChannel("recovered-active");
  survivingCompletedChannel.deleteImpl = async () => guild.channels.cache.delete(survivingCompletedChannel.id);
  survivingActiveChannel.deleteImpl = async () => guild.channels.cache.delete(survivingActiveChannel.id);
  const guild = makeGuild({ initialChannels: [survivingCompletedChannel, survivingActiveChannel] }); // "manually-deleted" channel is NOT in the fresh cache

  const now = new Date().toISOString();
  insertTemporaryVoiceChannel({ channelId: "manually-deleted", guildId: GUILD_ID, eventId: stillCompletedEvent.id, createdAt: now, createdByUserId: "u" });
  insertTemporaryVoiceChannel({ channelId: survivingCompletedChannel.id, guildId: GUILD_ID, eventId: stillCompletedEvent.id, createdAt: now, createdByUserId: "u" });
  insertTemporaryVoiceChannel({ channelId: survivingActiveChannel.id, guildId: GUILD_ID, eventId: stillActiveEvent.id, createdAt: now, createdByUserId: "u" });

  await sweepTemporaryVoiceChannels({ guilds: { cache: new Collection([[GUILD_ID, guild]]) } } as never);

  const remaining = new Set(listTemporaryVoiceChannels().map((r) => r.channelId));
  assert.deepEqual(remaining, new Set([survivingActiveChannel.id]));
  assert.equal(guild.channels.cache.has(survivingCompletedChannel.id), false);
  assert.equal(guild.channels.cache.has(survivingActiveChannel.id), true);

  await clearAllTempVoiceRows();
});

// --- configuration change while channels exist --------------------------------

test("sweep/clear are unaffected by a settings change made after channels were created", async () => {
  resetTempVoiceSettings();
  const channel = makeChannel("cfg-change");
  const guild = makeGuild({ initialChannels: [channel] });
  channel.deleteImpl = async () => guild.channels.cache.delete(channel.id);
  insertTemporaryVoiceChannel({ channelId: channel.id, guildId: GUILD_ID, eventId: null, createdAt: new Date().toISOString(), createdByUserId: "u" });

  // Lower the max amount and clear the category after the channel already exists.
  updateSettings({ tempVoiceMaxAmount: 1, tempVoiceCategoryId: null });

  const result = await clearTemporaryVoiceChannels({ guilds: { cache: new Collection([[GUILD_ID, guild]]) } } as never);
  assert.equal(result.deleted, 1);

  resetTempVoiceSettings();
});
