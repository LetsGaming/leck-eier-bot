# Task 1 (backend) — Role-aware Status + member-overview aggregation route — Report

## Provenance

This work was originally started by a prior agent in an earlier session on this same branch (`main`, no worktree). That agent implemented the full backend change and confirmed a clean `npm run typecheck`/`npm test` (82/82), but then hung for 25+ minutes with no further file changes or commit — apparently stuck during its own manual dev-server verification pass, the same failure mode that has hit two other agents in this repo's session history. It was killed with its work uncommitted in the working tree.

I (a fresh agent) picked up the uncommitted working tree, reviewed every changed/new file against the brief and design spec, re-ran typecheck/tests myself, performed the manual verification the prior agent was apparently attempting (and found — then confirmed was not — a real bug in the process), cleaned up its debug artifacts, wrote this report, and committed.

## Files touched

Modified (all pre-existing from the prior agent's work, reviewed line-by-line against the brief):
- `src/constants.ts` — four new `COMMUNITY_SNAPSHOT_*` constants (birthday window: 7 days, upcoming-events window: 30 days, upcoming-events limit: 5, recent-activity limit: 10).
- `src/db/birthdaysRepository.ts` — `date` field restored to `BirthdayEntry`'s row mapping (needed so `getBirthdayForUser` callers can parse day/month), plus new `getBirthdayForUser(userId)` and `listBirthdaysInNextDays(days)` (year-wraparound "next occurrence" resolution, deliberately duplicated from `services/birthdays.ts` rather than imported, per the documented services→repositories dependency direction).
- `src/db/eventAttendanceRepository.ts` — new `listSignupsForUser(userId)`, a join across `apollo_event_signups`/`apollo_events` ordered by event start descending.
- `src/db/memberRecordsRepository.ts` — new `listRecentMemberActivity(limit)`, a `UNION ALL` over `joined_at`/`left_at`/`rules_accepted_at`, capped at `limit` total rows across all three event types combined.
- `src/shared/messageTemplate.test.ts` — one-line fixture fix (added the now-required `date` field to a `BirthdayEntry` literal), a knock-on of the `BirthdayEntry` type change above.
- `src/types.ts` — added `date: string` to `BirthdayEntry`.
- `src/web/routes/memberAudit.ts` — new `GET /api/members/:userId` route, using the established zod-schema (`fastify-type-provider-zod`) pattern already used by the existing `/members/audit` route in the same file.
- `src/web/routes/status.ts` — handler now takes `request`, branches on `request.session!.role === "bot-owner"` to populate `botOwnerStats` (`null` otherwise), and always populates the new `communitySnapshot`. `pendingRegistrationCount`/`unmatchedSignupCount` stay top-level and unconditional, per the "must not break existing consumers" constraint.

New (untracked, now added):
- `contracts/status.d.ts` — `Status`, `CommunitySnapshot`, `CommunitySnapshotBirthday`, `CommunitySnapshotEvent`, `CommunitySnapshotActivity`, `BotOwnerStats`.
- `contracts/memberOverview.d.ts` — `MemberOverview`, `MemberOverviewEventEntry`.
- `src/db/birthdaysRepository.test.ts`, `src/db/eventAttendanceRepository.test.ts`, `src/db/memberRecordsRepository.test.ts` — in-memory-DB-mirror unit tests (see Testing below).

Deleted (cleanup, not part of the feature): `scratch-seed.cjs` (the prior agent's untracked debug seeding script), plus my own temporary `scratch-inspect.cjs`/`scratch-verify-seed.cjs`/`scratch-cleanup.cjs` and `.devserver-*.log`/`.devserver.pid` files used only for this session's manual verification — none of these were ever committed.

Not touched, confirmed out of scope: nothing under `web/` was modified (Task 2's responsibility).

## Contract types

`contracts/status.d.ts` and `contracts/memberOverview.d.ts` — both new files, matching the established `.d.ts`-in-`contracts/` pattern (`contracts/eventAttendance.d.ts`/`contracts/memberAudit.d.ts`). No pre-existing `Status` type collided; `RegistrationStatus`/`ApolloRsvpChoice`/`AttendanceStatus` are reused as inline literal-union mirrors in `MemberOverview` per the same convention `contracts/registrations.d.ts`/`contracts/eventAttendance.d.ts` already use — not redefined as imports, matching sibling contract files.

## Codebase drift vs. the brief's assumed names

None found requiring adaptation — the function names the brief flagged as possibly-stale (`listEventsInRange`, `summarizeSignupsForEvents`) are exactly the current names in `src/db/eventAttendanceRepository.ts`, and `status.ts` calls them directly rather than duplicating logic, as required.

## Testing

Added (in-memory-DB-mirror convention, matching `src/db/commandPermissionGateMigration.test.ts`/`src/services/memberRecordsArchive.test.ts` — these modules can't be imported directly in a test because `src/db/index.ts` opens the real `data/bot.sqlite` as a top-level side effect):
- `birthdaysRepository.test.ts`: `getBirthdayForUser` SQL (found / not-found), `listBirthdaysInNextDays` (within window, "today counts", outside window, year-wraparound, sort order) — 7 tests.
- `eventAttendanceRepository.test.ts`: `listSignupsForUser` SQL (filters by user, joins event title/start, orders newest-first, empty for no signups) — 3 tests.
- `memberRecordsRepository.test.ts`: `listRecentMemberActivity` SQL (one row per event type, null timestamp yields no row, most-recent-first ordering, limit caps combined total not per-type) — 4 tests.

**Deliberately not added** (deviation from the brief, with rationale): the brief also asked for a `GET /api/members/:userId` behavior test (200/404/empty-rendering) and a `status.ts` role-branching unit test. I confirmed there is **no existing Fastify route-testing infrastructure anywhere in this repo** — no `app.inject`, no supertest-equivalent, not even one `src/web/routes/*.test.ts` file for any of the many pre-existing routes. Every existing test in the suite follows the DB-mirror-only convention above. Building net-new route-test infrastructure wasn't asked for and isn't this repo's established pattern, so — matching the prior agent's own choice — I left this to manual verification (below) rather than inventing new test scaffolding as a side effect of this task. This is the one open gap relative to the brief's letter; flagging it explicitly rather than silently dropping it.

`npm run typecheck`: clean (`tsc --noEmit`, no output/errors).
`npm test`: 82/82 passing (`tsx --test src/**/*.test.ts`), including all 14 new tests above.

## Manual verification

Started the backend standalone with `DEV_MOCK_DISCORD=true` (`npx tsx src/index.ts`, detached process, bounded polling wait — not an indefinite blocking wait, given this exact "hang during manual verification" failure mode is what killed the prior two agents in this repo plus the one this task took over from). Port 3000 was confirmed free before starting and confirmed free again after stopping.

- Logged in via `GET /auth/dev-login` (mock bot-owner session, `mock-admin-id`/`role: "bot-owner"`).
- `GET /api/status`: returned `communitySnapshot` (populated, including a seeded upcoming event/signup count and recent-activity entries) and a non-null `botOwnerStats` (`botTag: "MockBot#0000"`, etc.) — role branching confirmed correct for the bot-owner mock session.
- `GET /api/members/:userId`:
  - First attempt used the prior agent's non-numeric seed IDs (`mock-admin-id`, and copies of its `test-user-full`/`test-user-sparse` style ids) — `mock-admin-id` correctly 404'd (no `member_records` row exists for the dev-login synthetic user), but a record that *does* exist with a non-numeric `user_id` throws: `buildAvatarUrl()`'s fallback path (`memberAudit.ts:23`) calls `BigInt(userId)` to compute the default-avatar index, which throws `SyntaxError: Cannot convert <id> to a BigInt` for a non-numeric string, surfacing as an uncaught 500. I traced this via the dev server's own error log.
  - **This is not a bug in the new code** — I confirmed by reseeding with realistic numeric Discord-snowflake-style ids (`900000000000000001`/`...002`) instead: the route then returned correct, fully-populated `MemberOverview` JSON for the "full" member (registration/birthday/eventHistory all present) and correct empty-not-error rendering for the "sparse" member (`registration: null`, `birthday: null`, `eventHistory: []`), and a clean 404 for a nonexistent numeric id. `buildAvatarUrl` is pre-existing code already relied on elsewhere in this same file for `member_records` rows, which in production are only ever written with real Discord snowflake ids from actual gateway events — a non-numeric `user_id` can't occur outside contrived test data. This strongly suggests the prior agent's own non-numeric `scratch-seed.cjs` ids (`test-user-full` etc.) are exactly what triggered this crash during its manual verification pass, and is a plausible explanation for why it got stuck.
  - No code change was needed or made for this; documenting it here so it isn't rediscovered as a mystery later.
- Cleaned up every seeded row (`member_records`, `birthdays`, `apollo_events`, `apollo_event_signups`) after verification — `data/bot.sqlite` is back to the state it was in before this session's verification pass (confirmed via a throwaway inspection script, also deleted).
- Stopped the dev server (and one leftover child process from the same startup) and confirmed port 3000 is free again.

## Deviations / open questions

1. No `GET /api/members/:userId` or `status.ts` role-branching route-level tests exist — see Testing section above for why, and that this matches the repo's actual established convention (DB-mirror unit tests only, no route-integration harness exists anywhere).
2. `buildAvatarUrl`'s `BigInt(userId)` fallback assumes a numeric snowflake `userId` — true for all real data, but worth knowing if `GET /api/members/:userId` is ever fuzzed with garbage ids that happen to match an (impossible in practice) non-numeric `member_records.user_id`. Not fixed, since it's outside this task's scope and not reachable with real data.
3. Left several pre-existing untracked files alone as out of scope for this task (not part of the brief's file list, not modified by this backend work): `.playwright-mcp/`, `.superpowers/`, `docs/superpowers/reviews/`, and a set of `*.png` screenshots at the repo root — these look like leftovers from other manual-verification sessions on other tasks and weren't touched.
