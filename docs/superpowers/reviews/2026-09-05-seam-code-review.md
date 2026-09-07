# Seam code review — leck-eier-bot (bot ↔ dashboard boundary)

Date: 2026-09-05
Scope: the boundary between `src/**` (bot, excluding `src/web/**`) and `web/src/**` (dashboard),
mediated by `src/web/**` (Fastify) and `src/db/**` (shared SQLite). Does not re-review either half
in isolation — see the two prior reports this builds on.

## Summary

The seam is unusually disciplined for a project this size: both halves go through the exact same
`src/db/**` repository functions with no bespoke SQL anywhere in `src/web`, `src/events`, or
`src/services` (verified by search), and the dashboard→bot live-update path (`settingsBus`) is a
real, working in-process EventEmitter, not an illusion — every setting write is genuinely live
because no consumer caches `getSettings()` results (the one exception, reaction-role panels, is
correctly cache-invalidated via the same bus). The type duplication the dashboard report already
flagged between `web/src/types.ts` and `src/web/routes/*.ts` is real but, on a field-by-field trace
against the bot-side domain types, has **not yet drifted** — every shape checked matches today. The
two genuine seam-level findings are: (1) `SettingsEvent.Commands` is emitted but has zero listeners
— the bus pattern is inconsistently applied, with the one route that needs live effect
(`commands.ts`) bypassing the bus entirely via a direct `reloadCommands()` call instead; and (2) the
dashboard's RBAC tier hierarchy (`WebRole`) and the bot's command-permission hierarchy
(`CommandPermission`/`isOwner`/`isAdmin`) are two independently-implemented models of the same
"bot-owner > guild-owner > admin" concept, one of which doesn't distinguish guild-owner at all.

---

## 1. Shared contracts across the process/runtime split

Traced every shape the dashboard report listed as duplicated, from `src/db/**`'s repository return
type → `src/web/routes/*.ts` handler → `web/src/types.ts`, field by field:

| Shape | Bot-side source | Route-local interface | Frontend type | Verdict |
|---|---|---|---|---|
| `MemberAuditEntry` | `MemberRecord` (`src/types.ts:155`) + live `GuildMember` fields, assembled in `memberAudit.ts:8-19,52-97` | `memberAudit.ts:8-19` | `web/src/types.ts:198-209` | **Matches exactly**, field for field, same order. |
| `Registration`/`RegistrationEntry` | `MemberRecord` + cache, assembled in `registrations.ts:11-28,36-57` | `registrations.ts:11-28` | `web/src/types.ts:225-242` | **Matches exactly.** |
| `EventMonths`/`EventAttendanceMonthsResponse` | `eventAttendance.ts:51-57` | same file | `web/src/types.ts:341-347` | **Matches exactly.** |
| `EventSignup`/`EventSignupEntry` | `eventAttendance.ts:65-83` | same file | `web/src/types.ts:257-276` | **Matches exactly**, including the two independent-minutes-fields comment reproduced verbatim on both sides. |
| `EventAttendance`/`EventAttendanceEntry` | `eventAttendance.ts:85-97` | same file | `web/src/types.ts:279-292` | **Matches exactly.** |
| `EventAttendanceSummary` | `eventAttendance.ts:99-110` | same file | `web/src/types.ts:316-327` | **Matches exactly.** |
| `EventAttendanceListResponse` | `eventAttendance.ts:112-120` | same file | `web/src/types.ts:330-338` | **Matches exactly.** |
| `CommandDef.permission` | `CommandPermission` — a real TS `enum` with **string values** `"none"/"admin"/"owner"` (`src/constants.ts:167-174`), returned as-is by `listCommandDefinitions()` | n/a (no local interface; `commandLoader.ts`'s `CommandDefinition` is imported straight into the route) | `web/src/types.ts:158`: `permission?: "none" \| "admin" \| "owner"` | **Matches at runtime** (string enum serializes to its value over JSON) but is a type-mechanism mismatch worth flagging: the frontend independently re-derived the literal union instead of the two sides sharing one definition — see the bot report's own note that `CommandPermission` should arguably be a `const`-object-plus-derived-type; if that conversion ever changes the *string values* (not just the TS mechanism) rather than just the enum style, this frontend union silently stops matching with no compiler error on either side. |
| `WebRole` | `src/types.ts:280`: `"bot-owner" \| "guild-owner" \| "admin"` | n/a | `web/src/types.ts:5`: identical literal union, doc comment copied near-verbatim | **Matches exactly** — but is hand-copied, not imported; same drift risk as everything else in this table. |

**Finding (Low-Medium): no field has actually drifted yet, contradicting the risk framing slightly.**
The dashboard report (finding 11) correctly identifies *zero shared import* between the two files
as the structural problem, and that assessment stands — but every shape traced above is, today, an
honest and complete mirror, not a partially-drifted one. This matters for prioritization: the
duplication is real technical debt (the next person to add a field to any of these ~9 shapes must
remember to edit two files by hand, in two different runtimes, with nothing but code review to
catch a miss), but it is not yet an active bug, so it should be sequenced as "fix before the next
schema change to any of these," not as an urgent defect. Suggested fix direction unchanged from the
dashboard report: a shared contracts module (or codegen from the Fastify zod schemas once those
exist per that report's finding 5) is the only way to make this a compiler-enforced invariant
instead of a discipline-enforced one.

**Finding (Low): `GeneralSettings`/`BirthdaySettings`/`Panel`/`Mapping` also mirror correctly.**
Spot-checked `generalSettings.ts`'s `serialize()` (lines 22-38) against `web/src/types.ts`'s
`GeneralSettings` (163-189) and `birthdaySettings.ts`'s `serializeBirthdaySettings()` (24-35)
against `BirthdaySettings` (111-126): both match field-for-field. `ReactionRolePanel`/
`ReactionRoleMapping` (`src/types.ts:92-138`) vs `Panel`/`Mapping` (`web/src/types.ts:48-83`) also
match, including the "Immutable after creation" / "Reactions only" doc-comment fragments being
reproduced near-verbatim on the frontend side — confirms the dashboard report's observation that
this mirroring is done with real care, just without a compiler backstop.

---

## 2. The settings/event bus connecting a dashboard write to live bot behavior

Traced every `settingsBus` emit site (`src/db/settingsRepository.ts:150,192`,
`src/db/reactionRolesRepository.ts:229,263,269,275,281,322,328,334`) against every listener
(`src/index.ts:151`, `src/services/reactionRoles.ts:58-60`) and every dashboard write path that
should have a live effect:

- **`updateSettings()` (birthday cron, birthday template/channel, fontMap, registerGateRoleId,
  registrationTierRoleId, registerChannelId, roleSelectionChannelId, register templates,
  apolloEventChannelId, eventVoiceChannelId — i.e. everything in `Settings`) emits
  `SettingsEvent.Settings` once, unconditionally, from one place.** The only in-process listener is
  `src/index.ts:151`, which reschedules the birthday cron job. Every other field in `Settings` has
  **no listener at all** — but this is correct, not a gap: confirmed by grep
  (`getSettings()` call sites) that every consumer (`registerWatcher.ts`, `memberEvents.ts`,
  `apolloEventWatcher.ts`, `birthdays.ts`, `reactionRoles.ts`, `eventAttendance.ts`) calls
  `getSettings()` fresh on each use rather than caching it at startup or on a timer. So a dashboard
  PATCH to, say, `fontMap` or `registerGateRoleId` takes effect on the very next event the bot
  processes, with zero code needed to "wire it up" — the absence of a listener is the same thing as
  correctness here, not neglect, precisely because there's no cache to invalidate. This is the
  single strongest piece of design in the whole seam and should be called out as a positive, not
  just an absence of findings.

- **`setCommandOverride()` emits `SettingsEvent.Commands` — but nothing listens for it.**
  (`src/db/settingsRepository.ts:192`; confirmed via grep, zero `.on(SettingsEvent.Commands` sites
  anywhere in `src/`.) The dashboard's `commands.ts:31` PATCH route achieves its live effect a
  completely different way: it calls `reloadCommands(client, config)` directly, in-line, right
  after `setCommandOverride()`. Both approaches work today (the direct call does reload), but this
  means the codebase has **two different mechanisms for "make a dashboard write live"** — an event
  bus for settings/reaction-roles, and a direct synchronous call for commands — with the bus's
  `Commands` event serving no purpose except to look like it's part of the same pattern. **Medium
  finding**: either wire `reloadCommands()` as a listener on `SettingsEvent.Commands` (making the
  route itself thinner and consistent with how `birthdaySettings.ts`/reaction-role routes rely on
  the bus) or delete the dead `SettingsEvent.Commands` emit/enum member — as written it's
  unreachable dead code that will mislead the next person who greps for "what listens to command
  changes" and finds nothing.

- **Reaction-role panel/mapping writes (`reactionRolePanels.ts`, all 8 mutating routes) correctly
  use the bus for cache invalidation** (`reactionRolesRepository.ts` emits `SettingsEvent.
  ReactionRoles` on every write; `services/reactionRoles.ts:58-60` invalidates `panelCache`) **and
  additionally call `syncPanelMessage()`/`trySync()` directly** for the Discord-message side-effect
  (posting/editing the actual message). This is a reasonable split — the bus handles the passive
  "forget your cache" reaction that any future consumer could also subscribe to, while the route
  handles the active "do this Discord I/O now and report success/failure back over HTTP" side,
  which a fire-and-forget event couldn't do (the route needs to know if the Discord write failed to
  set the `x-sync-warning` header). Not a finding — flagged as the correctly-reasoned exception to
  "why doesn't this go through the bus too."

- **One dashboard write relies on an out-of-band Discord gateway event instead of any bus or direct
  call: `registrations.ts:95-118`'s `/members/registrations/:userId/approve` route only calls
  `member.roles.add(registrationTierRoleId, ...)` and returns.** The DB-side completion
  (`completeRegistration()`, deleting the private thread, flipping `registerStatus` to
  `"registered"`) happens only if/when Discord's `guildMemberUpdate` gateway event fires and
  `memberEvents.ts:43-63`'s `stripRegisterGateRoleIfJustRegistered()` observes the role actually
  landing on `newMember.roles.cache`. This is honestly commented (lines 89-94 explain the
  indirection) and works in the overwhelmingly common case, but it is a third, weaker "live update"
  mechanism than either of the two above: it depends on the Discord gateway delivering and the bot
  processing an event the route itself never confirms happened. **Low-Medium finding**: if
  `member.roles.add()` succeeds but the gateway event is delayed, deduplicated by discord.js's
  cache, or missed during a brief reconnect, the dashboard returns `204` while the DB still shows
  `"pending"` and the thread still open — a state the admin has no way to detect from the response.
  Contrast with `birthdaySettings.ts`/`reactionRolePanels.ts`, which always resolve the live side of
  a write synchronously (or report its failure) before responding. Fix direction: either have the
  approve route call `completeRegistration()` itself right after a successful `roles.add()` (making
  the event-handler path just the fallback for staff doing it manually in Discord, which is exactly
  the reverse of today's "DB update only happens via the event" setup and matches how every other
  write in this table behaves), or at minimum log/monitor for a `registerStatus` that stays
  `"pending"` unexpectedly long after an approve call.

---

## 3. Repository layer as the single source of truth

Verified by grepping for `db.prepare`/`db.exec` outside `src/db/**`: **zero matches** in
`src/web/**`, `src/events/**`, or `src/services/**`. Every read/write on both sides of the seam goes
through the same typed repository functions:

- `settingsRepository.ts`: `getSettings()`/`updateSettings()` called from both
  `src/web/routes/{generalSettings,birthdaySettings}.ts` and bot-side `registerWatcher.ts`,
  `memberEvents.ts`, `apolloEventWatcher.ts`, `birthdays.ts`, `reactionRoles.ts`,
  `eventAttendance.ts`, `commands/birthday/clearBirthdayChannel.ts`. No parallel path found.
- `memberRecordsRepository.ts`: `listAllMemberRecords()`/`countPendingRegistrations()`/
  `listRegistrations()` (dashboard: `memberAudit.ts`, `status.ts`, `registrations.ts`) vs.
  `recordLeave()`/`recordRulesAccepted()`/`updateProfile()`/`upsertJoin()` (bot:
  `services/memberRecords.ts`) and the registration lifecycle functions (bot:
  `registerWatcher.ts`) — disjoint read/write responsibility, same repository, no duplication.
- `birthdaysRepository.ts`: dashboard's `birthdays.ts` route (`insertBirthday`,
  `updateBirthdayEntry`, `deleteBirthday`, `getAllBirthdaysByDate`) and bot's `birthdayWatcher.ts`/
  `setMyBirthday.ts` (`upsertSelfBirthday`) and `services/birthdays.ts`
  (`getAllBirthdaysByDate`, `getBirthdaysForDate`, `deleteBirthdaysForUser`) — same file, disjoint
  functions, no duplication.
- `reactionRolesRepository.ts`: exclusively used by `src/web/routes/reactionRolePanels.ts` and
  `src/services/reactionRoles.ts` — both correctly go through it; confirmed no direct SQL in
  either.
- `eventAttendanceRepository.ts`: dashboard's `eventAttendance.ts` route and bot's
  `apolloEventWatcher.ts`/`services/eventAttendance.ts` both go through it exclusively.

**No finding here** — this is the cleanest area of the whole seam and confirms both prior reports'
independent observation that the repository layer is a genuine strength; from the seam angle, it's
also confirmed to be a *shared* strength rather than two separately-disciplined-but-diverging
halves.

---

## 4. Permission/tier duplication (`WebRole` vs `CommandPermission`)

Confirmed the suspicion: **two independently-implemented hierarchies over the same real-world
concept** ("is this Discord user the bot owner / the guild owner / merely an admin"), living in
`src/web/auth.ts:73-85` (`resolveDashboardRole`) and `src/utils/utils.ts:7-25`
(`isOwner`/`isAdmin`):

- `resolveDashboardRole()` checks, in order: `userId === config.botOwnerId` → `"bot-owner"`;
  `guild.ownerId === userId` → `"guild-owner"`; Administrator permission (directly or via
  `@everyone`) → `"admin"`; else `null`. Three distinct tiers.
- `isOwner()`/`isAdmin()` check only: `interaction.user.id === botOwnerId`, and separately
  `ownerCheck || interaction.memberPermissions?.has(Administrator)`. Two tiers — **guild-owner is
  not modeled as its own concept anywhere in the command-permission path.**

**Does this create an actual behavioral inconsistency?** Checked whether a guild owner could be
denied something an admin is allowed, or vice versa, purely from this divergence: **no live bug
found**, because Discord's own permission model already grants a guild's owner every permission
including Administrator by default (owner status implies full effective permissions unless a very
unusual guild-level override exists, which isn't configurable through role assignment) — so
`interaction.memberPermissions?.has(Administrator)` is true for a guild owner in essentially every
real deployment, meaning `isAdmin()` already includes guild-owners as a side effect of Discord's own
permission computation, not because the bot's code models the tier. This is fragile rather than
broken: the bot-side permission check's correctness for guild-owners is an accident of Discord's
default permission semantics, not a design guarantee, whereas the dashboard's version is explicit.
If a future command ever needs "owner-or-guild-owner but not plain admin" (a tier the dashboard
already anticipates — see `WebRole`'s doc comment: "the tiers exist so a route can be narrowed...
later"), the bot side has no equivalent primitive to reach for; someone would have to invent a
second, bot-side notion of guild-owner from scratch, likely diverging from `resolveDashboardRole()`'s
definition (e.g. forgetting the `@everyone`-has-Administrator case that `resolveDashboardRole`
explicitly handles at line 80).

**Medium finding, seam-level DRY violation.** Two independently-maintained encodings of "who's in
charge here" is exactly the kind of boundary duplication `engineering-principles.md` calls costliest
— not because it's broken today, but because the day someone needs a third tier on either side,
they'll either duplicate the other side's logic error-for-error or (more likely) write something
subtly different. Fix direction: extract one `resolveDiscordTier(client, guildId, botOwnerId,
userId, permissions | roleIds): "bot-owner" | "guild-owner" | "admin" | "none"` in a shared location
both `auth.ts` and `utils.ts` can call — `utils.ts`'s `isOwner`/`isAdmin` become thin wrappers
(`tier === "bot-owner"` / `tier !== "none"`) over the same primitive `auth.ts` already implements
correctly (including the `@everyone`-Administrator edge case `utils.ts` happens to get right today
only via discord.js's own permission resolution, not explicit code).

---

## 5. Consistency check between the two prior reports

- **No direct contradictions found** between the two reports — they don't make opposite claims
  about the same file or behavior anywhere I could find.
- **A real gap at the boundary line, missed by both**: the bot report explicitly scoped out
  `src/web/**` and the dashboard report explicitly scoped out `src/db/index.ts`'s migration
  mechanics (dashboard report, "Other" section, item 23, which even says "flagging only so the
  bot-side reviewer correlates it" — but the bot report's migrations section never addresses
  `birthdaySettings.ts`/`generalSettings.ts` adding fields without a migration, because it wasn't
  asked to look at `src/web/**` at all). **This handoff never actually completed**: neither report
  states, and this review now confirms, whether `Settings`/`GeneralSettings`/`BirthdaySettings`'s
  fields are 1:1 with actual DB columns added via a real migration each time. Spot check:
  `settingsRepository.ts`'s `SettingsRow`/`rowToSettings()` (lines 5-55) list 21 columns that do
  correspond to `Settings` in `src/types.ts` 1:1, and `src/db/index.ts`'s migration history (per the
  bot report) is confirmed additive/forward-only — so this particular worry resolves cleanly, but
  only because this review chased it down explicitly; it's worth noting as a scoping lesson (each
  report's "out of scope, flag for the other" note pointed at a file the other report's stated scope
  also excluded, and neither the dashboard nor bot report actually closed the loop).
- **The dashboard report's finding 17** ("confirm `devMockDiscord` can't independently be true when
  `NODE_ENV=production`... this route's safety is entirely inherited from that guarantee") is
  exactly the kind of seam question this review was meant to chase down, but `config/schema.ts`/
  `config/index.ts` were not read in enough depth in this pass to independently confirm or refute
  it — flagged here as **still open** rather than resolved, since asserting it either way without
  reading that file would be exactly the kind of unverified cross-report assumption this review is
  supposed to catch.
- **Both reports independently praised the repository layer** (bot report's "Migrations /
  persistence" section, dashboard report's summary: "a clean repository boundary (routes never
  touch SQL directly)"). Section 3 above confirms this holds up seam-wide, not just within each
  half — a genuine point of agreement rather than mere overlap.
- **Both reports separately noted the type-duplication problem from their own side** (bot report
  does not mention it at all, since `web/src/types.ts` was out of its scope; dashboard report's
  finding 11 covers the frontend-vs-route-file half). Neither traced it all the way back to the
  bot-side domain type in `src/types.ts` — that three-way trace (repository type → route interface
  → frontend interface) is the part only this review's vantage point could do, and section 1 above
  is the result.

---

## Findings ranked by severity/impact

1. **(Medium) `SettingsEvent.Commands` is emitted but has no listener — dead/inconsistent use of
   the event-bus pattern** (`src/db/settingsRepository.ts:192`; `src/index.ts`, `src/services/
   reactionRoles.ts` — confirmed no listener exists). The commands route's live-update behavior
   works, but through a different, undocumented-as-different mechanism (`commands.ts:31`'s direct
   `reloadCommands()` call) than the pattern the codebase otherwise establishes. Fix: wire a
   listener, or remove the dead emit/enum member.
2. **(Medium) `WebRole` and `CommandPermission`/`isOwner`/`isAdmin` are two independently
   implemented tier hierarchies over the same concept** (`src/web/auth.ts:73-85` vs
   `src/utils/utils.ts:7-25`), with the bot side not modeling guild-owner at all — correct today
   only because Discord's own permission semantics happen to make a guild owner pass the
   Administrator check. Fix: extract one shared tier-resolution primitive.
3. **(Low-Medium) The dashboard's registration-approve route depends on an unconfirmed async
   Discord gateway event to complete a DB write** (`src/web/routes/registrations.ts:95-118` →
   `src/events/memberEvents.ts:43-63`), unlike every other cross-boundary write in this codebase,
   which resolves or reports failure synchronously within the HTTP request. Fix: call
   `completeRegistration()` directly from the approve route after a successful role grant.
4. **(Low) ~9 shared shapes between `src/types.ts`/`src/db/**` and `web/src/types.ts` (via
   `src/web/routes/*.ts`) are duplicated with zero shared import, confirming and extending the
   dashboard report's finding 11** — but every one traced here matches exactly today, so this is
   debt to pay down opportunistically (ideally alongside the dashboard report's recommended
   zod/type-provider adoption) rather than an active defect.
5. **(Informational/positive) The settings-live-update mechanism for the ~20-field `Settings`
   object requires no bus subscription at all and is correct by construction**, since no consumer
   caches `getSettings()`. Worth documenting explicitly somewhere (e.g. a comment on `settingsBus.ts`
   or `Settings` itself) so a future contributor doesn't assume a missing listener is a missing
   feature and add unnecessary caching that would silently break this property.
6. **(Informational) Repository-layer sharing between the two halves is complete and correct** for
   every domain checked (settings, member records, birthdays, reaction roles, event attendance) —
   no bespoke query path found on either side.
7. **(Informational) One prior-report handoff gap closed, one left open**: this review confirms the
   `Settings`-object-to-DB-column mapping the dashboard report flagged as unverified is fine; it
   could not independently verify the dashboard report's `devMockDiscord`/`NODE_ENV` production-
   safety assumption (finding 17) within this review's scope.
