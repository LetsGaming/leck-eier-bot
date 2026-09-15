import { randomBytes, createHash } from "crypto";
import { db } from "./index.js";

/**
 * A bearer credential for non-interactive/machine access (a status widget,
 * an external monitoring dashboard) — deliberately narrow: it grants read
 * access to exactly `GET /api/public/status`'s community snapshot, nothing
 * else (see `registerPublicApiRoutes()` in `web/server.ts`). Only the SHA-256
 * hash is ever persisted; the raw value is returned to the caller once, at
 * creation, and never retrievable again — same posture this codebase already
 * documents for dashboard session tokens.
 */
export interface ApiToken {
  id: number;
  label: string;
  createdByUserId: string;
  createdByUsername: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ApiTokenRow {
  id: number;
  label: string;
  token_hash: string;
  created_by_user_id: string;
  created_by_username: string;
  created_at: string;
  last_used_at: string | null;
}

function rowToToken(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    label: row.label,
    createdByUserId: row.created_by_user_id,
    createdByUsername: row.created_by_username,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

const COLUMNS = "id, label, token_hash, created_by_user_id, created_by_username, created_at, last_used_at";

const insertStmt = db.prepare<{
  label: string;
  tokenHash: string;
  createdByUserId: string;
  createdByUsername: string;
  createdAt: string;
}>(
  `INSERT INTO dashboard_api_tokens (label, token_hash, created_by_user_id, created_by_username, created_at)
   VALUES (@label, @tokenHash, @createdByUserId, @createdByUsername, @createdAt)`,
);
const selectAllStmt = db.prepare<[], ApiTokenRow>(`SELECT ${COLUMNS} FROM dashboard_api_tokens ORDER BY created_at DESC`);
const selectByHashStmt = db.prepare<[string], ApiTokenRow>(`SELECT ${COLUMNS} FROM dashboard_api_tokens WHERE token_hash = ?`);
const touchLastUsedStmt = db.prepare<{ id: number; lastUsedAt: string }>(
  "UPDATE dashboard_api_tokens SET last_used_at = @lastUsedAt WHERE id = @id",
);
const deleteStmt = db.prepare<[number]>("DELETE FROM dashboard_api_tokens WHERE id = ?");

/** Returns the created token's metadata plus the raw value — the one and only time it's ever available. */
export function createApiToken(label: string, createdBy: { userId: string; username: string }): ApiToken & { rawToken: string } {
  const rawToken = randomBytes(32).toString("hex");
  const createdAt = new Date().toISOString();
  const info = insertStmt.run({ label, tokenHash: hashToken(rawToken), createdByUserId: createdBy.userId, createdByUsername: createdBy.username, createdAt });
  return {
    id: Number(info.lastInsertRowid),
    label,
    createdByUserId: createdBy.userId,
    createdByUsername: createdBy.username,
    createdAt,
    lastUsedAt: null,
    rawToken,
  };
}

export function listApiTokens(): ApiToken[] {
  return selectAllStmt.all().map(rowToToken);
}

/** Hashes `rawToken` and checks it against stored tokens; records a hit's `last_used_at`. Never distinguishes "no such token" from "malformed input" — both just return false. */
export function verifyApiToken(rawToken: string): boolean {
  const row = selectByHashStmt.get(hashToken(rawToken));
  if (!row) return false;
  touchLastUsedStmt.run({ id: row.id, lastUsedAt: new Date().toISOString() });
  return true;
}

export function revokeApiToken(id: number): void {
  deleteStmt.run(id);
}
