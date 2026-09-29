import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Unlike most of tests/db/*, this file imports the real src/db/index.ts (and
// everything downstream of it) via a DYNAMIC import, after pointing
// DATA_DIR (and LOG_DIR) at a throwaway temp directory. This works because
// src/db/index.ts's only module-level import is ../constants.js,
// settingsRepository.ts adds only a bare EventEmitter (settingsBus.ts), and
// utils/logger.ts deliberately avoids loadConfig() — so no .env/Discord-
// credential validation runs on this import path. If a future change adds a
// module-level loadConfig() anywhere on this chain, this file's imports
// will start failing here rather than silently touching the real database —
// that failure is the signal to revisit this comment.
const dataDir = mkdtempSync(path.join(tmpdir(), "leb-test-tempvoice-"));
process.env.DATA_DIR = dataDir;
process.env.LOG_DIR = path.join(dataDir, "logs");

const { db } = await import("../../src/db/index.js");
const { getSettings, updateSettings } = await import("../../src/db/settingsRepository.js");
const {
  insertTemporaryVoiceChannel,
  listTemporaryVoiceChannels,
  listTemporaryVoiceChannelIds,
  countTemporaryVoiceChannels,
  isTemporaryVoiceChannel,
  deleteTemporaryVoiceChannel,
} = await import("../../src/db/temporaryVoiceChannelsRepository.js");

// --- migration v41 -----------------------------------------------------------

test("migration v41: settings row has the expected defaults", () => {
  const settings = getSettings();
  assert.equal(settings.tempVoiceCategoryId, null);
  assert.equal(settings.tempVoiceMaxAmount, 15);
  assert.equal(settings.tempVoiceNameFormat, "Gruppe {n}");
});

test("migration v41: temporary_voice_channels table exists with the expected columns", () => {
  const columns = db.prepare("PRAGMA table_info(temporary_voice_channels)").all() as { name: string }[];
  const names = columns.map((c) => c.name).sort();
  assert.deepEqual(names, ["channel_id", "created_at", "created_by_user_id", "event_id", "guild_id"].sort());
});

// --- settings round-trip -----------------------------------------------------

test("settings: tempVoice* fields round-trip through updateSettings/getSettings", () => {
  const updated = updateSettings({ tempVoiceCategoryId: "cat-1", tempVoiceMaxAmount: 5, tempVoiceNameFormat: "{event} Team {n}" });
  assert.equal(updated.tempVoiceCategoryId, "cat-1");
  assert.equal(updated.tempVoiceMaxAmount, 5);
  assert.equal(updated.tempVoiceNameFormat, "{event} Team {n}");

  const reread = getSettings();
  assert.equal(reread.tempVoiceCategoryId, "cat-1");
  assert.equal(reread.tempVoiceMaxAmount, 5);
  assert.equal(reread.tempVoiceNameFormat, "{event} Team {n}");

  // Restore defaults for the tests below.
  updateSettings({ tempVoiceCategoryId: null, tempVoiceMaxAmount: 15, tempVoiceNameFormat: "Gruppe {n}" });
});

test("settings: tempVoiceCategoryId can be cleared back to null", () => {
  updateSettings({ tempVoiceCategoryId: "cat-2" });
  assert.equal(getSettings().tempVoiceCategoryId, "cat-2");
  updateSettings({ tempVoiceCategoryId: null });
  assert.equal(getSettings().tempVoiceCategoryId, null);
});

// --- repository CRUD ----------------------------------------------------------

test("repository: insert, list, count, and delete a temporary voice channel", () => {
  assert.equal(countTemporaryVoiceChannels(), 0);
  insertTemporaryVoiceChannel({ channelId: "chan-a", guildId: "guild-1", eventId: null, createdAt: "2026-01-01T00:00:00.000Z", createdByUserId: "user-1" });
  assert.equal(countTemporaryVoiceChannels(), 1);
  assert.equal(isTemporaryVoiceChannel("chan-a"), true);
  assert.equal(isTemporaryVoiceChannel("chan-nonexistent"), false);
  assert.deepEqual(listTemporaryVoiceChannelIds(), ["chan-a"]);

  deleteTemporaryVoiceChannel("chan-a");
  assert.equal(countTemporaryVoiceChannels(), 0);
  assert.equal(isTemporaryVoiceChannel("chan-a"), false);
});

test("repository: INSERT OR IGNORE — inserting a duplicate channel_id is a silent no-op", () => {
  insertTemporaryVoiceChannel({ channelId: "chan-b", guildId: "guild-1", eventId: 1, createdAt: "2026-01-01T00:00:00.000Z", createdByUserId: "user-1" });
  insertTemporaryVoiceChannel({ channelId: "chan-b", guildId: "guild-1", eventId: 2, createdAt: "2026-01-02T00:00:00.000Z", createdByUserId: "user-2" });
  assert.equal(countTemporaryVoiceChannels(), 1);
  const rows = listTemporaryVoiceChannels();
  assert.equal(rows[0]!.eventId, 1); // the original insert wins, the duplicate is ignored
  deleteTemporaryVoiceChannel("chan-b");
});

test("repository: deleting an absent channel id is a no-op, not an error", () => {
  assert.doesNotThrow(() => deleteTemporaryVoiceChannel("never-existed"));
});

test("repository: event_id has no foreign key — a dangling reference survives and is still readable", () => {
  insertTemporaryVoiceChannel({ channelId: "chan-c", guildId: "guild-1", eventId: 999999, createdAt: "2026-01-01T00:00:00.000Z", createdByUserId: "user-1" });
  const rows = listTemporaryVoiceChannels();
  const row = rows.find((r) => r.channelId === "chan-c");
  assert.equal(row?.eventId, 999999);
  deleteTemporaryVoiceChannel("chan-c");
});
