import { db } from "./index.js";
import type { WebRole } from "../types.js";

/**
 * A per-user dashboard access decision that overrides whatever the
 * Discord-role-derived hierarchy (`resolveDashboardRole()` in `web/auth.ts`)
 * would otherwise compute for this specific person — 'grant' hands them a
 * tier regardless of their guild roles (e.g. a trusted helper with no
 * qualifying role), 'block' denies them the dashboard entirely regardless of
 * their guild roles (incident response: cut a specific person off without
 * touching Discord). Checked after the bot-owner check (never overridable)
 * but before the guild-owner/admin/moderator role-derived checks — see
 * `resolveDashboardRole()`.
 */
export interface UserAccessOverride {
  userId: string;
  mode: "grant" | "block";
  /** Set for 'grant', null for 'block'. */
  role: WebRole | null;
  /** Optional context for a 'block' — why this person was cut off. */
  note: string | null;
  setByUserId: string;
  setByUsername: string;
  setAt: string;
}

interface OverrideRow {
  user_id: string;
  mode: "grant" | "block";
  role: WebRole | null;
  note: string | null;
  set_by_user_id: string;
  set_by_username: string;
  set_at: string;
}

function rowToOverride(row: OverrideRow): UserAccessOverride {
  return {
    userId: row.user_id,
    mode: row.mode,
    role: row.role,
    note: row.note,
    setByUserId: row.set_by_user_id,
    setByUsername: row.set_by_username,
    setAt: row.set_at,
  };
}

const COLUMNS = "user_id, mode, role, note, set_by_user_id, set_by_username, set_at";

const selectStmt = db.prepare<[string], OverrideRow>(`SELECT ${COLUMNS} FROM dashboard_user_overrides WHERE user_id = ?`);
const selectAllStmt = db.prepare<[], OverrideRow>(`SELECT ${COLUMNS} FROM dashboard_user_overrides`);
const upsertStmt = db.prepare<{
  userId: string;
  mode: string;
  role: string | null;
  note: string | null;
  setByUserId: string;
  setByUsername: string;
  setAt: string;
}>(
  `INSERT INTO dashboard_user_overrides (user_id, mode, role, note, set_by_user_id, set_by_username, set_at)
   VALUES (@userId, @mode, @role, @note, @setByUserId, @setByUsername, @setAt)
   ON CONFLICT(user_id) DO UPDATE SET
     mode = @mode, role = @role, note = @note,
     set_by_user_id = @setByUserId, set_by_username = @setByUsername, set_at = @setAt`,
);
const deleteStmt = db.prepare<[string]>("DELETE FROM dashboard_user_overrides WHERE user_id = ?");

export function getUserAccessOverride(userId: string): UserAccessOverride | null {
  const row = selectStmt.get(userId);
  return row ? rowToOverride(row) : null;
}

export function listUserAccessOverrides(): UserAccessOverride[] {
  return selectAllStmt.all().map(rowToOverride);
}

export function setUserAccessOverride(userId: string, override: Omit<UserAccessOverride, "userId">): void {
  upsertStmt.run({
    userId,
    mode: override.mode,
    role: override.role,
    note: override.note,
    setByUserId: override.setByUserId,
    setByUsername: override.setByUsername,
    setAt: override.setAt,
  });
}

export function clearUserAccessOverride(userId: string): void {
  deleteStmt.run(userId);
}
