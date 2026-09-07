# Review: role-aware dashboard backend (Task 1) — commit `3659bb4`

**Verdict: approved-with-notes**

The backend implementation is correct, well-tested, and faithfully matches the design spec and brief. `npm run typecheck` and `npm test` are both clean (82/82). Manual verification against a backed-up-and-restored copy of `data/bot.sqlite` confirmed all the claimed behavior, including reproducing the reported `BigInt()` edge case exactly as described. There is one real (but expected/deferred) integration issue and a couple of minor polish notes — nothing here should block merging, but the integration issue needs to be tracked so it doesn't get lost before Task 2 lands.

## What was verified live

Ran the dev server (`DEV_MOCK_DISCORD=true`, backend only, no worktree) against a **backed-up copy** of `data/bot.sqlite` (copied to `bot.sqlite.review-backup` before any writes, restored afterward, backup file deleted, WAL/SHM files cleaned up, temporary `.env` removed). Seeded two realistic *numeric* snowflake-style ids (`900000000000000001` full member, `900000000000000002` sparse member) plus one deliberately non-numeric id, directly via `better-sqlite3`, bypassing the prior sessions' non-numeric-id pitfall.

- `GET /api/status` (bot-owner mock session): `communitySnapshot` populated (`memberCount: 3` from the mock guild, `recentAuditActivity` showing 4 correctly-labeled/ordered rows across the 2 seeded members — `left`/`rulesAccepted`/`joined`, newest-first); `botOwnerStats` populated (`botTag: "MockBot#0000"`, etc.). Role branching confirmed working end-to-end, not just by reading the code.
- `GET /api/members/900000000000000001` (full member, former, no avatar hash): 200, full aggregation correct — `registration.status: "registered"`, `birthday: {day: 15, month: 3}`, one `eventHistory` entry with correct `eventTitle`/`startsAt`/`choice`/`attendanceStatus`. `avatarUrl` correctly computed via the `BigInt()` fallback path for a real-looking numeric id (`.../embed/avatars/1.png`) — no crash.
- `GET /api/members/900000000000000002` (sparse, current member): 200, `registration: null`, `birthday: null`, `eventHistory: []` — correct empty-not-error rendering.
- `GET /api/members/900000000000099999` (unknown numeric) and `GET /api/members/not-a-snowflake` (unknown non-numeric, no matching row): both 404.
- `GET /api/members/non-numeric-test-id` (seeded with a **non-numeric** `user_id`, no avatar hash): reproduced the reported 500. Traced it to `buildAvatarUrl()`'s `BigInt(userId)` call at `src/web/routes/memberAudit.ts:23`, exactly as the second agent's report describes.

## Item 2: the `buildAvatarUrl()`/`BigInt()` finding — confirmed correct, with one nuance

`src/web/routes/memberAudit.ts:18-25`:
```ts
export function buildAvatarUrl(userId: string, avatarHash: string | null, size = 64): string {
  if (avatarHash) { ... }
  const index = Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
```
Confirmed live: a non-numeric `userId` reaching this fallback branch throws `SyntaxError: Cannot convert ... to a BigInt`. The second agent's diagnosis is accurate — this is **not a bug introduced by this feature**. `buildAvatarUrl` is pre-existing code already called the same way for the `/members/audit` route's `left` (former-member) list in the same file, so the exposure isn't new. `member_records.user_id` is only ever written from real Discord gateway events, which are always numeric snowflakes, so this path is not reachable with real data.

One nuance worth flagging that neither agent's report mentions: the new route's params schema is `z.object({ userId: z.string() })` (`memberAudit.ts:43`) — it does **not** restrict `userId` to digits. So a malformed/adversarial request to `GET /api/members/:userId` isn't rejected at the validation layer; it either 404s (no matching row — the overwhelmingly likely outcome) or, in the practically-unreachable case where such a row exists, throws and is caught by the central `setErrorHandler` (`src/web/server.ts:87-101`), which correctly returns a generic `500 {"error":"Interner Serverfehler"}` rather than crashing the process or leaking internals — confirmed live. So the failure mode, if it were ever triggered, is graceful (an uninformative 500), not a crash. Non-blocking; a `z.string().regex(/^\d+$/)` on the params schema would let this fail fast as a clean `400` instead, and would be a nice hardening follow-up, but this is genuinely out of scope for this task and matches an existing pattern elsewhere in the same file.

## Item 3: repository correctness

- **`listBirthdaysInNextDays`** (`src/db/birthdaysRepository.ts:92-116`): the year-wraparound resolution (`alreadyPassedThisYear` → roll to `currentYear + 1`) is the same formula already used by `getUpcomingBirthdays()` in `src/services/birthdays.ts:55-56` — verified by direct comparison, not just similarity. The doc comment's justification for duplicating rather than importing (repositories must not depend on services) is correct per the codebase's existing dependency direction. Tests cover within-window, "today counts", outside-window, and the Dec 30 → Jan 5 wraparound case explicitly (`src/db/birthdaysRepository.test.ts:369-379`), plus sort order. Logic re-checked by hand against the Dec 28/days=7/Jan 1-3 scenario from the task brief — resolves correctly.
- **`listRecentMemberActivity`** (`src/db/memberRecordsRepository.ts:766-785`): `UNION ALL` over the three timestamp columns, `ORDER BY at DESC LIMIT @limit` — correctly caps the *combined* total, not per-type, confirmed both by the dedicated test (`memberRecordsRepository.test.ts:722-734`, limit=2 against a row that would produce 3 rows) and live (4 rows returned across 2 users' combined events, correctly ordered/labeled).
- **`getBirthdayForUser`/`listSignupsForUser`**: straightforward, verified against the actual `birthdays`/`apollo_event_signups`/`apollo_events` schema in `src/db/index.ts` (column names match exactly), and verified live via the full/sparse member responses above.

## Item 5: test quality

The three new `*.test.ts` files use the repo's established "SQL mirror" convention (can't import the real repository module directly because `src/db/index.ts` opens the real `data/bot.sqlite` as a top-level side effect). I compared the mirrored SQL/logic in each test file against the real implementation line-by-line — they're faithful copies (the one difference, a `Number.isInteger` NaN guard present only in the real `listBirthdaysInNextDays`, doesn't affect any of the tested scenarios). Assertions are real (row counts, field values, ordering, exact limit-capping), not vacuous. This does mean a future edit to the real function that isn't mirrored into the test won't be caught — an inherent limitation of the convention, not something this task introduced.

## Item 6: `BirthdayEntry.date` field

Genuine, necessary, additive change: `getBirthdayForUser` needs the raw `DD.MM` string to let `memberAudit.ts:134` derive `{day, month}` for `MemberOverview.birthday`. Confirmed the `src/shared/messageTemplate.test.ts` diff (`birthdaysOn()`'s fixture literal) is exactly a one-line addition of the new required field to a `BirthdayEntry` literal — no logic change hiding behind it.

## Item 7/8: typecheck, tests, manual verification

- `npm run typecheck`: clean.
- `npm test`: 82/82 passing.
- Manual dev-server verification: see above — all claims in `task-1-report.md` reproduced independently with better test data (realistic numeric ids alongside a deliberately non-numeric one), including the crash repro.

## Notable issue: `Status` shape break leaves the live Overview page broken until Task 2 lands

Not one of the numbered checklist items, but worth flagging clearly: the committed `GET /api/status` response no longer matches what `web/src/types.ts`'s `Status` interface / `web/src/pages/Overview.tsx` expect. `Overview.tsx` reads `status.botTag`, `status.uptimeMs`, `status.guildName`, `status.guildMemberCount`, `status.cachedMemberCount`, `status.reactionRolePanelCount` all top-level; none of those exist top-level anymore (they either moved under `botOwnerStats` or, for `guildName`, were dropped entirely — the new `contracts/status.d.ts` `Status`/`CommunitySnapshot` types have no `guildName` field, and neither does the design spec itself, so this isn't an implementation slip, it's a spec-level gap). Since this task was correctly scoped to not touch `web/`, this is an **expected, deferred break** per the brief's own "must not change" section (which explicitly calls out this exact shape migration as the one intentional breaking change, with Task 2 responsible for the frontend update) — not a defect in this commit. Concretely, though: as of this commit, on `main`, the live dashboard's Overview page will render "—" / a garbled uptime for every role's stat tiles until Task 2 ships. Flagging this so it's tracked as urgent/blocking for Task 2, and so `guildName`'s complete disappearance from the new contract (not just its move) gets a deliberate decision rather than being silently lost — worth a quick confirmation from whoever owns the spec that dropping "which guild" from the bot-owner view is intentional.

## Minor/non-blocking

- `.superpowers/sdd/role-aware-dashboard-member-overview/task-1-report.md` is tracked in this commit, unlike prior tasks in this repo's history which treated that directory as local-only/gitignored. No actual harm; just an inconsistency worth a passing note.
- The `/api/members/:userId` params schema could tighten to reject non-numeric ids at the validation layer (see Item 2 above) — nice-to-have hardening, not required now.

## Summary

Solid, well-scoped, correctly-tested backend work. Both the spec-compliance and the specific "is this diagnosis actually right" checks (BigInt/avatar, date-window math, activity-merge/limit correctness) held up under independent live re-verification. The one thing to actively track is that merging this to `main` puts the live Overview page in a visibly-broken state for every role until Task 2 (frontend) lands — expected per the task split, but worth keeping front-of-mind so that gap doesn't sit open for long.
