import { db } from "./index.js";
import type { WebSession } from "../types.js";

interface SessionRow {
  id: string;
  user_id: string;
  username: string;
  avatar: string | null;
  is_owner: 0 | 1;
  expires_at: number;
}

function rowToSession(row: SessionRow): WebSession {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    avatar: row.avatar,
    isOwner: row.is_owner === 1,
    expiresAt: row.expires_at,
  };
}

const insertStmt = db.prepare<{
  id: string;
  userId: string;
  username: string;
  avatar: string | null;
  isOwner: 0 | 1;
  expiresAt: number;
}>(
  `INSERT INTO web_sessions (id, user_id, username, avatar, is_owner, expires_at)
   VALUES (@id, @userId, @username, @avatar, @isOwner, @expiresAt)`,
);
const selectStmt = db.prepare<[string], SessionRow>("SELECT * FROM web_sessions WHERE id = ?");
const deleteStmt = db.prepare<[string]>("DELETE FROM web_sessions WHERE id = ?");
const deleteExpiredStmt = db.prepare<[number]>("DELETE FROM web_sessions WHERE expires_at < ?");

export function createSession(session: WebSession): void {
  insertStmt.run({
    id: session.id,
    userId: session.userId,
    username: session.username,
    avatar: session.avatar,
    isOwner: session.isOwner ? 1 : 0,
    expiresAt: session.expiresAt,
  });
}

/** Returns null for a missing *or* expired session — callers don't need to separately check `expiresAt`. */
export function getSession(id: string): WebSession | null {
  const row = selectStmt.get(id);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteStmt.run(id);
    return null;
  }
  return rowToSession(row);
}

export function deleteSession(id: string): void {
  deleteStmt.run(id);
}

/** Run once at startup to clear out sessions that expired while the bot was offline. */
export function sweepExpiredSessions(): number {
  return deleteExpiredStmt.run(Date.now()).changes;
}
