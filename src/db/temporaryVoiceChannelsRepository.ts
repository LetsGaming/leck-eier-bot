import { db } from "./index.js";

/** One row per bot-created temporary group voice channel — the sole record that a given Discord channel is bot-owned. See migration v41 for why `eventId` carries no foreign key. */
export interface TemporaryVoiceChannel {
  channelId: string;
  guildId: string;
  /** The event this set is bound to, or `null` for an unbound set (cleared only by `/voice-channel clear`). */
  eventId: number | null;
  createdAt: string;
  createdByUserId: string;
}

interface TemporaryVoiceChannelRow {
  channel_id: string;
  guild_id: string;
  event_id: number | null;
  created_at: string;
  created_by_user_id: string;
}

function rowToTemporaryVoiceChannel(row: TemporaryVoiceChannelRow): TemporaryVoiceChannel {
  return {
    channelId: row.channel_id,
    guildId: row.guild_id,
    eventId: row.event_id,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
  };
}

const TEMP_VOICE_COLUMNS = "channel_id, guild_id, event_id, created_at, created_by_user_id";

// `INSERT OR IGNORE` — a duplicate channel_id (should never happen in
// practice, since Discord ids are unique) is a silent no-op rather than a
// thrown constraint error, matching this table's "never throw during
// create/cleanup bookkeeping" convention.
const insertTemporaryVoiceChannelStmt = db.prepare<{
  channelId: string;
  guildId: string;
  eventId: number | null;
  createdAt: string;
  createdByUserId: string;
}>(
  `INSERT OR IGNORE INTO temporary_voice_channels (channel_id, guild_id, event_id, created_at, created_by_user_id)
   VALUES (@channelId, @guildId, @eventId, @createdAt, @createdByUserId)`,
);
const selectAllTemporaryVoiceChannelsStmt = db.prepare<[], TemporaryVoiceChannelRow>(
  `SELECT ${TEMP_VOICE_COLUMNS} FROM temporary_voice_channels ORDER BY created_at ASC, channel_id ASC`,
);
const countTemporaryVoiceChannelsStmt = db.prepare<[], { count: number }>(
  `SELECT COUNT(*) AS count FROM temporary_voice_channels`,
);
const selectTemporaryVoiceChannelIdStmt = db.prepare<[string], { channel_id: string }>(
  `SELECT channel_id FROM temporary_voice_channels WHERE channel_id = ?`,
);
const deleteTemporaryVoiceChannelStmt = db.prepare<[string]>(
  `DELETE FROM temporary_voice_channels WHERE channel_id = ?`,
);

export function insertTemporaryVoiceChannel(row: TemporaryVoiceChannel): void {
  insertTemporaryVoiceChannelStmt.run(row);
}

export function listTemporaryVoiceChannels(): TemporaryVoiceChannel[] {
  return selectAllTemporaryVoiceChannelsStmt.all().map(rowToTemporaryVoiceChannel);
}

export function listTemporaryVoiceChannelIds(): string[] {
  return selectAllTemporaryVoiceChannelsStmt.all().map((r) => r.channel_id);
}

export function countTemporaryVoiceChannels(): number {
  return countTemporaryVoiceChannelsStmt.get()!.count;
}

/** Whether `channelId` is a bot-managed temporary voice channel — used to keep it out of settings/event voice-channel pickers and out of attendance tracking. */
export function isTemporaryVoiceChannel(channelId: string): boolean {
  return selectTemporaryVoiceChannelIdStmt.get(channelId) !== undefined;
}

/** Idempotent — deleting an id that's already gone (or never existed) is a silent no-op, so both `/voice-channel clear` and the recovery sweep can call this unconditionally. */
export function deleteTemporaryVoiceChannel(channelId: string): void {
  deleteTemporaryVoiceChannelStmt.run(channelId);
}
