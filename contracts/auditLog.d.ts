import type { WebRole } from "./webRole.js";

/** One row of `GET /api/audit-log` — see `src/db/auditLogRepository.ts`. Records who did what (method + path), not what changed. */
export interface AuditLogEntry {
  id: number;
  /** ISO UTC timestamp of the request. */
  at: string;
  userId: string;
  username: string;
  /** The session's live-resolved role at the time of the request. */
  role: WebRole;
  method: string;
  /** The route's registered pattern (e.g. `/api/birthdays/:id`), not the raw request URL. */
  path: string;
  statusCode: number;
}

export interface AuditLogResponse {
  entries: AuditLogEntry[];
  total: number;
}
