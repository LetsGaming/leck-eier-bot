import { db } from "./index.js";

/**
 * At most one row ever exists — `/voice-channel move <time_m>` schedules a
 * one-shot automatic move-back, and since only one set of temporary voice
 * channels can exist at a time (see `temporaryVoiceChannelsRepository.ts`),
 * there is never more than one pending schedule either. A new schedule
 * replaces any existing one rather than queuing alongside it.
 */
export interface PendingVoiceChannelMove {
  id: number;
  guildId: string;
  /** ISO UTC — when the move-back should run. */
  dueAt: string;
  requestedByUserId: string;
  createdAt: string;
}

interface PendingVoiceChannelMoveRow {
  id: number;
  guild_id: string;
  due_at: string;
  requested_by_user_id: string;
  created_at: string;
}

function rowToPendingVoiceChannelMove(row: PendingVoiceChannelMoveRow): PendingVoiceChannelMove {
  return {
    id: row.id,
    guildId: row.guild_id,
    dueAt: row.due_at,
    requestedByUserId: row.requested_by_user_id,
    createdAt: row.created_at,
  };
}

const COLUMNS = "id, guild_id, due_at, requested_by_user_id, created_at";

const selectAllStmt = db.prepare<[], PendingVoiceChannelMoveRow>(
  `SELECT ${COLUMNS} FROM pending_voice_channel_moves ORDER BY due_at ASC`,
);
const selectDueStmt = db.prepare<[string], PendingVoiceChannelMoveRow>(
  `SELECT ${COLUMNS} FROM pending_voice_channel_moves WHERE due_at <= ? ORDER BY due_at ASC`,
);
const deleteAllStmt = db.prepare(`DELETE FROM pending_voice_channel_moves`);
const insertStmt = db.prepare<{ guildId: string; dueAt: string; requestedByUserId: string; createdAt: string }>(
  `INSERT INTO pending_voice_channel_moves (guild_id, due_at, requested_by_user_id, created_at)
   VALUES (@guildId, @dueAt, @requestedByUserId, @createdAt)`,
);
const deleteStmt = db.prepare<[number]>(`DELETE FROM pending_voice_channel_moves WHERE id = ?`);

export function listPendingVoiceChannelMoves(): PendingVoiceChannelMove[] {
  return selectAllStmt.all().map(rowToPendingVoiceChannelMove);
}

export function listDuePendingVoiceChannelMoves(nowIso: string): PendingVoiceChannelMove[] {
  return selectDueStmt.all(nowIso).map(rowToPendingVoiceChannelMove);
}

export interface ReplacePendingVoiceChannelMoveInput {
  guildId: string;
  dueAt: string;
  requestedByUserId: string;
}

/** Drops any existing pending schedule and inserts this one in its place — see the "at most one row" note above. */
export function replacePendingVoiceChannelMove(input: ReplacePendingVoiceChannelMoveInput): PendingVoiceChannelMove {
  deleteAllStmt.run();
  const now = new Date().toISOString();
  const info = insertStmt.run({ guildId: input.guildId, dueAt: input.dueAt, requestedByUserId: input.requestedByUserId, createdAt: now });
  return rowToPendingVoiceChannelMove(
    db.prepare<[number], PendingVoiceChannelMoveRow>(`SELECT ${COLUMNS} FROM pending_voice_channel_moves WHERE id = ?`).get(Number(info.lastInsertRowid))!,
  );
}

/** Idempotent — deleting an id that's already gone (or never existed) is a silent no-op. */
export function deletePendingVoiceChannelMove(id: number): void {
  deleteStmt.run(id);
}

export function clearPendingVoiceChannelMoves(): void {
  deleteAllStmt.run();
}
