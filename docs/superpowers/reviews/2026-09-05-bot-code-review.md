# Bot code review — leck-eier-bot (`src/**` excluding `src/web/**`)

Date: 2026-09-05
Scope: `src/commands`, `src/events`, `src/services`, `src/loaders`, `src/db`, `src/utils`,
`src/config`, `src/index.ts`, `src/constants.ts`, `src/types.ts`. `src/web/**` and `web/src/**`
were read only to understand the seam, not deep-reviewed.

## Summary

This codebase is well above average for a Discord bot: the repository layer is a genuine
exception (typed prepared statements, explicit column lists, row→domain mappers everywhere,
transactional multi-statement writes, extensive "why" comments on every non-obvious migration
decision), config is parsed once at boot with fail-fast validation, and most services
(`birthdays.ts`, `reactionRoles.ts`, `eventAttendance.ts`, `memberSearch.ts`) are pure,
well-documented, and correctly separated from the Discord-event plumbing that calls them.
The problems that exist are concentrated and consistent: three independently-implemented
`{placeholder}` template renderers, a handful of event handlers (`registerWatcher.ts`,
`memberEvents.ts`, `apolloEventWatcher.ts`) that hold real business logic instead of delegating to
a service the way `birthdayWatcher.ts`/`reactionRoleEvents.ts` do, slash commands re-registered on
every boot, and two commands (`/clear`, `/cleardm`) that each hand-roll the same paginated-bulk-delete
loop instead of sharing one. None of these are severe, but they're the recurring shape worth fixing.

## Boundaries / SRP

**High — commands re-register with Discord on every boot (`src/index.ts:194-198`, `src/loaders/commandLoader.ts:91-97`)**
`rest.put(Routes.applicationCommands(...))` runs unconditionally inside the startup IIFE, and
`reloadCommands()` does the same thing again whenever the dashboard's Commands page saves an
override. `discordjs.md`'s explicit red-flag list: "Re-registering/syncing commands on every
boot." Global command registration is rate-limited and meant to be a deploy-time or
explicitly-triggered action, not something that runs on every process start/restart (crash-loop
during an incident turns into repeated syncs). Fix direction: split "load/enable commands
in-process" (fine to always do) from "push definitions to Discord" — only do the latter when the
on-disk command set/definitions actually changed (e.g. a hash check) or behind an explicit
owner-only command/deploy script, matching what `discordjs.md` prescribes.

**Medium — business logic embedded directly in event handlers instead of a service, inconsistently with the rest of the codebase**
- `src/events/registerWatcher.ts` — the entire self-registration feature (form parsing,
  nickname building, thread creation, auto-complete role grant, sweep) lives in the `events/`
  file with no corresponding `services/register*.ts`. Every other DB-backed feature in this repo
  (birthdays, reaction roles, member records, event attendance) puts its decisions in a
  `services/*.ts` module and keeps the `events/*.ts` file as thin wiring — this file breaks that
  pattern.
- `src/events/memberEvents.ts:43-63` — `stripRegisterGateRoleIfJustRegistered()` (a real decision:
  "if the tier role was just granted, remove the gate role") is a private function inside the event
  file rather than in `services/memberRecords.ts` or a new `services/registerGate.ts`.
- `src/events/apolloEventWatcher.ts:27-76` — `tryHandleApolloMessage()` builds `ParsedSignupInput[]`
  by looping and branching on `resolveMemberByExactName()`'s result — this mapping/resolution
  decision reads like service logic sitting in the event handler.

Compare with `src/events/birthdayWatcher.ts` and `src/events/reactionRoleEvents.ts`, which are
both properly thin (parse the trigger, call one service function, done). Standard:
`engineering-principles.md`'s SRP rule ("a repository answers questions; a service makes
decisions; keep them apart") and `backend-apis.md`'s "no business logic in handlers" applied to
the event-driven equivalent. Fix direction: extract `registerWatcher.ts`'s logic into
`services/registration.ts` (parsing, nickname-building, and the auto-complete decision are already
written as clean, mostly-pure helper functions — moving them is mechanical), and pull
`stripRegisterGateRoleIfJustRegistered`/the Apollo signup-mapping loop into their related services.

**Low — `/clear` and `/cleardm` embed real orchestration logic in the command body**
`src/commands/general/clear.ts:56-89` and `src/commands/general/clearDm.ts:39-107` each implement
their own fetch-paginate-bulkDelete/rate-limit-sleep loop directly in `execute()`. `discordjs.md`:
"a command is a thin handler over a service ... no raw DB/fetch ... a rule-bearing branch or a bare
fetch in a command is on the wrong side of a seam." Neither command is a simple CRUD case that
would justify skipping a service. Fix direction: factor a shared `services/messageCleanup.ts`
with a `bulkDeleteMessages(channel, amount)` (or per-channel-type variant) helper; see the DRY
finding below — this doubles as that fix.

## DRY / magic values

**Medium — three independent `{placeholder}` template-substitution implementations (Rule of Three met)**
- `src/services/birthdays.ts:83-95` (`renderBirthdayTemplate`) — `.replace(/{userMention}/g,...)` chain.
- `src/services/birthdays.ts:309-346` (inside `buildAnchorParts`) — a different `{month}`/`{entries}`
  substitution with its own `.includes("{entries}")` fallback branch.
- `src/events/registerWatcher.ts:76-79` (`renderConfirmation`) — a third `{name}`/`{roleChannel}`
  `.replace(/g,...)` chain.

All three do the same shape of work (substitute named placeholders in a user-configured string,
sometimes through `applyFont()` first) with three separate ad-hoc implementations, each with its
own escaping/fallback quirks. `engineering-principles.md`: "the same rule expressed in three
places will drift ... when you write the third copy of a shape, stop and extract." Fix direction:
one `renderTemplate(template: string, values: Record<string,string>): string` in e.g.
`utils/templating.ts`, called by all three sites (each still owns which placeholders are valid and
whether/when `applyFont` is applied).

**Medium — `/clear` and `/cleardm` duplicate the same paginated bulk-delete loop**
Both commands independently implement: fetch a page via `DISCORD_FETCH_PAGE_SIZE`, track
`lastId`, delete what's fetched, `await sleep(...)`/`setTimeout` between deletes, catch and log
per-message failures. Two real occurrences today, and a third similar need would make this
obviously worth extracting sooner rather than later — recommend doing it now since the shapes
already match closely (`data-persistence.md`'s sibling advice on backend re-use: "kill repetitive
endpoints with a helper" applies here to repetitive delete-loops). Fix direction: shared
`bulkDeleteWithPagination(channel, { amount, filter, onProgress })` in a service/util.

**Low — raw `process.env` reads outside the validated config object**
`src/utils/logger.ts:10-11` (`LOG_DIR`, `LOG_LEVEL`) and `src/events/apolloEventWatcher.ts:25`
(`LOG_APOLLO_EMBEDS`) read `process.env` directly rather than through `config/schema.ts`'s
`EnvSchema`/`loadConfig()`. `backend-apis.md`: "read configuration into one typed object at
startup ... never scatter raw environment reads through the codebase." The bot's own doc comments
call these "debug toggles" deliberately kept out of the validated schema, which is a reasonable
judgment call for `LOG_APOLLO_EMBEDS`, but `LOG_DIR`/`LOG_LEVEL` are ordinary operational config
with no reason to bypass the schema — logger.ts also runs its own directory-creation/default logic
that duplicates the shape `config/index.ts` already establishes for everything else. Fix
direction: move `LOG_DIR`/`LOG_LEVEL` into `EnvSchema` and pass them into the logger from
`loadConfig()`'s result; leave `LOG_APOLLO_EMBEDS` as a documented exception if desired, or fold it
in too for consistency.

**Constants/magic-values: mostly exemplary, one gap** — `constants.ts` is genuinely comprehensive
(colors, snowflakes-as-config not literals, every regex, every delay, tier boundaries) and is
consistently imported rather than re-declared; this is the strongest part of the codebase against
this checklist item. The one exception found: `src/db/index.ts` migration bodies interpolate
`DEFAULT_BIRTHDAY_TEMPLATE`/`DAILY_MIDNIGHT_CRON`/etc. directly into SQL template strings (e.g.
line 66, `birthday_cron TEXT NOT NULL DEFAULT '${DAILY_MIDNIGHT_CRON}'`) — safe today only because
those constants are hardcoded literals with no user input in them, but it's a pattern that would be
a SQL-injection footgun if any of those constants were ever sourced from config/env. Low severity
given current constant values, worth a comment or a bound-parameter alternative if this pattern is
copied for a future migration with a less-trusted value.

## Types / casts

**Low — one `SELECT *` in an otherwise disciplined repository layer**
`src/db/sessionsRepository.ts:35`: `db.prepare<[string], SessionRow>("SELECT * FROM web_sessions WHERE id = ?")`.
Every other repository in `src/db/` explicitly lists columns (see `PANEL_COLUMNS`/`MAPPING_COLUMNS`
in `reactionRolesRepository.ts`, `EVENT_COLUMNS`/`SIGNUP_COLUMNS` in `eventAttendanceRepository.ts`,
etc.) and maps through a `rowTo*` function — this file does the mapping too
(`rowToSession`) but pulls `*` first, so the generic type parameter `SessionRow` is an unchecked
assertion over however many columns the table happens to have at read time.
`types-and-contracts.md`: "prefer `SELECT col, col2` over `SELECT *` + cast — the latter breaks
silently when columns change." `db/index.ts`'s own migration history proves this isn't
hypothetical: v14's rebuild-and-swap of `web_sessions` was needed specifically because a
column (`is_owner`) drifted out of sync with what the app actually wrote. Fix direction: spell out
`SELECT id, user_id, username, avatar, role, expires_at FROM web_sessions WHERE id = ?` to match
every other repository file's convention.

**Otherwise**: no `any`, no `@ts-ignore`, no unchecked `!`-assertions on ambiguous data (the `!`
uses seen are all on values the code just confirmed exist, e.g. re-fetching a row it just
inserted), discriminated unions used correctly (`RegistrationStatus`, `ApolloEventStatus`,
`NameResolution`), `const`-object-plus-derived-type pattern followed for most enums-in-spirit
(`AttendanceStatus`, `WebRole`) — though `constants.ts` itself still uses real TS `enum` for
`EmbedColor`/`CommandPermission`/`CommandName`/`SelectionType`/`PanelMessageType` rather than the
`const`-object-plus-derived-type pattern `types-and-contracts.md` recommends. Low-severity/style;
functionally fine since these are internal-only values with no serialization boundary crossed
untyped, but worth converting for consistency with the newer `type X = "a" | "b"` unions
introduced later in `types.ts`.

## Migrations / persistence

Overall this is the strongest area of the codebase. `src/db/index.ts` uses SQLite's `user_version`
pragma as a genuine version table equivalent, applies each migration inside its own transaction
(`db.transaction(() => { MIGRATIONS[v]!(d); db.pragma(...) })()`), is strictly forward-only/additive
(the file's own header comment states the rule and every migration's comment reinforces it — e.g.
v14 rebuilding `web_sessions` rather than editing v8/v4's original definitions), and includes
unusually good "why" documentation for exactly the situations `data-persistence.md` calls out
(v11 explicitly documents and fixes a real data bug from v8 with a new forward migration rather
than editing v8). No evidence of an already-shipped migration being edited in place.

**Medium — no migration checksum verification**
`data-persistence.md`'s migration checklist calls for "a runner that ... records the checksum, and
refuses to start if an already-applied file's checksum changed." This repo has versioning and
transactionality but the `user_version` pragma only tracks *how many* migrations ran, not *whether
migration N's code is still what it was when it ran* — so an accidental edit to `MIGRATIONS[k]` for
`k < currentVersion` would silently never re-run and never be detected, on either a fresh or
upgraded install (fresh installs run every migration in the current file, upgraded ones skip
already-applied indices). Given the discipline already shown in this file this is a low-probability
risk in practice, but it's the one structural gap versus the reference migration checklist. Fix
direction: hash each migration function's source (or keep the SQL in versioned files and hash
those) into a small `schema_migrations` table alongside `user_version`, and refuse to boot if a
lower-numbered migration's hash doesn't match what's recorded.

**Low — no `busy_timeout` pragma set**
`src/db/index.ts:26-27` sets `journal_mode = WAL` and `foreign_keys = ON` but not `busy_timeout`.
`data-persistence.md`: "a `busy_timeout` so a brief lock retries instead of erroring." With
better-sqlite3's synchronous API and a single bot process this is unlikely to bite today (the
dashboard's Fastify server and the bot share the same process/connection), but if the dashboard is
ever split into its own process against the same file, a writer collision would surface as an
immediate `SQLITE_BUSY` error instead of a bounded wait. Cheap to add now: `db.pragma("busy_timeout = 5000")`.

**Low — SQL string-interpolation of trusted constants in migrations** — see the constants-scoped
note above; repeating it here since it's technically a persistence-layer note (`db/index.ts` lines
57, 66, 236, 469, 525).

## discord.js-specifics

**High — see "commands re-register on every boot" above** (repeated here since it's the
`discordjs.md`-specific instance of the SRP finding).

**Medium — intents requested but not obviously all used / cache not bounded**
`src/index.ts:97-108` requests `Guilds`, `GuildMembers`, `GuildMessages`, `MessageContent`,
`GuildMessageReactions`, `GuildVoiceStates`. Every one of these does have a real consumer
somewhere in the codebase (message-content parsing for the birthday/register-form watchers,
reactions for reaction roles, voice states for Apollo attendance) — so this is not a "just in
case" grab, but `MessageContent` and `GuildMembers` are privileged intents needing a Developer
Portal toggle and eventual verification past 100 guilds; worth a short comment (like the one
already present for `GuildVoiceStates`) explaining why each privileged intent is required, so a
future reviewer doesn't have to re-derive it. Separately, `discordjs.md` calls for bounding
`MessageManager`/`PresenceManager` caches via `makeCache` — none is configured here, so the
bot caches every message it ever sees indefinitely (message-heavy channels will grow this
unbounded over the process's lifetime). Fix direction: add a `makeCache` policy capping message
history per channel (the bot only ever needs recent messages for its watchers/bulk-delete
commands, not the full history).

**Low — one wrapper does exist, but permission replies are inlined into it rather than reused elsewhere**
`src/index.ts:46-72`'s `hasCommandPermission()` is a single fail-closed (`default: return true` is
intentional — see `CommandPermission.None`) gate that every command routes through via
`client.commands.get(...)` + `cmd.permission`, and the try/catch around `cmd.execute()` (lines
164-186) is the one shared error wrapper — this matches `discordjs.md`'s "one command wrapper"
recommendation well. Verified no command re-implements its own owner/admin check — every
permission-gated command declares `export const permission = CommandPermission.Admin/Owner` and
lets the central switch handle it; `isOwner()`/`isAdmin()` in `utils/utils.ts` are the sole
primitives, called only from that one switch. No duplication found here — flagged only as
"low" because the switch statement's two reply bodies (embed vs. plain content) are slightly
inconsistent styling for what is semantically the same "access denied" case; cosmetic.

## External integrations

**Low-medium — Apollo event-embed parsing is well-isolated but has no formal port/mock**
`src/services/apolloEventParser.ts` is genuinely exemplary as an adapter/parser boundary: pure,
side-effect-free, narrow `ApolloMessageLike` input type documented specifically so it's testable
without a real discord.js `Message`. This satisfies `external-integrations.md`'s "split I/O from
transformation" almost by the book. What's missing relative to the full checklist: there's no
formal port/interface (`ApolloAdapter`) that a mock could implement side-by-side with production
code, and no contract-test suite verifying the mock and the real parser agree — `LOG_APOLLO_EMBEDS`
functions as an ad-hoc manual-verification tool instead (per its own doc comment, pointed at
`docs/EVENT_ATTENDANCE.md`). Given Apollo has no public API contract to test against (this is
scraping a third party's embed shape empirically), a heavier port abstraction may be genuine
over-engineering here (YAGNI) — flagged as low/medium rather than high for that reason. If the
regex/parsing rules are ever revised again, consider at least a fixture-based unit test suite
(synthetic `ApolloMessageLike` objects covering the documented edge cases already described in the
comments) so future edits don't regress the very edge cases the comments carefully describe.

**Not a finding, noted for completeness**: no other outbound HTTP/webhook integration exists in
this half of the codebase (`src/web/**`'s Discord OAuth calls are out of scope here). The Discord
REST client (`REST` from discord.js) and gateway `Client` are each instantiated once — no
per-interaction client construction found anywhere in `src/`.

## Other

- **Low** — `src/events/memberEvents.ts:150` catches an error as `err` in the outer
  `guildMemberRemove` handler and logs `errorMessage(error)` — fine — but line 147's inner
  `.catch((err) => logger.error(...err.message))` on `owner.send(...)` accesses `.message` on an
  untyped `err` directly rather than through the shared `errorMessage()` helper used everywhere
  else in the codebase; inconsistent with the codebase's otherwise-universal convention and would
  throw if `err` isn't an `Error` (e.g. a plain string/DiscordAPIError shape without `.message`
  behaving unexpectedly under `?.`). Trivial fix: use `errorMessage(err)` like every other catch
  site.
- **Informational** — `src/index.ts`'s dev-mock-Discord branch (`createMockClient`) is a
  reasonable, clearly-labeled escape hatch for building/screenshotting the dashboard without real
  credentials; it's gated behind an explicit env flag with loud warnings and isn't reachable in a
  normal production boot, so it doesn't read as a real "shared mutable client" or seam violation —
  noted only because a reviewer skimming `src/index.ts` should know it's there and why.
- **Informational** — logging is centralized well (winston + daily rotation, `errorMessage()`
  helper used almost everywhere to safely stringify unknown catch values, no secrets/PII observed
  being logged in the reviewed files).

## Suggested priority order

1. Stop re-registering slash commands on every boot (`index.ts` / `commandLoader.ts`).
2. Extract the three template-substitution implementations into one shared renderer.
3. Move `registerWatcher.ts`'s (and the smaller `memberEvents.ts`/`apolloEventWatcher.ts`) business
   logic into proper `services/*.ts` modules, matching the pattern already used everywhere else.
4. Share one bulk-delete-with-pagination helper between `/clear` and `/cleardm`.
5. Fix `sessionsRepository.ts`'s `SELECT *`; add a `busy_timeout` pragma; consider a migration
   checksum table.
6. Fold `LOG_DIR`/`LOG_LEVEL` into the validated config schema.
