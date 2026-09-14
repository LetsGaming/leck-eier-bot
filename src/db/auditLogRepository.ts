import { db } from "./index.js";
import type { WebRole } from "../types.js";

export interface AuditLogEntry {
  id: number;
  at: string;
  userId: string;
  username: string;
  role: WebRole;
  method: string;
  path: string;
  statusCode: number;
}

interface AuditLogRow {
  id: number;
  at: string;
  user_id: string;
  username: string;
  role: WebRole;
  method: string;
  path: string;
  status_code: number;
}

function rowToEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    at: row.at,
    userId: row.user_id,
    username: row.username,
    role: row.role,
    method: row.method,
    path: row.path,
    statusCode: row.status_code,
  };
}

const insertStmt = db.prepare<{
  at: string;
  userId: string;
  username: string;
  role: WebRole;
  method: string;
  path: string;
  statusCode: number;
}>(
  `INSERT INTO dashboard_audit_log (at, user_id, username, role, method, path, status_code)
   VALUES (@at, @userId, @username, @role, @method, @path, @statusCode)`,
);
const selectPageStmt = db.prepare<{ limit: number; offset: number }, AuditLogRow>(
  `SELECT id, at, user_id, username, role, method, path, status_code
   FROM dashboard_audit_log
   ORDER BY at DESC, id DESC
   LIMIT @limit OFFSET @offset`,
);
const countStmt = db.prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM dashboard_audit_log");

export function insertAuditEntry(entry: {
  at: string;
  userId: string;
  username: string;
  role: WebRole;
  method: string;
  path: string;
  statusCode: number;
}): void {
  insertStmt.run(entry);
}

export function listAuditLog(opts: { limit: number; offset?: number }): { entries: AuditLogEntry[]; total: number } {
  const entries = selectPageStmt.all({ limit: opts.limit, offset: opts.offset ?? 0 }).map(rowToEntry);
  const total = countStmt.get()!.total;
  return { entries, total };
}
