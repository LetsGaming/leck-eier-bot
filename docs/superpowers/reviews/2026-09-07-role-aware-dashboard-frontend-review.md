# Review: role-aware dashboard frontend (Task 2) — commit `d056cab`

**Verdict: approved**

`Overview.tsx` is genuinely fixed against the new role-aware `Status` shape, `MemberOverview.tsx` correctly handles the full/sparse/not-found cases, cross-linking is correct everywhere (including the two spots the implementer could not exercise live), `npx tsc --noEmit` is clean, and no backend file was touched. One cosmetic, unverified-in-practice edge case is noted below but does not block approval.

## 1. The urgent fix — `Overview.tsx` vs. the new `Status` shape

Confirmed via `git show d056cab -- web/src/types.ts web/src/pages/Overview.tsx`: the old flat `Status` interface (`botTag`, `guildMemberCount`, `guildName`, `cachedMemberCount`, `reactionRolePanelCount` as unconditional top-level fields) is gone. `web/src/types.ts:33-38` now does `export type Status = StatusContract;`, re-exporting `contracts/status.ts`'s `Status` — same convention as the existing `MemberAuditEntry`/`RegistrationEntry` re-exports in that file.

`Overview.tsx` reads only `status.pendingRegistrationCount`, `status.unmatchedSignupCount`, `status.communitySnapshot` (unconditional), and `status.botOwnerStats` (conditional) — matching `contracts/status.d.ts` exactly. No stale flat-field reads remain (grepped the whole diff and the resulting file).

`BotOwnerStatsSection` correctly reads `stats.guildName` (`Overview.tsx`, the `BotOwnerStatsSection` component's "Server" stat tile) — this is the follow-up field the task brief flagged as landing after the implementer's brief was written (`contracts/status.d.ts:64-69`, `src/web/routes/status.ts:64`). Confirmed live: `GET /api/status` for a bot-owner mock session returns `botOwnerStats.guildName: "Mock-Server (DEV_MOCK_DISCORD)"`, and the rendered Overview page shows it in the "Server" tile.

## 2. `BotOwnerStatsSection` gating

`Overview.tsx`: `{status.botOwnerStats && <BotOwnerStatsSection stats={status.botOwnerStats} />}` — a plain truthy check, `BotOwnerStatsSection` is never invoked with a null `stats`, so there's no possibility of it rendering blank/crashed tiles for a non-bot-owner session. Confirmed by reading `src/web/routes/status.ts`'s role branching (`botOwnerStats: isBotOwner ? {...} : null`) that this is `null` for guild-owner/admin sessions. Not independently live-verified under an actual guild-owner/admin login — the mock client only ever logs in as bot-owner (same limitation the implementer's report and the Task 1 backend review both already documented), so this is a code-read confirmation, consistent with both prior reports' explicit caveat.

## 3. `MemberOverview.tsx` — three states

Live-verified all three, using two seeded numeric-snowflake test rows (a full member with registration+birthday+event signup, and a sparse member with none) plus a nonexistent id, directly against a backed-up-and-restored copy of `data/bot.sqlite`:

- **Full member** (`/members/900000000000000001`): profile header, audit timeline (joined/rules-accepted populated, "Verlassen" —), registration ("Registriert" badge), birthday ("15.03." + link to `/birthdays`), and event history (1 row linking to `/events/10`, "Zugesagt"/"Pünktlich" badges) all rendered correctly, no console errors.
- **Sparse member** (`/members/900000000000000002`): registration/birthday sections render "Kein Registrierungsformular eingereicht." / "Kein Geburtstag hinterlegt." (empty, not error); event history renders "Keine Event-Anmeldungen." (0 rows) — confirmed these are deliberate empty-state branches (`MemberOverview.tsx`, the `member.registration ? ... : <p className="muted">...` pattern repeated for each optional section), not something that would throw on `null`.
- **Unknown id** (`/members/900000000000099999`): backend correctly 404s (confirmed via direct `Invoke-RestMethod` call, status 404); page renders the dedicated "Kein Mitglied mit dieser ID gefunden." card with a back-link, not a crash. Two browser console entries are just the DevTools network-log lines for the 404 response itself, not JS exceptions — no error boundary triggered, no white screen.

**`useMemberOverview`'s 404 vs. real-error branching** (`web/src/hooks/useMemberOverview.ts:20-25`):
```ts
try {
  return await api.memberOverview(userId);
} catch (err) {
  if (err instanceof ApiError && err.status === 404) return null;
  throw err;
}
```
Traced `ApiError`/`request()` in `web/src/api.ts` (`throw new ApiError(res.status, message)` on any non-OK response) — `err.status` is the real HTTP status code from the response, not a heuristic. Only exactly-404 resolves to `null`; every other status (400/500/network failure/etc.) is rethrown and propagates to `useFetchedResource`'s standard `showError(errorMessage(err))` toast path. This does **not** swallow a real 500 as a graceful not-found — confirmed by reading the branching logic, consistent with the Task 1 backend review's note that a malformed/adversarial `userId` that somehow throws server-side surfaces as a generic 500 (caught by the central error handler), which would correctly reach the toast here, not the "not found" card.

**Minor, unverified-in-practice note**: `MemberOverview.tsx:29` gates loading vs. not-found purely on `loading && !member`. `useFetchedResource`'s `loading` state initializes to `false` (`web/src/hooks/useFetchedResource.ts:31`) and only flips to `true` once the mount effect fires `load()`. On the very first render (before that effect runs), the condition is `false && true` = `false`, which falls through to the "not found" branch rather than the loading spinner for one render pass. In practice this is likely never visible — React's effect-then-paint ordering combined with how fast local/mock fetches resolve makes an actual flash improbable, and I could not get Playwright to catch an intermediate frame showing it during live testing. Flagging as a theoretical one-tick flash, not a functional bug — not blocking.

## 4. Cross-linking correctness — all three components confirmed live

- **`MemberAudit.tsx`** (`web/src/pages/MemberAudit.tsx:109-111` registrations table, `:185-187` `MemberRow`): both use unconditional `<Link to={`/members/${entry.userId}`}>` — correct, since both `RegistrationEntry.userId` and `MemberAuditEntry.userId` are non-nullable `string` in their contracts (`contracts/registrations.d.ts`, `contracts/memberAudit.d.ts`), so there's no null-link risk here by construction. Confirmed live for the registrations table ("Full User Review" → `/members/900000000000000001`). The in-guild/left `MemberRow` tables could **not** be exercised live in this environment either — confirmed independently that `GET /api/members/audit` 503s in `DEV_MOCK_DISCORD` mode (reproduced the exact same 503 the implementer's report describes), a genuine pre-existing mock-environment gap unrelated to this task. The `MemberRow` link markup is byte-for-byte the same one-line pattern already confirmed live in the registrations table, so this is a very low-risk gap.
- **`Birthdays.tsx`** (`EntryLabelLink`, `web/src/pages/Birthdays.tsx:31-34`): `entry.userId ? <Link ...>{label}</Link> : <>{label}</>` — confirmed **live** (previously flagged by the task as unverified... actually this one *was* verified by the implementer already, and I re-confirmed it independently): "Full User Review" (userId set) rendered as a working link to `/members/900000000000000001` in both the "Als Nächstes" summary tile and the main table; a separately-seeded "Name Only Person" entry (userId `NULL`) rendered as plain, unlinked text in the same table row. Link-omission logic confirmed correct by direct observation, not just code reading.
- **`SignupRow.tsx`** (`web/src/components/SignupRow.tsx:44`): `{signup.userId ? <Link to={`/members/${signup.userId}`}>{signup.displayName}</Link> : signup.displayName}`, nested inside the pre-existing `signup.displayName ? (...) : (...)` truthy branch — so the link can only ever render once a display name has resolved. I independently confirmed the implementer's claimed mock-environment gap is real, not just asserted: seeded an event signup with `user_id` set to the full member's real id and checked `src/web/routes/eventAttendance.ts:98`, `displayName: cached?.displayName ?? null` — this looks up the *live* member cache, and `src/web/mockDiscordClient.ts`'s mock guild only ever exposes a static `memberCount: 3` with an empty `members.cache`, so `cached` is always `undefined` regardless of `userId` being set. Reproduced live: the seeded signup showed up as "Nicht zugeordnet" (unmatched) despite having a real `userId` in the database, exactly as the implementer predicted. The `<Link>` branch is therefore genuinely unreachable in this environment, confirming it can only be verified by code review here — which I did, and the one-line change is correct and matches the "link when non-null" requirement, additive to the untouched unmatched-badge path.

## 5. `api.memberOverview()`

`web/src/api.ts:89`: `memberOverview: (userId: string) => request<MemberOverview>(`/members/${userId}`)`. Matches the actual backend route `app.get("/members/:userId", ...)` in `src/web/routes/memberAudit.ts:124` (mounted under `/api`, per this codebase's existing convention for every other `api.*` call in the same file). Confirmed working end-to-end via both direct `Invoke-RestMethod` calls and the rendered `MemberOverview.tsx` page for full member, sparse member, and 404 cases (see §3).

## 6. Scope check

`git show d056cab --name-only` shows only `web/*` files plus the task's own `.superpowers/sdd/.../task-2-report.md` — no `src/` (backend) file was touched. Confirmed clean.

## 7. Typecheck

`npx tsc --noEmit` in `web/`: clean, no output, exit code 0.

## 8. Manual verification summary

Ran the backend (`DEV_MOCK_DISCORD=true`, `npx tsx src/index.ts`, backgrounded with a bounded polling wait for port 3000, never an indefinite block) and the Vite dev server (`npm run dev` in `web/`, port 5173) side by side, against a **backed-up copy** of `data/bot.sqlite` (copied to `bot.sqlite.review-backup`/`-shm`/`-wal` before any writes). Verified ports 3000/5173 were free before starting and free again after stopping. Seeded two numeric-snowflake test members plus a name-only birthday entry and one event/two signups via a throwaway `better-sqlite3` script, exercised the app via Playwright (dev-login → Overview → MemberOverview ×3 states → Birthdays → MemberAudit → EventAttendanceDetail), then deleted every seeded row and confirmed each affected table back at its pre-session row count, restored `data/bot.sqlite` from the backup, and deleted the backup files, the temporary `.env`, the seed/cleanup scripts, and the Playwright output directory. `git status --porcelain` afterward shows only the same pre-existing untracked files that were present before this review began.

## Bugs found

None blocking. See the one-tick loading/not-found flash noted in §3 — cosmetic, not reproduced live, not blocking.

## Quality notes

- The re-export convention in `types.ts` (`export type Status = StatusContract`) is consistent with the rest of the file and keeps every existing `Status` import working unchanged — good choice over a rename.
- `CommunitySnapshotSection`'s three cards each have independent, sensible empty states rather than one blanket "nothing to show" — matches the spec's emphasis that the three list fields are independently and commonly empty.
- Reusing `.attention-list`/`.card-grid` instead of inventing new CSS for the new sections, and the one small `.member-header` addition to `theme.css` for the profile header, both follow this codebase's established "check `theme.css` first" convention.
- `MemberAudit.tsx`/`Birthdays.tsx`/`SignupRow.tsx` cross-linking is additive only — no existing action buttons, columns, or behavior were touched, matching the brief's explicit "must not change" constraint.

## Summary

This is a correct, well-scoped fix that resolves the urgent Overview.tsx breakage exactly as described, correctly incorporates the `botOwnerStats.guildName` follow-up field the implementer's brief predates, and adds a solid new `MemberOverview.tsx` page with genuinely correct 404/sparse/full-data handling. Both previously-unverified cross-linking spots (`MemberAudit.tsx`'s in-guild/left tables, `SignupRow.tsx`'s matched-name link) remain blocked by the same pre-existing, independently-reproduced `DEV_MOCK_DISCORD` environment gaps (the `/api/members/audit` 503 and the mock guild's empty member cache) — not defects in this commit — and their code is correct by inspection and, in `SignupRow.tsx`'s case, by directly reproducing the exact mock-environment behavior the implementer described.
