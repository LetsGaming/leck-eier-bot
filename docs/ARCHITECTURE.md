# Architecture

## Project layout

```
src/
  index.ts                  Entry point: client setup, cron job, interaction dispatch, startup
  constants.ts               All magic numbers/strings + the CommandPermission/CommandName/EmbedColor/
                               SelectionType/PanelMessageType enums
  types.ts                   Shared TypeScript types (Command, BotClient, BirthdayEntry, Settings,
                               ReactionRolePanel/Mapping, WebSession, ...)

  config/
    schema.ts                 zod schema for the .env-backed environment — the single source of truth
                                for its shape (EnvSchema, the raw process.env shape) and the Config type
                                the rest of the app actually consumes
    index.ts                   Loads .env (via dotenv) + validates it, caches the result

  db/
    index.ts                   Opens the SQLite connection, runs migrations (PRAGMA user_version)
    birthdaysRepository.ts     Birthday CRUD (get by date, get all grouped by date, replace-all)
    settingsRepository.ts      Settings singleton-row CRUD, command_settings CRUD
    reactionRolesRepository.ts  Reaction-role panel/mapping CRUD
    sessionsRepository.ts       Dashboard login session CRUD

  services/
    birthdays.ts                Business logic: parsing the announcement message, resolving Discord
                                  members, building/sending birthday messages, cleanup
    memberCache.ts               In-memory Collection<id, GuildMember> cache for /finduser
    memberRecords.ts             Records join/rules-acceptance/leave events to member_records (dashboard's Member Audit page)
    reactionRoles.ts             Reaction-role event handling, panel cache, posting/syncing panels
    settingsBus.ts               EventEmitter that decouples DB writes from their live-reconfiguration
                                   effects (cron rescheduling, command reload, panel cache invalidation)
    memberSearch.ts               Name normalization/matching against the live member cache — used by
                                   /finduser and Apollo event-signup name resolution
    apolloEventParser.ts          Pure parser: Apollo RSVP embed -> title/start/end/signups (see EVENT_ATTENDANCE.md)
    eventAttendance.ts            deriveAttendance() + the scheduled/active/completed sweep + startup catch-up

  loaders/
    commandLoader.ts            Recursively discovers command modules and registers them on the client

  events/
    memberEvents.ts              guildMemberAdd/Update/Remove — cache maintenance + leave notifications + member_records tracking
    birthdayWatcher.ts            messageCreate/Update on the birthday channel — triggers a re-scan
    reactionRoleEvents.ts         messageReactionAdd/Remove — delegates to services/reactionRoles.ts
    apolloEventWatcher.ts         messageCreate/Update/Delete on the Apollo channel + voiceStateUpdate —
                                   parses events, tracks attendance (see EVENT_ATTENDANCE.md)

  commands/
    birthday/                    checkbirthday, clearbirthdaychannel,
                                   setbirthdaymessage, testbirthdaymessage, setmybirthday
    general/                     cleardm, finduser
    roles/                       reactionroles (list/sync — full editing is on the dashboard)

  web/                        Dashboard backend (Fastify) — see DASHBOARD.md
    server.ts                   Bootstraps Fastify, static file serving + SPA fallback
    auth.ts                     Discord OAuth2 login/callback/logout, GET /api/me
    session.ts                   Cookie helpers, requireRole()/requireAdmin preHandlers (dashboard RBAC — see DASHBOARD.md)
    routes/                      One file per API resource; all delegate to db/services, no logic of
                                   their own

  utils/
    logger.ts                   winston logger + errorMessage() helper
    embedUtils.ts                 createEmbed/createErrorEmbed/createSuccessEmbed/createNoAdminEmbed
    utils.ts                     isOwner / isAdmin / isConfigGuild

scripts/
  generateEnvExample.ts        Regenerates .env.example from config/schema.ts

.env.example                  Generated .env template (see CONFIGURATION.md)

web/                          Dashboard frontend — separate package.json, Vite + React + TypeScript.
                                Built output (web/dist) is served as static files by src/web/server.ts.
                                See DEVELOPMENT.md#dashboard-frontend.
```

## Startup sequence

All of this happens in `src/index.ts`:

1. `loadConfig()` loads `.env` (via `dotenv`) and validates the resulting environment. Any failure here logs a readable error and the process never gets further (see [CONFIGURATION.md](CONFIGURATION.md)).
2. A `discord.js` `Client` is constructed with the `Guilds`, `GuildMembers`, `GuildMessages`, `MessageContent`, and `GuildMessageReactions` intents, plus `Message`/`Channel`/`Reaction`/`User` partials (needed so reactions on messages older than the bot's cache still fire events — see [REACTION_ROLES.md](REACTION_ROLES.md#requirements)).
3. The nightly cron job (rescheduled live from the DB-backed `birthdayCron` setting — see [Live reconfiguration](#live-reconfiguration) below) and the `interactionCreate` handler are registered (they're inert until the client logs in).
4. Inside an async IIFE, wrapped in try/catch so any startup failure logs cleanly and exits (`process.exit(1)`) instead of crashing with a raw stack trace:
   - `loadCommands()` recursively imports every file under `src/commands/` (or `dist/commands/` when compiled) and registers enabled ones (per `command_settings` in the DB) on `client.commands`.
   - Slash commands are registered globally with Discord via the REST API (`PUT /applications/{clientId}/commands`).
   - Event modules (`registerMemberEvents`, `registerBirthdayWatcher`, `registerReactionRoleEvents`) attach their listeners.
   - A one-time `clientReady` handler populates the member cache for `guildId`, does an initial anchor-message sync (`syncAnchorMessage()`), re-syncs every reaction-role panel (`syncAllPanels()`), and — once the guild is cached — starts the dashboard (`startWebServer()`, a no-op if `config.web` isn't set).
   - `client.login()` connects to the Discord gateway.

## Live reconfiguration

Everything an admin might want to change while the bot is running (birthday channel/template/cron, per-command overrides, reaction-role panels) lives in SQLite, not env vars, and takes effect immediately, from either a slash command or the [dashboard](DASHBOARD.md) — no restart, no redeploy. This works through one small `EventEmitter`, `settingsBus` (`src/services/settingsBus.ts`), which repository write functions emit on after persisting:

| Event | Emitted by | Consumed by |
| --- | --- | --- |
| `SettingsEvent.Settings` | `settingsRepository.updateSettings()` | `src/index.ts` — re-`cron.schedule()`s the daily birthday job if `birthdayCron` changed |
| `SettingsEvent.Commands` | `settingsRepository.setCommandOverride()` | Nothing subscribes directly — the dashboard's Commands page instead calls `reloadCommands()` (re-walks `src/commands/`, re-`PUT`s Discord) right after writing, since a command toggle needs an explicit re-registration anyway |
| `SettingsEvent.ReactionRoles` | Every write in `reactionRolesRepository.ts` | `services/reactionRoles.ts` — invalidates its in-memory panel cache so the next reaction lookup re-reads from the DB |

This keeps the DB layer (`src/db/*Repository.ts`) free of imports from `src/index.ts` or `src/web/` — it only ever emits an event, never calls back into a specific consumer.

## Command loading

`src/loaders/commandLoader.ts` walks `src/commands/` (or `dist/commands/`) recursively, dynamically `import()`-ing every file. It detects at runtime whether it's itself running as `.ts` (via `tsx`, in dev) or `.js` (compiled, in prod) and only picks up files with the matching extension — so command discovery works identically in both modes without extra config.

For each module, it reads `data` (a `SlashCommandBuilder`), `execute`, and `permission`, cross-references `getCommandOverride(name)` (`command_settings` table, defaulting to `{enabled: true, guildOnly: true}` for a command that's never been overridden) for `enabled`/`guildOnly`, and — if enabled — registers a `Command` object on `client.commands`. A command with no `execute` export, or disabled via the DB, is skipped with a warning log.

`loadCommands()` is also called by `reloadCommands()`, which additionally re-`PUT`s the command list with Discord — this is what makes toggling a command from the dashboard's Commands page take effect without a restart. A separate `listCommandDefinitions()` walks the same files but returns every command's metadata regardless of enabled state, so the dashboard can show (and re-enable) commands that are currently disabled.

## Permission model

Every command module exports a `permission: CommandPermission` constant (see [COMMANDS.md](COMMANDS.md#permission-levels)) alongside its `data`/`execute`. This is **not** configurable at runtime — it's a code-level decision, deliberately separate from the `enabled`/`guildOnly` overrides set from the dashboard.

Enforcement happens once, centrally, in `index.ts`'s `interactionCreate` handler, in this order:

1. If the command isn't found in `client.commands` → generic "not found/disabled" reply.
2. If `cmd.guildOnly` and the interaction isn't in the configured `guildId` → "main server only" reply.
3. `hasCommandPermission()` checks `cmd.permission` against the invoking user (`isOwner`/`isAdmin` from `utils/utils.ts`) → rejection reply with the appropriate embed if it fails.
4. Only then is `cmd.execute(interaction)` called.

This means individual command files never re-implement permission checks — they can assume `execute()` is only reached by an authorized caller in an allowed context.

## Data flow: birthday tracking

Birthdays get into the `birthdays` table one of two ways — there's no bulk-import/message-parsing path:

1. **Admin-managed** (`source = 'list'`): added, edited, or removed one at a time from the dashboard's Birthdays page (`web/routes/birthdays.ts` → `db/birthdaysRepository.ts`'s `insertBirthday`/`updateBirthdayEntry`/`deleteBirthday`).
2. **Self-registration** (`source = 'self'`): `/setmybirthday`, or posting a bare `DD.MM`-shaped date in the configured `birthdayListChannelId` (auto-detected and deleted by `events/birthdayWatcher.ts`, parsed by `parseSelfRegistrationDate()`). Upserted by Discord user id (`upsertSelfBirthday()`), so re-registering just updates the existing row.

Either path calls `syncAnchorMessage()` (`services/birthdays.ts`) afterward to keep the bot-managed anchor message current:

3. `buildAnchorParts()` groups the current `birthdays` table by month into independently-keyed parts (plus the configured intro note, if any).
4. `paginateAnchorParts()` packs those parts into as few ≤2000-character chunks as Discord's `content` cap allows — a month is only ever split across chunks if it alone exceeds the cap — biased by the *previous* sync's month→chunk assignment (persisted per chunk in `birthday_anchor_messages.months`) so a month stays pinned to the same message across syncs instead of reflowing whenever an unrelated month's entry count changes.
5. Each chunk is edited in place if its message from the last sync still exists, appended as a new message if the chain grew, or (for a chunk beyond the new count) deleted if the chain shrank; `closeAnchorChainGaps()` then removes anything that landed between chunks since the last sync (e.g. a daily announcement), so the chain reads as one contiguous block.
6. `syncAnchorMessage()` runs once at startup (`clientReady`), after every self-registration, and after any dashboard settings/entry change.
7. A cron job (`DAILY_MIDNIGHT_CRON`, `0 0 * * *`) runs daily: it first deletes the previous day's announcement messages (`deleteBirthdayMessages()`, walking back to the first message the bot posted, skipping every message currently in the anchor chain), then looks up today's birthdays and posts fresh announcements built from the configured template (`buildBirthdayMessage()`).
8. `removeBirthdayOnMemberLeave()` runs unconditionally from `guildMemberRemove` (`events/memberEvents.ts`) — voluntary leave, kick, or ban all look the same here — deleting that user's row from `birthdays` (list or self-registered, doesn't matter) and re-syncing the anchor message if anything was actually removed. Otherwise a departed member's entry would linger in both the DB and the rendered message indefinitely.

## Data flow: reaction roles

See [REACTION_ROLES.md](REACTION_ROLES.md) for the feature-level explanation (selection types, allow-multiple/removable, `removeReaction` semantics, the draft-then-send workflow, requirements). Architecturally:

1. A panel and its mappings are created/edited via the dashboard's API (`src/web/routes/reactionRolePanels.ts`) or, read-only, via `/reactionroles list`.
2. Every panel write auto-resyncs via `syncPanelMessage()` (`services/reactionRoles.ts`) — but only once the panel is `sent`; a draft only ever touches the database. The explicit `POST .../send` route performs the first sync and flips `sent`.
3. `events/reactionRoleEvents.ts` wires `messageReactionAdd`/`Remove`, plus a second `interactionCreate` listener (alongside the slash-command dispatcher in `index.ts`) for button clicks and dropdown submissions whose `customId` is prefixed `rr:`. All resolve any partial reaction/message/user first, look the message up in an in-memory panel cache (invalidated via `settingsBus`, see above), and apply the allow-multiple/removable grant/revoke logic described in REACTION_ROLES.md — reactions and buttons share `applyMappingSelection()`; dropdowns, which submit a complete new selection each time rather than one option at a time, use the separate `applyDropdownSelection()`.
4. A short-lived self-echo suppression map (reactions only) and a per-user promise-chain (also in `services/reactionRoles.ts`) keep bot-initiated reaction removals and rapid repeated clicks/reactions from double-processing.

## Dashboard

See [DASHBOARD.md](DASHBOARD.md) for setup and usage. In short: `src/web/server.ts` runs a Fastify server (started from `clientReady`, once the guild is cached) that serves the `web/` React app's static build and a `/api/*` surface gated by Discord OAuth2 (`src/web/auth.ts`, `src/web/session.ts`). The API routes (`src/web/routes/*.ts`) are intentionally thin — they validate input with `zod` and call the exact same repository/service functions the slash commands and cron job use, so there's a single source of truth for business logic regardless of which surface triggered it.

## Member cache

`services/memberCache.ts` holds a single in-memory `discord.js` `Collection<userId, GuildMember>`, populated once on `clientReady` via `guild.members.fetch()` and kept up to date by `events/memberEvents.ts` on join/update/leave. It exists purely so `/finduser` (and the dashboard's Member Audit page, for current members) can search names without hitting the Discord API per search — it is not persisted and is rebuilt from scratch on every restart.

`services/memberRecords.ts` is the persisted counterpart, one row per user ever seen (`member_records` — see [DATABASE.md](DATABASE.md#member_records)) rather than just currently-cached ones. The same `events/memberEvents.ts` handlers that maintain the in-memory cache also call into it, recording each join/rules-acceptance/leave the moment it happens — that's the only way to know it at all, since Discord doesn't retain a former member's history or a rules-acceptance timestamp for the bot to read back later.

## Logging

`utils/logger.ts` configures a `winston` logger with:

- Daily-rotating file transports for `error` and `combined` logs (14-day retention, 20MB rotation size — see `LOG_RETENTION_DAYS`/`LOG_MAX_FILE_SIZE` in `constants.ts`).
- Separate daily-rotating `exceptions-*.log`/`rejections-*.log` files, same retention/size limits, for anything that would otherwise crash the process silently.
- A colorized console transport, always on, so `docker compose logs` shows the same output as the log files.

All transports share one human-readable line format (`timestamp | [level]: message`) instead of raw JSON.

Because winston's `errors()` format doesn't reliably preserve a custom message when an `Error` is passed as a *second* argument (`logger.error("context:", err)` — the error's own message silently replaces yours), the codebase consistently uses the `errorMessage(err)` helper exported from `logger.ts` to fold the error into the message string itself: `logger.error(\`context: ${errorMessage(err)}\`)`.

Log file location defaults to `<cwd>/../logs` (deliberately one level above the working directory) but is overridable via `LOG_DIR` — see [CONFIGURATION.md](CONFIGURATION.md#environment-variables).

## Type-safety notes

- `BotClient` (`types.ts`) is `discord.js`'s `Client` intersected with `{ commands: Collection<string, Command> }` — the app always works with this type, not the bare `Client`.
- `EnvSchema` (`src/config/schema.ts`) is the zod-validated raw `process.env` shape — every field flat and optional, matching what environment variables actually look like. `Config`, the type the rest of the app imports and uses, is a hand-written, fully-typed interface that `loadConfig()` builds *from* the validated `Env`, applying the cross-field logic described in [Startup sequence](#startup-sequence) (e.g. "the dashboard's `web` object only exists if all three of its required vars are present"). Keep that split — don't let `Config` drift back into being a 1:1 mirror of `Env`, or callers lose the guarantee that `config.web` (when present) is fully usable.
- `BirthdayEntry`/`BirthdaysByDate` intentionally do **not** carry a `discordMember` field — earlier revisions persisted a snapshot of the resolved `GuildMember`, but nothing ever read it back, and it doesn't survive a SQLite round-trip meaningfully anyway. Only `mention`/`userId`/`name` are stored.
