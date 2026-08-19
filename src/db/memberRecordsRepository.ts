import { db } from "./index.js";
import type { MemberRecord } from "../types.js";

interface MemberRecordRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  joined_at: string | null;
  rules_accepted_at: string | null;
  left_at: string | null;
  in_guild: 0 | 1;
}

function rowToRecord(row: MemberRecordRow): MemberRecord {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    joinedAt: row.joined_at,
    rulesAcceptedAt: row.rules_accepted_at,
    leftAt: row.left_at,
    inGuild: row.in_guild === 1,
  };
}

const COLUMNS = "user_id, username, display_name, avatar, joined_at, rules_accepted_at, left_at, in_guild";

const selectAllStmt = db.prepare<[], MemberRecordRow>(`SELECT ${COLUMNS} FROM member_records`);
const selectByIdStmt = db.prepare<[string], MemberRecordRow>(`SELECT ${COLUMNS} FROM member_records WHERE user_id = ?`);

interface ProfileInput {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

// Rejoining after a previous leave clears left_at/in_guild but keeps
// rules_accepted_at — membership screening isn't re-done on a rejoin, so an
// existing acceptance timestamp is still accurate.
const upsertJoinStmt = db.prepare<ProfileInput & { joinedAt: string | null }>(
  `INSERT INTO member_records (user_id, username, display_name, avatar, joined_at, in_guild)
   VALUES (@userId, @username, @displayName, @avatar, @joinedAt, 1)
   ON CONFLICT(user_id) DO UPDATE SET
     username = @username, display_name = @displayName, avatar = @avatar,
     joined_at = @joinedAt, left_at = NULL, in_guild = 1`,
);

const updateProfileStmt = db.prepare<ProfileInput>(
  `UPDATE member_records SET username = @username, display_name = @displayName, avatar = @avatar WHERE user_id = @userId`,
);

const recordRulesAcceptedStmt = db.prepare<{ userId: string; timestamp: string }>(
  `UPDATE member_records SET rules_accepted_at = @timestamp WHERE user_id = @userId`,
);

// A leave can be the very first record we ever have for this user (bot
// wasn't around for their join, or member_records didn't exist yet) — the
// INSERT branch covers that; joined_at/rules_accepted_at simply stay null.
const recordLeaveStmt = db.prepare<ProfileInput & { timestamp: string }>(
  `INSERT INTO member_records (user_id, username, display_name, avatar, left_at, in_guild)
   VALUES (@userId, @username, @displayName, @avatar, @timestamp, 0)
   ON CONFLICT(user_id) DO UPDATE SET
     username = @username, display_name = @displayName, avatar = @avatar,
     left_at = @timestamp, in_guild = 0`,
);

export function listAllMemberRecords(): MemberRecord[] {
  return selectAllStmt.all().map(rowToRecord);
}

export function getMemberRecord(userId: string): MemberRecord | null {
  const row = selectByIdStmt.get(userId);
  return row ? rowToRecord(row) : null;
}

export function upsertJoin(entry: ProfileInput & { joinedAt: string | null }): void {
  upsertJoinStmt.run(entry);
}

export function updateProfile(entry: ProfileInput): void {
  updateProfileStmt.run(entry);
}

export function recordRulesAccepted(userId: string, timestamp: string): void {
  recordRulesAcceptedStmt.run({ userId, timestamp });
}

export function recordLeave(entry: ProfileInput & { timestamp: string }): void {
  recordLeaveStmt.run(entry);
}
