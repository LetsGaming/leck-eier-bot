/**
 * One user's row on the dashboard's Member Audit page — current or former
 * (`inGuild` tells them apart). Every date is an ISO UTC string or `null`
 * ("not tracked", not "never happened" — see `MemberRecord` on the backend);
 * the frontend renders them with `formatAbsolute()`/`formatRelative()`
 * (`web/src/dateFormat.ts`), which convert to the viewer's local timezone.
 *
 * Response shape of `GET /api/members/audit` (as the `inGuild`/`left`
 * arrays) — see `src/web/routes/memberAudit.ts`.
 */
export interface MemberAuditEntry {
  userId: string;
  username: string;
  tag: string;
  displayName: string;
  nickname: string | null;
  avatarUrl: string;
  inGuild: boolean;
  joinedAt: string | null;
  rulesAcceptedAt: string | null;
  leftAt: string | null;
  /** From the live guild member cache for a current member; always `false` for a former member — bot accounts aren't meaningfully tracked as "left" by this system, so the distinction is moot for that half of the table. */
  isBot: boolean;
}
