# Bot Performance, Scalability & Storage Audit — 2026-09-05

Scope: everything under `src/` except `src/web/**` (Discord gateway/event handling, services, DB layer/migrations, loaders, utils, config, `index.ts`).

## Summary

The bot is architecturally sound for its scale: the heaviest read path (Apollo event attendance) already uses aggregate SQL instead of N+1 loops, indexes generally match query patterns, and rate-limit-aware throttling exists where Discord REST loops occur. The real risks are all slow-burn: SQLite has no `busy_timeout`, so a bot write racing a dashboard write can throw `SQLITE_BUSY` instead of queuing; the Discord client caches guild members (and a bot-side duplicate copy of the same data) with no eviction, unbounded by design; and — the single biggest storage-growth risk — **`apollo_event_voice_log`** is a pure-append log with no delete/archive path anywhere in the codebase, growing indefinitely with every join/leave in the tracked voice channel for every tracked event, forever. None of these are urgent for a single small-to-medium guild today, but the `busy_timeout` gap and the voice log are worth fixing proactively since both get strictly worse the longer the bot runs.

---

## 1. Gateway / Event-loop Performance

### 1.1 Every DB call is a synchronous, main-thread SQLite call (informational — no fix needed yet, but explains why other findings matter more than they'd first appear)
`better-sqlite3` (`src/db/index.ts:25`) is synchronous by design — there is no async/worker-thread offload. Every `.get()`/`.all()`/`.run()` in any event handler blocks the Node event loop, including gateway heartbeat processing, for the duration of the query. Individually these are sub-millisecond on today's data volumes, but this means **any future query that becomes slow (a missing index, a full-table scan as a table grows) will directly translate into gateway latency/heartbeat risk**, not just "slow response". Keep this in mind when evaluating the storage-growth findings below — they're not just disk-space concerns, they're eventually latency concerns too.

### 1.2 Unconditional `getSettings()` call on every message in the guild (medium, will get more noticeable with message volume)
`src/events/birthdayWatcher.ts:44-49` and `src/events/registerWatcher.ts:98-100` both call `getSettings()` (a synchronous SQLite `SELECT ... WHERE id = 1`) on **every single `messageCreate`/`messageUpdate` event in the whole guild**, before checking whether the message is even in the relevant channel. Compare with `src/events/apolloEventWatcher.ts:35,45`, which checks `message.author?.id !== APOLLO_BOT_USER_ID` first and only calls `getSettings()` for messages from Apollo's bot account — a much cheaper filter applied first.
- Impact today: negligible (single-row read on a 1-row table, microseconds).
- Impact at scale: if the guild's message volume grows into the thousands/day, this becomes thousands of extra synchronous SQLite reads/day across two handlers, each briefly blocking the event loop. Still likely fine for this bot's scale, but it's an easy no-cost fix (a `bot.id` env check exists in `apolloEventWatcher.ts`, but there's no cheap pre-filter for birthday/register channel checks other than the channel id comparison itself). Consider caching `getSettings()` in memory and invalidating via `settingsBus` (the same pattern `reactionRoles.ts`'s `panelCache` already uses at `src/services/reactionRoles.ts:37-60`) instead of re-querying on every message.
- **Ranking: will bite at higher message volume, but low real-world impact for this bot's current scale.**

### 1.3 Discord member/role loops are correctly serialized, not parallelized — acceptable at this scale
`src/services/reactionRoles.ts` (`applyMappingSelection`, `applyDropdownSelection`) issues one `member.roles.add`/`.remove()` REST call per role in a mapping, sequentially inside `runSerialized()` (`src/services/reactionRoles.ts:101-116`, keyed per message+user). This is correct for correctness (role state must be consistent per user) and Discord's per-route rate limits are per-guild/per-route, not global, so sequential awaits here don't meaningfully risk hitting a rate limit for a single-guild bot with realistic click volume. **No action needed** — flagging only because it's a loop-with-REST-calls pattern that would matter in a higher-fan-out scenario (e.g. a bulk "apply this role to everyone" admin action, which does not exist in this codebase).

### 1.4 `deleteBirthdayMessages()` / `closeAnchorChainGaps()` — serialized message deletes with a fixed throttle (low)
`src/services/birthdays.ts:154-193` and `:444-472` delete messages one at a time with a 250ms sleep between each (`MESSAGE_DELETE_DELAY_MS`, `src/constants.ts:29`) rather than using Discord's `bulkDelete`. For a channel accumulating dozens of birthday announcements between nightly cleanups, this is a few seconds of sequential work in a cron callback — not blocking, since real `await`s yield the event loop between deletes. `bulkDelete` isn't usable here anyway (messages older than 14 days can't be bulk-deleted, and mixing individual "protected" exclusions per message favors the current approach). **Ranking: theoretical, no real fix needed at this scale.**

### 1.5 Cron/interval jobs are event-driven and appropriately scoped (good)
- `APOLLO_EVENT_SWEEP_INTERVAL_MS = 30s` (`src/constants.ts:86`) drives `sweepApolloEvents()`, which only queries `listDueScheduledEvents`/`listDueActiveEvents` — both served by `idx_apollo_events_status_starts` (`src/db/index.ts:586`), so this is a small indexed lookup every 30s regardless of how many historical events accumulate. Good.
- `REGISTER_THREAD_SWEEP_INTERVAL_MS = 5min` (`src/constants.ts:78`) similarly scans only rows with a non-null `register_thread_expires_at`, not the whole table.
- The birthday cron is once/day and does a single indexed `WHERE date = ?` lookup (`src/db/birthdaysRepository.ts:17-19`).
None of these degrade as historical data grows — they're all incremental/indexed, not full-table rescans.

---

## 2. Database / Query Performance

### 2.1 `apollo_event_signups`/`apollo_events` list queries already avoid N+1 (good, worth confirming explicitly)
`summarizeSignupsForEvents()` (`src/db/eventAttendanceRepository.ts:433-477`) aggregates signup counts for a batch of event ids in one `GROUP BY` query instead of the "loop calling `listSignups()` per event" pattern the code comment says was previously removed. This is the right pattern and scales fine as `apollo_event_signups` grows — it's driven by `event_id IN (...)`, and `event_id` already has a leading index via the `UNIQUE(event_id, normalized_name)` constraint.

### 2.2 `recomputeAttendanceForEvent()` — one query per signup (low, bounded by event size)
`src/services/eventAttendance.ts:125-140` loops over every trackable signup in an event and calls `listVoiceLogForUser()` per signup — technically an N+1 pattern, but N is bounded by the number of people who signed up for one event (tens, realistically), and this only runs at event completion or after a manual name-link (a low-frequency, not-user-facing-latency-sensitive operation). **Ranking: theoretical — the "N" here is real-world small and won't grow with total historical data, only with one event's attendee count.**

### 2.3 `recordMemberProfileUpdate()` runs on every `guildMemberUpdate`, not just profile changes (low-medium write amplification)
`src/events/memberEvents.ts:74-76` calls `recordMemberProfileUpdate()` (an unconditional `UPDATE member_records SET username=…, display_name=…, avatar=… WHERE user_id=?`) on **every** `guildMemberUpdate` event — which fires for role changes, timeouts, boost status changes, and nickname changes alike, not just username/avatar changes. Every one of these writes a row to the SQLite WAL even when nothing the query actually SETs has changed.
- Impact: for an active guild with frequent role assignments (e.g. via the reaction-role panels this same bot runs), this could be dozens-to-hundreds of no-op writes/day. WAL churn is real but bounded — WAL checkpoints reclaim space, and single-row updates are cheap — so this is a minor efficiency loss, not a growth risk.
- Fix direction: compare old vs. new username/displayName/avatar before writing, same as how `recordRulesAcceptedIfJustVerified()` (right below it) already only fires on an actual state transition.
- **Ranking: will bite mildly as guild activity grows; not urgent.**

### 2.4 No egregious missing indexes found
Checked every repository's `WHERE`/`ORDER BY` against `src/db/index.ts`'s schema:
- `apollo_events`: `status+starts_at` composite index and a standalone `starts_at` index (v30, added specifically because the composite couldn't serve a bare range scan — good, deliberate fix already in place) both exist and match `listDueScheduledEvents`/`listDueActiveEvents`/`listEventsInRange`.
- `apollo_event_signups`: indexed on `event_id` and `user_id` separately, plus the `UNIQUE(event_id, normalized_name)` — matches every query pattern in `eventAttendanceRepository.ts`.
- `apollo_event_voice_log`: `idx_apollo_voice_log_event(event_id, user_id, at)` matches both `listVoiceLog` (`WHERE event_id = ? ORDER BY at, id`) and `listVoiceLogForUser` (`WHERE event_id = ? AND user_id = ? ORDER BY at, id`).
- `member_records`: only `in_guild` is indexed; `listAllMemberRecords()`/`listRegistrations()` are unfiltered/status-filtered full scans, but `member_records` is one row per unique Discord user ever seen — see §3.2, this table stays small for a single-guild bot for years.
- `birthdays`: `date` and a unique `user_id` index both exist and match every query.
- No index exists on `LOWER(title)` for the Apollo event title search — correctly reasoned as unnecessary in the migration's own comment (`src/db/index.ts:636-642`): a leading-wildcard `LIKE '%x%'` can't use a B-tree index regardless, so an index would cost write overhead for zero read benefit. Agreed — no action needed.

### 2.5 `command_settings`/`settings` singleton reads are fine
Both are tiny, fixed-size tables (`settings` is a single row, `command_settings` has one row per command — dozens at most). No concern.

---

## 3. SQLite Config / Concurrency

### 3.1 No `busy_timeout` pragma set (medium — the one config gap actually worth fixing)
`src/db/index.ts:25-27` sets `journal_mode = WAL` and `foreign_keys = ON`, but never sets `busy_timeout`. WAL mode allows one writer + concurrent readers, but **two concurrent writers still serialize**, and without `busy_timeout` a writer that finds the database locked fails immediately with `SQLITE_BUSY` instead of retrying for a bounded window. This repo has exactly the two-writer scenario WAL is meant to help with — the bot process and the dashboard's Fastify server share one `bot.sqlite` file and each opens its own connection (see `src/web/server.ts`'s own `db` import path, out of this review's scope but confirmed to hit the same file). A dashboard admin editing settings at the exact moment the bot's Apollo sweep or a reaction-role write lands could get a transient failure rather than a queued retry.
- Impact: low probability per write (both sides' write transactions are short), but the failure mode when it does happen is an unhandled exception surfacing as a 500/error log rather than a graceful short wait.
- Fix direction: add `db.pragma("busy_timeout = 5000")` (or similar) right next to the existing pragmas in `src/db/index.ts:26-27`. Trivial, no migration needed, no downside.
- **Ranking: will bite occasionally under concurrent load; worth fixing now since it's a one-line change with no risk.**

### 3.2 No explicit `synchronous` pragma (informational, current default is fine)
WAL mode's default `synchronous = NORMAL` is the recommended setting for WAL and is what SQLite already applies automatically when `journal_mode = WAL` is set — no explicit override needed. Not a finding, just confirming it was checked.

### 3.3 `foreign_keys = ON` is set and used correctly
`reaction_role_mappings.panel_id` has `ON DELETE CASCADE` to `reaction_role_panels`, and `apollo_event_signups`/`apollo_event_voice_log` cascade from `apollo_events` — all rely on `foreign_keys = ON` actually being honored, which it is. No gap here.

---

## 4. Storage / Disk Growth (table-by-table)

This is the primary deliverable. Walking every table in `src/db/index.ts`'s schema:

| Table | Written by | Rate (rough) | Ever pruned? | Verdict |
|---|---|---|---|---|
| `apollo_event_voice_log` | `appendVoiceLog()` on every voice join/leave in the tracked channel during an active event, plus synthetic `present_at_start`/`present_at_end`/catch-up rows | 2+ rows per attendee per event (join+leave; more if they leave/rejoin) | **Never** — no delete function exists in `eventAttendanceRepository.ts` except the cascading `deleteEvent()`, which is only called from a dashboard admin action, not automatically | **Biggest unbounded-growth risk in the codebase.** For a community running e.g. 2 events/week with 15 attendees each averaging 2 voice actions, that's ~150 rows/week, ~7,800/year — individually trivial, but this is genuinely unbounded and has no built-in cap or archival. At realistic scale (hundreds to low thousands of rows/year) this stays cheap for years; it only becomes a real problem at a scale this bot's community is unlikely to reach (heavy multi-event-per-day usage over a decade+). **Verdict: will not bite within a realistic multi-year lifetime, but is the one table that should get a retention/archive policy if the bot is expected to run indefinitely, since it's the only table with literally no cap.** |
| `apollo_event_signups` | `replaceEventSignups()` per Apollo message parse | ~1 row per unique RSVP name per event; re-parses upsert, don't duplicate | Rows only ever deleted while an event is still `scheduled` (an un-RSVP); once `active`/`completed`, rows are kept forever (`withdrawn_at` marks them instead) — deliberate, for attendance history | Bounded by (events × avg attendees) — same order of magnitude as `apollo_events` below. **Negligible for years.** |
| `apollo_events` | One row per Apollo embed | 1 row per event held | Never deleted automatically (manual dashboard delete only) | At even 3 events/week that's ~150/year — **trivially small forever.** |
| `member_records` | One row per unique Discord user ever seen (join/leave/profile update) | 1 row per net-new unique member ever; updated in place otherwise, not appended | **By design, never deleted** — this table is explicitly the audit trail for former members (`in_guild = 0` rows kept forever, per migration v13's own doc comment) | This is intentional and the row count is bounded by *unique humans who ever joined*, not by activity — even a very active community rarely exceeds low thousands of unique members over many years. **Negligible.** |
| `web_sessions` | `createSession()` on every dashboard login | 1 row per login | `sweepExpiredSessions()` exists and deletes rows with `expires_at < now`, but is **only ever called once, at web server startup** (`src/web/server.ts:36`) — not on an interval | For a bot that stays up for weeks/months between restarts, expired session rows accumulate until the next restart instead of being swept continuously. Given a small admin team logging in occasionally, this is a handful of rows/week at most. **Ranking: low — will not meaningfully affect disk size, but the sweep should arguably run on an interval (or lazily inside `getSession()`, which already deletes an individual expired row it encounters) rather than startup-only, for correctness/hygiene rather than storage reasons.** |
| `reaction_role_panels` / `reaction_role_mappings` | Dashboard/admin panel creation | Rows created/edited by admins directly, deleted via `deletePanel()` (cascades to mappings) | Deletable via explicit admin action; no automatic cleanup of "orphaned" panels (e.g. a panel whose Discord message was manually deleted outside the bot) | Row count is bounded by how many panels an admin manually creates — realistically single/low-double digits. **Negligible**, and an admin-initiated create/delete lifecycle is the right model here, not something needing automatic pruning. |
| `birthdays` / `birthday_anchor_messages` | One row per member's registered birthday; anchor table fully replaced (`DELETE` + re-`INSERT`) on every sync | 1 row per unique member with a birthday set; anchor table capped at however many Discord messages the chain currently needs (single digits) | `deleteBirthdaysForUser()` on member leave; anchor table is a `DELETE ALL` + re-insert every sync, so it never grows | **Negligible — actively self-pruning.** |
| `command_settings`, `settings` | Dashboard config changes | Fixed row count (1 per command; 1 total) | N/A — fixed size | **No growth at all.** |

### 4.1 Overall storage verdict
With the one exception of `apollo_event_voice_log`, every table in this schema either has a natural cap (fixed config rows), is actively pruned (birthdays, anchor messages), or grows proportionally to *unique humans/events* rather than *activity volume* — which for a single-guild community bot stays in the hundreds-to-low-thousands-of-rows range indefinitely. `apollo_event_voice_log` is the only table whose growth is tied to ongoing *activity* (every join/leave, forever), and it's still small in absolute terms for years at this bot's apparent event cadence. **Recommendation: not urgent, but if event attendance tracking becomes a heavily-used feature (many events per week, long-running voice sessions with lots of rejoin churn), consider archiving voice-log rows for events older than N months once `apollo_events.status = 'completed'` and attendance has been finalized — the log's only purpose is to let `recomputeAttendanceForEvent()` re-derive attendance after a manual link, which becomes moot once staff stop editing old events.**

---

## 5. Startup

### 5.1 `initMemberCache()` fetches the entire guild member list synchronously at boot (low, proportional but not yet a problem)
`src/services/memberCache.ts:8-22`, called from `src/index.ts:212`, does `await guild.members.fetch()` — a full member list fetch (paginated internally by discord.js) at every boot, stored into a second `Collection` duplicate of what discord.js's own `GuildMemberManager` cache already holds (see §6.1). This is `O(member count)` REST/gateway work at startup — for a guild with a few hundred to low thousands of members, this takes a few seconds; for tens of thousands it would take noticeably longer and hit more of Discord's chunking behavior. **Ranking: proportional to guild size and will get slower as the guild grows, but a single-guild community bot reaching a size where this matters (tens of thousands of members) is unlikely; not worth optimizing pre-emptively.**

### 5.2 `seedMemberRecordsFromCache()` — one UPSERT per current member, every boot (low)
`src/services/memberRecords.ts:10-20`, called right after `initMemberCache()`, does a synchronous `upsertJoin()` (one prepared-statement `INSERT ... ON CONFLICT`) per currently-cached member, sequentially, at every startup. For N members this is N synchronous SQLite writes back-to-back on the main thread at boot — not wrapped in a single transaction. For a guild with a few thousand members this is a few thousand small synchronous writes in a tight loop, which will visibly extend startup time (each write forces a WAL append) and briefly pins the event loop, though this only happens once per process restart, not per request.
- Fix direction: wrap the loop in a single `db.transaction()` (the codebase already uses this pattern elsewhere, e.g. `replaceEventSignups`/`appendVoiceLog`) to batch the writes into one transaction instead of N auto-committing ones — this alone typically gives an order-of-magnitude speedup for bulk sequential writes in better-sqlite3.
- **Ranking: will bite noticeably once the guild reaches a few thousand members; cheap, low-risk fix (wrap in `db.transaction`).**

### 5.3 Command loading and slash-command registration are proportional to command count, not data size (fine)
`src/loaders/commandLoader.ts` walks the `commands/` directory and re-registers with Discord on every boot — this scales with number of *commands* (a fixed, small, code-controlled quantity), not with guild/message/event data. No concern.

---

## 6. Other

### 6.1 Two independent, unbounded, largely-duplicate member caches (medium — the "cache configuration" question from the brief)
No `makeCache`/sweeper options are passed to the `Client` constructor (`src/index.ts:97-113`), so discord.js's default caching applies: `GuildMemberManager` caches every member ever fetched or seen via gateway events, with no eviction (djs v14's only *default* sweeper targets messages, not members/users — and this bot doesn't request the `Presences` intent at all, so presence-cache growth, which the prior clean-code review flagged, is actually a non-issue here since there's nothing being cached there). On top of that default cache, `src/services/memberCache.ts` maintains a **second, hand-rolled `Collection<string, GuildMember>`** populated by the same `guild.members.fetch()` call and kept in sync via `guildMemberAdd`/`guildMemberUpdate`/`guildMemberRemove` — this is a full duplicate of data discord.js's own manager already holds at `guild.members.cache`.
- Memory impact: a `GuildMember` object holds a handful of string/boolean fields plus a shared reference to a `User` — very roughly ~1-2KB effective marginal footprint per member once shared structures are accounted for. For a guild that grows to, say, 5,000 members over several years, that's on the order of 5-10MB *doubled* by the redundant cache — genuinely small in absolute terms for a Node process, but it is real, permanent, and unbounded (never evicted even for members who've been gone for years, since `removeCacheMember()` is only called on `guildMemberRemove`, which does correctly clean up the custom cache — but the *discord.js-native* `members.cache` has no eviction at all for members who leave while the bot isn't actively managing that, though in practice discord.js does remove a member from its own cache on `guildMemberRemove` too).
- **Ranking: not a real problem at this bot's scale (single guild, community-sized membership) — flagging because it's genuinely two caches doing the same job, and the redundant one (`memberCache.ts`) could be deleted in favor of `guild.members.cache` + `guild.members.fetch()` for the one-time boot population, simplifying the code without a behavior change. This is more a "why maintain two" question than a performance emergency.**

### 6.2 `searchCachedMembers()`/`resolveMemberByExactName()` are O(member count) per call (low)
`src/services/memberSearch.ts:116-129,147-160` both iterate every cached member on every call — used by `/finduser` (user-invoked, low frequency) and by Apollo signup name resolution (once per RSVP line, per Apollo message edit — Apollo re-posts/edits its embed on every RSVP change, so this could run dozens of times during an active signup period, each doing an O(member count) scan per RSVP line, i.e. O(members × signups) per Apollo message edit). For a guild in the hundreds-to-low-thousands of members with events attracting dozens of signups, this is at most tens of thousands of string comparisons per Apollo edit — sub-millisecond in practice, not a real concern until member count reaches the tens of thousands.
- **Ranking: theoretical at this bot's scale; would only matter for a much larger guild than this bot is designed for.**

---

## Priority Recap

**Fix now (cheap, no downside):**
1. §3.1 — add `busy_timeout` pragma to `src/db/index.ts`.
2. §5.2 — wrap `seedMemberRecordsFromCache()`'s loop in a `db.transaction()`.

**Worth doing, not urgent:**
3. §1.2 — cache `getSettings()` in-memory (invalidated via `settingsBus`) to avoid a DB hit on every guild message.
4. §2.3 — skip `recordMemberProfileUpdate()` writes when nothing actually changed.
5. §4.1 — plan a retention/archive policy for `apollo_event_voice_log` if event-tracking usage grows significantly.

**Low priority / informational, revisit only if the bot's usage profile changes a lot:**
6. §6.1 — consider removing the redundant hand-rolled member cache in favor of discord.js's own `guild.members.cache`.
7. §4 (`web_sessions`) — sweep expired sessions on an interval, not just at startup.
8. §5.1, §6.2 — proportional-to-guild-size costs that are fine at this bot's realistic scale.
