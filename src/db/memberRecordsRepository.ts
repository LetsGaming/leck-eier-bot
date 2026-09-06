import { db } from "./index.js";
import type { MemberRecord, RegistrationStatus } from "../types.js";

interface MemberRecordRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  joined_at: string | null;
  rules_accepted_at: string | null;
  left_at: string | null;
  in_guild: 0 | 1;
  register_thread_id: string | null;
  register_submitted_at: string | null;
  register_submitted_name: string | null;
  register_submitted_sso_name: string | null;
  register_submitted_age: string | null;
  register_status: RegistrationStatus | null;
  register_thread_expires_at: string | null;
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
    registerThreadId: row.register_thread_id,
    registerSubmittedAt: row.register_submitted_at,
    registerSubmittedName: row.register_submitted_name,
    registerSubmittedSsoName: row.register_submitted_sso_name,
    registerSubmittedAge: row.register_submitted_age,
    registerStatus: row.register_status,
    registerThreadExpiresAt: row.register_thread_expires_at,
  };
}

const COLUMNS =
  "user_id, username, display_name, avatar, joined_at, rules_accepted_at, left_at, in_guild, register_thread_id, register_submitted_at, register_submitted_name, register_submitted_sso_name, register_submitted_age, register_status, register_thread_expires_at";

const selectByIdStmt = db.prepare<[string], MemberRecordRow>(`SELECT ${COLUMNS} FROM member_records WHERE user_id = ?`);
const countPendingRegistrationsStmt = db.prepare<[], { total: number }>(
  `SELECT COUNT(*) AS total FROM member_records WHERE register_status = 'pending'`,
);

/**
 * Options shared by `listFormerMembers()`/`listRegistrations()`'s SQL-side
 * search+pagination. `query` is matched via a case-insensitive `LIKE
 * '%query%'` against a fixed set of columns (see each function) — this is a
 * deliberate approximation of the old in-JS `matchesSearch()`/`scoreMatch()`
 * (services/memberSearch.ts), which additionally transliterates fancy
 * Unicode lookalike characters (e.g. mathematical bold/italic letters) and
 * strips diacritics before comparing. SQLite's `LIKE`/`LOWER` only
 * understand ASCII case-folding, so a search like "lu" will NOT match a
 * stylized name such as "𝓛𝓾𝓷𝓪" the way the old JS path did. That gap is an
 * accepted tradeoff: closing the unbounded full-table-scan-plus-per-row-
 * transliteration problem (which blocks the shared Node event loop, and
 * therefore the Discord gateway heartbeat, for as long as the query takes)
 * is far higher priority than preserving fancy-Unicode fuzzy matching for an
 * admin's ad-hoc search. Plain-ASCII substring/prefix/exact search — by far
 * the common case — behaves identically to before.
 *
 * Ordering approximates the old tiered `scoreMatch()` (exact > prefix >
 * word-boundary > substring) with a 3-tier SQL `CASE` (exact > prefix >
 * substring) — the "match at the start of a word" tier is folded into the
 * plain substring tier here, since expressing word-boundary matching in SQL
 * would need per-row string splitting with no indexable benefit anyway. The
 * `limit`/`offset` pair lets a caller page through results without gaps or
 * duplicates as long as the underlying table isn't concurrently mutated
 * between pages, same as any offset-based SQL pagination.
 */
export interface MemberSearchOptions {
  /** Trimmed, non-normalized search text. Empty/omitted matches everything. */
  query?: string;
  limit: number;
  offset?: number;
}

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

// Only sets it the first time — a no-op if this user already has a
// timestamp, so a later strip-then-regrant of the rules-gate role (e.g.
// re-registering) doesn't overwrite the original acceptance time.
const recordRulesAcceptedStmt = db.prepare<{ userId: string; timestamp: string }>(
  `UPDATE member_records SET rules_accepted_at = @timestamp WHERE user_id = @userId AND rules_accepted_at IS NULL`,
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

export function getMemberRecord(userId: string): MemberRecord | null {
  const row = selectByIdStmt.get(userId);
  return row ? rowToRecord(row) : null;
}

/**
 * Batched lookup by primary key for a bounded set of ids — e.g. the
 * dashboard's Member Audit page enriching the *currently in-guild* members
 * (bounded by guild size, from the live member cache) with their
 * `joined_at`/`rules_accepted_at` history, without pulling in the unbounded
 * "every member ever seen" table. Returns nothing for ids with no record.
 */
export function getMemberRecordsByIds(userIds: string[]): Map<string, MemberRecord> {
  if (userIds.length === 0) return new Map();
  const placeholders = userIds.map(() => "?").join(", ");
  const rows = db
    .prepare<string[], MemberRecordRow>(`SELECT ${COLUMNS} FROM member_records WHERE user_id IN (${placeholders})`)
    .all(...userIds);
  return new Map(rows.map((row) => [row.user_id, rowToRecord(row)]));
}

/** Escapes `%`/`_`/`\` so they're matched literally rather than as `LIKE` wildcards, then wraps the query for a substring/prefix search. */
function likeParams(query: string) {
  const escaped = query.toLowerCase().replace(/[\\%_]/g, "\\$&");
  return { exact: query.toLowerCase(), like: `%${escaped}%`, prefix: `${escaped}%` };
}

interface SearchStmtParams {
  exact: string;
  like: string;
  prefix: string;
  limit: number;
  offset: number;
}

const selectFormerMembersStmt = db.prepare<SearchStmtParams, MemberRecordRow>(`
  SELECT ${COLUMNS} FROM member_records
  WHERE in_guild = 0
    AND (@exact = '' OR LOWER(username) LIKE @like ESCAPE '\\' OR LOWER(display_name) LIKE @like ESCAPE '\\')
  ORDER BY
    CASE
      WHEN @exact = '' THEN 0
      WHEN LOWER(username) = @exact OR LOWER(display_name) = @exact THEN 0
      WHEN LOWER(username) LIKE @prefix ESCAPE '\\' OR LOWER(display_name) LIKE @prefix ESCAPE '\\' THEN 1
      ELSE 2
    END,
    left_at DESC
  LIMIT @limit OFFSET @offset
`);

const selectRegistrationsStmt = db.prepare<SearchStmtParams, MemberRecordRow>(`
  SELECT ${COLUMNS} FROM member_records
  WHERE register_status IS NOT NULL
    AND (
      @exact = ''
      OR LOWER(username) LIKE @like ESCAPE '\\'
      OR LOWER(display_name) LIKE @like ESCAPE '\\'
      OR LOWER(register_submitted_name) LIKE @like ESCAPE '\\'
      OR LOWER(register_submitted_sso_name) LIKE @like ESCAPE '\\'
    )
  ORDER BY
    CASE
      WHEN @exact = '' THEN 0
      WHEN LOWER(username) = @exact OR LOWER(display_name) = @exact
        OR LOWER(register_submitted_name) = @exact OR LOWER(register_submitted_sso_name) = @exact THEN 0
      WHEN LOWER(username) LIKE @prefix ESCAPE '\\' OR LOWER(display_name) LIKE @prefix ESCAPE '\\'
        OR LOWER(register_submitted_name) LIKE @prefix ESCAPE '\\' OR LOWER(register_submitted_sso_name) LIKE @prefix ESCAPE '\\' THEN 1
      ELSE 2
    END,
    register_submitted_at DESC
  LIMIT @limit OFFSET @offset
`);

/**
 * Former members only (`in_guild = 0`), newest-left-first by default,
 * optionally filtered by `options.query` against username/display name — see
 * `MemberSearchOptions` for the search-approximation and ordering tradeoffs.
 * This is the unbounded half of the old `listAllMemberRecords()` scan: the
 * in-guild half is naturally bounded by current guild size and is served
 * from the live member cache instead (see `memberAudit.ts`).
 */
export function listFormerMembers(options: MemberSearchOptions): MemberRecord[] {
  const { exact, like, prefix } = likeParams(options.query?.trim() ?? "");
  return selectFormerMembersStmt
    .all({ exact, like, prefix, limit: options.limit, offset: options.offset ?? 0 })
    .map(rowToRecord);
}

/**
 * Every member who's ever submitted a registration form, regardless of
 * outcome — see `register_status` on `member_records`. Optionally filtered
 * by `options.query` against the resolved-identity columns
 * (username/display name) and the raw form-submitted name/SSO-name fields —
 * see `MemberSearchOptions` for the search-approximation tradeoffs. Unlike
 * the route's old in-JS search, this does NOT also match the member's
 * current *nickname* — nickname is a live Discord field, not persisted on
 * `member_records`, and matching it here (post-SQL, before pagination is
 * applied) would silently drop rows that only match by nickname off the
 * page instead of ranking them in. That's an accepted, documented gap: a
 * search for someone's current nickname alone (not their username/display
 * name/submitted form names) may not find them anymore.
 */
export function listRegistrations(options: MemberSearchOptions): MemberRecord[] {
  const { exact, like, prefix } = likeParams(options.query?.trim() ?? "");
  return selectRegistrationsStmt
    .all({ exact, like, prefix, limit: options.limit, offset: options.offset ?? 0 })
    .map(rowToRecord);
}

/** Registrations awaiting staff review — surfaced on Overview as an attention count. */
export function countPendingRegistrations(): number {
  return countPendingRegistrationsStmt.get()!.total;
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

interface PendingRegistrationInput {
  userId: string;
  threadId: string;
  submittedAt: string;
  /** Raw `name:`/`sso name:`/`alter:` field values — purely informational, shown on the dashboard's pending-registrations list. `age` is optional since `alter:` isn't required for a valid submission. */
  name: string;
  ssoName: string;
  age: string | null;
}

// Overwrites whatever was there before (including a prior terminal status),
// so a member who was previously 'removed'/'left' can simply submit again —
// this is the only place register_status is ever set back to 'pending'.
// register_thread_expires_at is reset defensively; it should already be NULL
// by this point (every path that sets it also clears register_thread_id, see
// setRegistrationStatusStmt below), but a fresh submission should never be
// blocked by a leftover expiry regardless.
const savePendingRegistrationStmt = db.prepare<PendingRegistrationInput>(
  `UPDATE member_records SET
     register_thread_id = @threadId,
     register_submitted_at = @submittedAt,
     register_submitted_name = @name,
     register_submitted_sso_name = @ssoName,
     register_submitted_age = @age,
     register_status = 'pending',
     register_thread_expires_at = NULL
   WHERE user_id = @userId`,
);

export function savePendingRegistration(entry: PendingRegistrationInput): void {
  savePendingRegistrationStmt.run(entry);
}

// register_thread_id goes back to NULL on every terminal transition — the
// Discord thread itself is always deleted at the same time (see
// registerWatcher.ts), so the id would just be dangling otherwise.
// register_submitted_name/sso_name/age/at are deliberately left untouched —
// this is what makes the entry stay visible with its submitted info intact
// instead of being wiped, per the dashboard's Registrierungen history.
//
// Every transition is guarded on the row currently being 'pending', so:
// - completing/removing/clearing a member who never submitted (status NULL)
//   is a no-op, not a phantom history entry.
// - a member who already completed registration and later leaves keeps
//   their 'registered' status — leaving doesn't overwrite it to 'left'.
const setRegistrationStatusStmt = db.prepare<{ userId: string; status: RegistrationStatus }>(
  `UPDATE member_records SET register_status = @status, register_thread_id = NULL, register_thread_expires_at = NULL
   WHERE user_id = @userId AND register_status = 'pending'`,
);

/** Staff granted the registration-tier role — see `stripRegisterGateRoleIfJustRegistered()` in `memberEvents.ts`. Deletes the thread immediately (unlike `completeRegistrationKeepThread`). */
export function completeRegistration(userId: string): void {
  setRegistrationStatusStmt.run({ userId, status: "registered" });
}

/** Manually reset from the dashboard's Registrierungen list, so the member can submit the form again. */
export function removeRegistration(userId: string): void {
  setRegistrationStatusStmt.run({ userId, status: "removed" });
}

/** The member left/was kicked/was banned while their registration was still pending — see `guildMemberRemove` in `memberEvents.ts`. */
export function markRegistrationLeft(userId: string): void {
  setRegistrationStatusStmt.run({ userId, status: "left" });
}

// Unlike setRegistrationStatusStmt, deliberately keeps register_thread_id —
// settings.registerAutoComplete (registerWatcher.ts) wants the thread to
// stay open a while longer instead of vanishing the instant the role is
// granted. sweepExpiredRegisterThreads() is what eventually deletes it and
// clears these two columns via clearExpiredRegisterThread() below.
const completeRegistrationKeepThreadStmt = db.prepare<{ userId: string; expiresAt: string }>(
  `UPDATE member_records SET register_status = 'registered', register_thread_expires_at = @expiresAt
   WHERE user_id = @userId AND register_status = 'pending'`,
);

/** Auto-completed registration (settings.registerAutoComplete) — same "registered" outcome as `completeRegistration()`, but the thread stays open until `expiresAt` instead of being deleted right away. */
export function completeRegistrationKeepThread(userId: string, expiresAt: string): void {
  completeRegistrationKeepThreadStmt.run({ userId, expiresAt });
}

const selectExpiredRegisterThreadsStmt = db.prepare<[string], { user_id: string; register_thread_id: string }>(
  `SELECT user_id, register_thread_id FROM member_records
   WHERE register_thread_id IS NOT NULL AND register_thread_expires_at IS NOT NULL AND register_thread_expires_at <= ?`,
);

const clearExpiredRegisterThreadStmt = db.prepare<{ userId: string }>(
  `UPDATE member_records SET register_thread_id = NULL, register_thread_expires_at = NULL WHERE user_id = @userId`,
);

/** Every auto-completed registration whose thread lifetime (see `completeRegistrationKeepThread`) has passed as of `nowIso`. */
export function listExpiredRegisterThreads(nowIso: string): Array<{ userId: string; threadId: string }> {
  return selectExpiredRegisterThreadsStmt.all(nowIso).map((r) => ({ userId: r.user_id, threadId: r.register_thread_id }));
}

/** Clears the thread reference for an entry `listExpiredRegisterThreads()` returned, once its Discord thread has actually been deleted. register_status ('registered') is untouched. */
export function clearExpiredRegisterThread(userId: string): void {
  clearExpiredRegisterThreadStmt.run({ userId });
}
