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
}
