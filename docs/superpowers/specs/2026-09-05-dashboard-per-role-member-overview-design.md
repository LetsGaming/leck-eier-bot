# Role-aware dashboard overview + cross-linked member overview

## Context

`Overview.tsx` (the dashboard's `/` page) shows the same content to every logged-in role. Its `Status` payload (`src/web/routes/status.ts`, `web/src/types.ts`) mixes bot-health fields (`botTag`, `uptimeMs`, `cachedMemberCount`, `reactionRolePanelCount`) — meaningful only to the bot owner — with genuinely useful attention items (`pendingRegistrationCount`, `unmatchedSignupCount`). `Layout.tsx` shows the identical sidenav/pages to all three `WebRole`s (`bot-owner` | `guild-owner` | `admin`, resolved in `src/web/auth.ts`'s `resolveDashboardRole()`); RBAC today only gates *login*, never *content*.

Separately, member-keyed data lives in silos with no cross-linking, despite all sharing the same Discord `userId`:
- `src/db/memberRecordsRepository.ts` — one `MemberRecord` per member already unifies audit data (`joinedAt`, `rulesAcceptedAt`, `leftAt`, `inGuild`) *and* registration-form data (`register_status`, `register_submitted_*`) in one table/row. Exposed via `getMemberRecord(userId)`.
- `src/db/birthdaysRepository.ts` — birthday entries keyed by `userId`, but no `getBirthdayForUser(userId)` lookup exists (only `getBirthdaysForDate`/`getAllBirthdaysByDate`/`deleteByUserStmt`).
- `src/db/eventAttendanceRepository.ts` — `ApolloEventSignup` rows keyed by `userId` per event (`listSignups(eventId)`, `listVoiceLogForUser(eventId, userId)`), but no function lists a given user's signups *across* events.

`web/src/pages/MemberAudit.tsx` already lists every member ever seen (in-guild + left) with a working cross-field search ("Die Suche durchsucht alle drei...") but its rows link nowhere — clicking a member does nothing beyond the existing approve/remove-registration actions.

## Scope

In scope:
- Role-conditional `Status`/`Overview.tsx`: bot-owner-only fields hidden from guild-owner/admin; a new community-snapshot block shown to everyone.
- One aggregating backend endpoint + `MemberOverview.tsx` page presenting one member's audit, registration, birthday, and event-attendance history together.
- Two new repository functions (`getBirthdayForUser`, a cross-event per-user signup lookup) needed to support the aggregation — no schema changes.
- Cross-linking: `MemberAudit.tsx` rows, birthday entries, and event signup rows link to the member overview.
- Expanding `MemberAudit.tsx` to double as the lookup entry point (its existing search stays); no new top-level nav item, no new search page.

Out of scope (explicitly deferred):
- Splitting `MemberAudit.tsx` into a separate "Members" nav item / page. If the expanded page becomes crowded once member-overview links are added, that split is a natural follow-up — not built now.
- Per-viewer configurable/widget-based dashboards. Content varies only by `WebRole`, not by individual preference.
- Any distinction between `guild-owner` and `admin` dashboard content — both get the same community-snapshot view; only `bot-owner` differs.

## Role-aware `Status` / `Overview.tsx`

`src/web/routes/status.ts`'s handler gains a `session.role` check. `Status` (`web/src/types.ts`) splits:

```ts
export interface CommunitySnapshot {
  memberCount: number | null;
  birthdaysThisWeek: { userId: string; name: string | null; mention: string; date: string }[];
  upcomingEvents: { id: number; title: string; startsAt: string; signupCount: number }[];
  recentAuditActivity: { userId: string; displayName: string; event: "joined" | "left" | "rulesAccepted"; at: string }[];
}

export interface Status {
  pendingRegistrationCount: number;
  unmatchedSignupCount: number;
  communitySnapshot: CommunitySnapshot;
  /** Present only when the requesting session's role is 'bot-owner'. */
  botOwnerStats: {
    botTag: string | null;
    uptimeMs: number;
    cachedMemberCount: number;
    reactionRolePanelCount: number;
  } | null;
}
```

`communitySnapshot` is computed unconditionally (cheap: existing repository calls plus the two new lookups below, no per-role branching in the queries themselves); `botOwnerStats` is `null` unless `session.role === "bot-owner"`.

`birthdaysThisWeek`: new `listBirthdaysInNextDays(days: number)` in `birthdaysRepository.ts` (a date-range variant of the existing `getBirthdaysForDate`). `recentAuditActivity`: a bounded (e.g. last 10, last 7 days) query over `memberRecordsRepository`'s existing `joined_at`/`left_at`/`rules_accepted_at` columns, ordered by whichever timestamp is most recent per row — new function `listRecentMemberActivity(limit: number)`. `upcomingEvents`: existing `listEventsInRange` + `summarizeSignupsForEvents`, just called from `status.ts` instead of only from `eventAttendance.ts`.

`web/src/pages/Overview.tsx`: the attention card stays unconditional. Below it, a `CommunitySnapshotSection` renders for everyone; a `BotOwnerStatsSection` (today's stat-tile grid, unchanged) renders only when `status.botOwnerStats` is non-null. The `me: Me` prop already flows into `Overview` via routing (see `Layout`'s existing `me` prop) — role branching here is purely "is this field present," no separate role prop needed.

## Member overview aggregation + page

New repository functions:
- `birthdaysRepository.ts`: `getBirthdayForUser(userId: string): BirthdayEntry | null`.
- `eventAttendanceRepository.ts`: `listSignupsForUser(userId: string): (ApolloEventSignup & { eventId: number; eventTitle: string; eventStartsAt: string })[]` — a join across `apollo_event_signups` and `apollo_events` filtered by `user_id`, ordered by event start descending.

New route `src/web/routes/memberAudit.ts` (extending the existing file, since it already owns member-identity concerns like `buildAvatarUrl`) gains `GET /api/members/:userId`:

```ts
export interface MemberOverview {
  userId: string;
  username: string;
  displayName: string;
  nickname: string | null;
  avatarUrl: string;
  inGuild: boolean;
  joinedAt: string | null;
  leftAt: string | null;
  rulesAcceptedAt: string | null;
  registration: { status: RegistrationStatus; submittedAt: string | null } | null;
  birthday: { day: number; month: number } | null;
  eventHistory: { eventId: number; eventTitle: string; startsAt: string; choice: ApolloRsvpChoice; attendanceStatus: AttendanceStatus | null }[];
}
```

Built from `getMemberRecord(userId)` (covers identity/audit/registration in one call — no separate registration lookup needed, confirming the two are already unified in `MemberRecord`), `getBirthdayForUser(userId)`, and `listSignupsForUser(userId)`. Returns 404 if `getMemberRecord` finds nothing (a `userId` with zero footprint isn't a valid overview target).

New `web/src/pages/MemberOverview.tsx` at route `/members/:userId` (added to the app's router alongside existing routes), rendered in sections: profile header (avatar, display name, nickname, in-guild badge), audit timeline (joined/rules-accepted/left, using the existing `formatAbsolute`/`formatRelative` date helpers `MemberAuditEntry`'s doc comment references), registration status, birthday (with a link back to `/birthdays` for editing — this page is read-only, editing stays on the feature's own settings page), and event history (list of past events with RSVP choice + attendance status, each linking to that event's `EventAttendanceDetail.tsx`).

## Cross-linking

- `MemberAudit.tsx`: each row's display name (currently plain text) becomes `<Link to={`/members/${entry.userId}`}>`. The existing approve/remove-registration action buttons stay where they are — the link is additive, not a replacement for existing row actions.
- `web/src/pages/Birthdays.tsx`: each birthday entry's name/mention becomes a link when `entry.userId` is non-null (self-registered entries have one; manually-entered mention-only entries may not — link only when a `userId` exists).
- `web/src/components/SignupRow.tsx`: the signup's display name becomes a link when `signup.userId` is non-null (unmatched signups, `matchSource` indicating no linked member, have none).

`MemberAudit.tsx` itself is expanded, not replaced, per the decision to defer any new top-level nav item: its existing search remains the primary "look up a member" flow, and its rows now also serve as the discovery path into the new overview page.

## Testing

- Backend: unit tests for the two new repository functions (`getBirthdayForUser`, `listSignupsForUser`) and for `GET /api/members/:userId` (200 with full aggregation, 404 for an unknown `userId`, correct 404/behavior for a `userId` that exists in `memberRecordsRepository` but has no birthday/event history — those sections render empty, not error). Unit test for `status.ts`'s role branching: `botOwnerStats` present only for `bot-owner` sessions, `communitySnapshot` present for all three roles.
- Frontend: manual browser verification of `Overview.tsx` for each of the three roles (via the dev mock-Discord login path already used for QA per recent work), `MemberOverview.tsx` rendering for a member with full history and for a sparse member (no birthday, no events), and that links from `MemberAudit.tsx`/`Birthdays.tsx`/`SignupRow.tsx` correctly navigate and omit the link when `userId` is null.
