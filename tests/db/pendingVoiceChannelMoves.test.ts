import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Same DATA_DIR-before-dynamic-import harness as tests/db/temporaryVoiceChannels.test.ts.
const dataDir = mkdtempSync(path.join(tmpdir(), "leb-test-pendingmove-"));
process.env.DATA_DIR = dataDir;
process.env.LOG_DIR = path.join(dataDir, "logs");

const { db } = await import("../../src/db/index.js");
const {
  listPendingVoiceChannelMoves,
  listDuePendingVoiceChannelMoves,
  replacePendingVoiceChannelMove,
  deletePendingVoiceChannelMove,
  clearPendingVoiceChannelMoves,
} = await import("../../src/db/pendingVoiceChannelMovesRepository.js");

test("migration: pending_voice_channel_moves table exists with the expected columns", () => {
  const columns = db.prepare("PRAGMA table_info(pending_voice_channel_moves)").all() as { name: string }[];
  const names = columns.map((c) => c.name).sort();
  assert.deepEqual(names, ["created_at", "due_at", "guild_id", "id", "requested_by_user_id"].sort());
});

test("replacePendingVoiceChannelMove: inserts a row, readable back via listPendingVoiceChannelMoves", () => {
  const row = replacePendingVoiceChannelMove({ guildId: "guild-1", dueAt: "2026-01-01T00:10:00.000Z", requestedByUserId: "user-1" });
  assert.equal(row.guildId, "guild-1");
  assert.equal(row.dueAt, "2026-01-01T00:10:00.000Z");
  assert.equal(row.requestedByUserId, "user-1");
  assert.deepEqual(
    listPendingVoiceChannelMoves().map((r) => r.id),
    [row.id],
  );
  clearPendingVoiceChannelMoves();
});

test("replacePendingVoiceChannelMove: a second call replaces the first rather than adding a second row", () => {
  replacePendingVoiceChannelMove({ guildId: "guild-1", dueAt: "2026-01-01T00:10:00.000Z", requestedByUserId: "user-1" });
  const second = replacePendingVoiceChannelMove({ guildId: "guild-1", dueAt: "2026-01-01T00:20:00.000Z", requestedByUserId: "user-2" });

  const rows = listPendingVoiceChannelMoves();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, second.id);
  assert.equal(rows[0]!.dueAt, "2026-01-01T00:20:00.000Z");
  clearPendingVoiceChannelMoves();
});

test("listDuePendingVoiceChannelMoves: only returns rows whose due_at has passed", () => {
  replacePendingVoiceChannelMove({ guildId: "guild-1", dueAt: "2026-01-01T00:10:00.000Z", requestedByUserId: "user-1" });
  assert.equal(listDuePendingVoiceChannelMoves("2026-01-01T00:05:00.000Z").length, 0);
  assert.equal(listDuePendingVoiceChannelMoves("2026-01-01T00:10:00.000Z").length, 1);
  assert.equal(listDuePendingVoiceChannelMoves("2026-01-01T00:15:00.000Z").length, 1);
  clearPendingVoiceChannelMoves();
});

test("deletePendingVoiceChannelMove: removes the row; deleting an absent id is a no-op", () => {
  const row = replacePendingVoiceChannelMove({ guildId: "guild-1", dueAt: "2026-01-01T00:10:00.000Z", requestedByUserId: "user-1" });
  deletePendingVoiceChannelMove(row.id);
  assert.equal(listPendingVoiceChannelMoves().length, 0);
  assert.doesNotThrow(() => deletePendingVoiceChannelMove(row.id));
});
