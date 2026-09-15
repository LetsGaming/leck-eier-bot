import { db } from "./index.js";
import type { WebRole } from "../types.js";

/**
 * A time-boxed elevation of one specific Discord user to a higher `WebRole`
 * tier — a "break-glass" grant (onboarding, a one-off fix) that expires on
 * its own instead of becoming a standing privilege someone has to remember
 * to revoke. Applied as a pure elevation on top of the role-derived/override
 * result (never a restriction) — see `applyTemporaryGrant()` in
 * `web/accessControl.ts`. Expiry is checked live on every read here (an
 * `expires_at` filter), never eagerly deleted, so there is no cron/sweep
 * this depends on for correctness.
 */
export interface TemporaryGrant {
  id: number;
  userId: string;
  role: WebRole;
  expiresAt: string;
  grantedByUserId: string;
  grantedByUsername: string;
  grantedAt: string;
  revokedAt: string | null;
}

interface GrantRow {
  id: number;
  user_id: string;
  role: WebRole;
  expires_at: string;
  granted_by_user_id: string;
  granted_by_username: string;
  granted_at: string;
  revoked_at: string | null;
}

function rowToGrant(row: GrantRow): TemporaryGrant {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    expiresAt: row.expires_at,
    grantedByUserId: row.granted_by_user_id,
    grantedByUsername: row.granted_by_username,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
  };
}

const COLUMNS = "id, user_id, role, expires_at, granted_by_user_id, granted_by_username, granted_at, revoked_at";

const selectActiveStmt = db.prepare<{ now: string }, GrantRow>(
  `SELECT ${COLUMNS} FROM dashboard_temporary_grants WHERE revoked_at IS NULL AND expires_at > @now ORDER BY expires_at ASC`,
);
const selectActiveForUserStmt = db.prepare<{ userId: string; now: string }, GrantRow>(
  `SELECT ${COLUMNS} FROM dashboard_temporary_grants WHERE user_id = @userId AND revoked_at IS NULL AND expires_at > @now`,
);
const insertStmt = db.prepare<{
  userId: string;
  role: string;
  expiresAt: string;
  grantedByUserId: string;
  grantedByUsername: string;
  grantedAt: string;
}>(
  `INSERT INTO dashboard_temporary_grants (user_id, role, expires_at, granted_by_user_id, granted_by_username, granted_at)
   VALUES (@userId, @role, @expiresAt, @grantedByUserId, @grantedByUsername, @grantedAt)`,
);
const revokeStmt = db.prepare<{ id: number; revokedAt: string }>(
  "UPDATE dashboard_temporary_grants SET revoked_at = @revokedAt WHERE id = @id",
);

export function listActiveTemporaryGrants(): TemporaryGrant[] {
  return selectActiveStmt.all({ now: new Date().toISOString() }).map(rowToGrant);
}

export function getActiveTemporaryGrantForUser(userId: string): TemporaryGrant | null {
  const row = selectActiveForUserStmt.get({ userId, now: new Date().toISOString() });
  return row ? rowToGrant(row) : null;
}

/** Revokes any existing active grant for this user first — only one is ever logically active at a time. */
export function createTemporaryGrant(input: Omit<TemporaryGrant, "id" | "revokedAt">): TemporaryGrant {
  const existing = getActiveTemporaryGrantForUser(input.userId);
  if (existing) revokeTemporaryGrant(existing.id);

  const info = insertStmt.run(input);
  return { id: Number(info.lastInsertRowid), ...input, revokedAt: null };
}

export function revokeTemporaryGrant(id: number): void {
  revokeStmt.run({ id, revokedAt: new Date().toISOString() });
}
