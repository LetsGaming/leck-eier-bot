# Review: `830e62a` — archive former-member records after 1 year

**Verdict: approved-with-notes**

No blocking bugs. `npm run typecheck` is clean and `npm test` passes 68/68. An
end-to-end smoke test against a backed-up-and-restored copy of the real dev
DB confirms the row is deleted only after the archive file is written, and
the archive file contains an exact, lossless copy of the deleted row. One
durability nuance is worth fixing or at least documenting more precisely
(see finding 1); everything else is either correct or a reasonable, already-
acknowledged tradeoff.

## Findings

### 1. (minor, note) "durably flushed" overstates what `writeFile()` actually guarantees — `src/services/memberRecordsArchive.ts:20` (doc comment) and `:42` (the call)

```ts
try {
  await writeFile(filePath, gzipSync(jsonl));   // line 42
} catch (err) { ... }
deleteMemberRecords(records.map((record) => record.userId));  // line 48
```

`fs.promises.writeFile` resolving means the `write()`/`close()` syscalls
completed — the OS has the bytes — but it does **not** call `fsync`/
`fdatasync`. The data can still sit in the OS page cache, unflushed to the
physical disk. `deleteMemberRecords()` (line 48), by contrast, runs a
better-sqlite3 transaction, and with this DB's default `synchronous` pragma
(unset — SQLite's default is `FULL`) that commit **does** fsync before
returning. So the ordering the code guarantees is real (write-then-delete,
never delete-then-write), but the specific claim in the doc comment —
"crash between the two steps only risks re-exporting the same rows next
sweep... rather than ever losing data" — is only true for an *application*
crash (uncaught exception, process restart). It is not quite true for an OS-
level crash or power loss landing in the narrow window after `writeFile`
resolves but before the kernel flushes that page to disk: the DB delete can
already be durably committed while the archive file's bytes are still only
in cache and are lost on power-loss recovery. That would be a real, if very
low-probability, data-loss case for exactly the kind of record this feature
exists to preserve.

This isn't a strict regression — nothing else in this codebase's file-write
paths calls `fsync` either — and the probability of hitting this exact
window (vs. the SQLite commit's own fsync, which is comparatively slow) is
low. But given the stated purpose is "never losing data," I'd either:
- add an explicit `fsync` (open the file, write, `fsync(fd)`, close) before
  proceeding to `deleteMemberRecords()`, or
- soften the doc comment to scope the guarantee to application-level
  crashes rather than power loss.

Not blocking; recommend picking one before or shortly after merge.

### 2. (informational, not a bug) First sweep only happens after the first 5-minute tick

`archiveOldMemberRecords()` is only invoked inside the `setInterval` callback
in `src/events/registerWatcher.ts:152`, unlike `sweepExpiredRegisterThreads`
which is also fired once immediately at startup (line 136) to catch up after
downtime. This means a freshly restarted bot won't archive anything until
`REGISTER_THREAD_SWEEP_INTERVAL_MS` (5 minutes) has elapsed. Harmless at this
bot's scale (archival candidates are already ≥1 year overdue, so a few extra
minutes changes nothing) — flagging only in case it wasn't a deliberate
choice.

## Verification performed

1. **Crash-safety / ordering** — traced `archiveOldMemberRecords()` (`src/services/memberRecordsArchive.ts:28-50`): `listArchivableMemberRecords` → early-return if empty → `mkdirSync` if needed → `gzipSync` + `await writeFile` inside `try` → on `catch`, logs and `return`s **before** calling `deleteMemberRecords` → only on write success does `deleteMemberRecords` run. Confirmed via code reading (no branch reaches delete without the write having resolved) and via the smoke test below. See finding 1 for the one nuance (fsync).

2. **Query correctness** — `listArchivableMemberRecords` (`src/db/memberRecordsRepository.ts:352-354, 358-361`) is `WHERE left_at IS NOT NULL AND left_at <= ?`. Verified the `left_at`/`in_guild` invariant holds everywhere it's written in `src/db/memberRecordsRepository.ts`:
   - `upsertJoinStmt` (line 93-99, used by `recordLeave`'s sibling join path in `services/memberRecords.ts`) always sets `left_at = NULL, in_guild = 1` on join/rejoin.
   - `recordLeaveStmt` (line 115-121, called from `recordLeave()`, invoked by `services/memberRecords.ts:92` with `timestamp: new Date().toISOString()`) always sets `left_at = @timestamp, in_guild = 0` together, in the same statement.
   No code path sets `left_at` without also setting `in_guild = 0`, or vice versa — a current member (`in_guild = 1`) can never have a non-null `left_at`, so the archive query can never touch one.

3. **Deletion correctness** — `deleteMemberRecords` (`src/db/memberRecordsRepository.ts:363-369`) wraps a plain synchronous `for` loop of `deleteMemberRecordStmt.run(...)` calls in `db.transaction(...)`. No `await`/async code inside the callback — correct usage of better-sqlite3's synchronous transaction API.

4. **Timestamp/cutoff math** — `MEMBER_RECORD_ARCHIVE_AFTER_MS = 365 * 24 * 60 * 60 * 1000` (`src/constants.ts`) is exactly 365 days in ms. `cutoffIso = new Date(now.getTime() - MEMBER_RECORD_ARCHIVE_AFTER_MS).toISOString()` is a correct "N ms ago" cutoff. `toISOString()` always emits UTC with a literal `Z` offset (never a numeric offset), and grepping the whole codebase, `left_at` is written from exactly one place — `services/memberRecords.ts:92`, `new Date().toISOString()` — so every stored value shares the identical UTC/`Z` format and lexicographic string comparison against the cutoff is safe. (The only other `left_at`-like column in the codebase, `apollo_event_signups.last_left_at`, is unrelated — event-attendance data, not member records.)

5. **File naming collision** — filename is `member_records-${now.toISOString().replace(/[:.]/g, "-")}.jsonl.gz`. Two real sweeps 5 minutes apart can't collide. A hypothetical same-instant re-run also can't silently overwrite data: the second call would see the already-deleted rows are gone (`listArchivableMemberRecords` returns empty) and return before ever computing a filename — the early return on `records.length === 0` (line 31) protects this, not just interval spacing.

6. **Test quality** — `src/services/memberRecordsArchive.test.ts`'s four tests are meaningful, not vacuous: three exercise the exact cutoff SQL string (`left_at IS NOT NULL AND left_at <= ?`) against a real in-memory better-sqlite3 database with before/after/null-left_at cases (including the "current member is never selected" invariant), and the fourth round-trips real records through `gzipSync`/`gunzipSync` and JSON parsing, asserting deep equality. The comment's claim that `db/index.ts` opens the real `data/bot.sqlite` file as an import side effect is accurate — confirmed by reading `src/db/index.ts:26` (`export const db = new Database(DB_PATH)`, executed at module load, followed immediately by synchronous migrations) — and `src/db/commandPermissionGateMigration.test.ts:5-10` states the identical constraint for the same reason, confirming this is an established, repo-wide pattern rather than something invented for this PR.

7. **`npm run typecheck`**: clean, no errors.
   **`npm test`**: 68/68 passing, including all 4 new tests.

8. **End-to-end smoke test** against a backed-up-and-restored copy of the real dev DB (`data/bot.sqlite`):
   - Backed up `data/bot.sqlite` to the scratchpad.
   - Ran a scratch script (deleted after the run) that inserted a synthetic former-member row with `left_at` 2 years in the past, called `archiveOldMemberRecords()`, and checked the result.
   - Confirmed: the row was gone from `member_records` afterward; `data/archives/member_records-*.jsonl.gz` was created; decompressing and parsing it reproduced the exact record (`userId`, `username`, `leftAt`, etc. all intact).
   - Restored `data/bot.sqlite` from the backup, removed the leftover `-wal`/`-shm` files, deleted the scratch archive file/directory and the scratch script. `git status` shows no changes to any tracked file.

## Summary

The core design is sound: write-before-delete ordering is real and correctly implemented, the SQL cutoff query is provably scoped to former members only (backed by the join/leave invariant elsewhere in the codebase), the transaction usage is correct, the timestamp math and string-comparison safety hold, filename collisions aren't a practical risk, and the new tests meaningfully cover the two pieces of logic that can be tested without the real DB. The one thing worth a follow-up is tightening (or just re-wording) the durability claim around the file write not being fsync'd.
