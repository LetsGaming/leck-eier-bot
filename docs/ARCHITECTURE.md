# Architecture

## Project layout

```
src/
  index.ts                  Entry point: client setup, cron job, interaction dispatch, startup
  constants.ts               All magic numbers/strings + the CommandPermission/CommandName/EmbedColor enums
  types.ts                   Shared TypeScript types (Command, BotClient, BirthdayEntry, Settings, ...)

  config/
    schema.ts                 zod schema for config.json — the single source of truth for its shape
    index.ts                   Loads + validates config.json, caches the result

  db/
    index.ts                   Opens the SQLite connection, creates tables, seeds default settings
    birthdaysRepository.ts     Birthday CRUD (get by date, get all grouped by date, replace-all)
    settingsRepository.ts      Settings singleton-row CRUD

  services/
    birthdays.ts                Business logic: parsing the announcement message, resolving Discord
                                  members, building/sending birthday messages, cleanup
    memberCache.ts               In-memory Collection<id, GuildMember> cache for /finduser

  loaders/
    commandLoader.ts            Recursively discovers command modules and registers them on the client

  events/
    memberEvents.ts              guildMemberAdd/Update/Remove — cache maintenance + leave notifications
    birthdayWatcher.ts            messageCreate/Update on the birthday channel — triggers a re-scan

  commands/
    birthday/                    checkbirthday, clearbirthdaychannel, refreshbirthdays,
                                   setbirthdaymessage, testbirthdaymessage
    general/                     cleardm, finduser

  utils/
    logger.ts                   winston logger + errorMessage() helper
    embedUtils.ts                 createEmbed/createErrorEmbed/createSuccessEmbed/createNoAdminEmbed
    utils.ts                     isOwner / isAdmin / isConfigGuild

  config_structure.json        Generated config.json template (see CONFIGURATION.md)

scripts/
  generateConfigTemplate.ts    Regenerates src/config_structure.json from config/schema.ts
```

## Startup sequence

All of this happens in `src/index.ts`:

1. `loadConfig()` reads and validates `config.json`. Any failure here logs a readable error and the process never gets further (see [CONFIGURATION.md](CONFIGURATION.md)).
2. A `discord.js` `Client` is constructed with the `Guilds`, `GuildMembers`, `GuildMessages`, and `MessageContent` intents.
3. The nightly cron job and the `interactionCreate` handler are registered (they're inert until the client logs in).
4. Inside an async IIFE, wrapped in try/catch so any startup failure logs cleanly and exits (`process.exit(1)`) instead of crashing with a raw stack trace:
   - `loadCommands()` recursively imports every file under `src/commands/` (or `dist/commands/` when compiled) and registers enabled ones on `client.commands`.
   - Slash commands are registered globally with Discord via the REST API (`PUT /applications/{clientId}/commands`).
   - Event modules (`registerMemberEvents`, `registerBirthdayWatcher`) attach their listeners.
   - A one-time `clientReady` handler populates the member cache for `guildId` and does an initial birthday-list re-scan.
   - `client.login()` connects to the Discord gateway.

## Command loading

`src/loaders/commandLoader.ts` walks `src/commands/` (or `dist/commands/`) recursively, dynamically `import()`-ing every file. It detects at runtime whether it's itself running as `.ts` (via `tsx`, in dev) or `.js` (compiled, in prod) and only picks up files with the matching extension — so command discovery works identically in both modes without extra config.

For each module, it reads `data` (a `SlashCommandBuilder`), `execute`, and `permission`, cross-references `config.commands[name]` for `enabled`/`guildOnly` overrides, and — if enabled — registers a `Command` object on `client.commands`. A command with no `execute` export, or explicitly disabled in config, is skipped with a warning log.

## Permission model

Every command module exports a `permission: CommandPermission` constant (see [COMMANDS.md](COMMANDS.md#permission-levels)) alongside its `data`/`execute`. This is **not** configurable via `config.json` — it's a code-level decision, deliberately separate from the `enabled`/`guildOnly` config overrides.

Enforcement happens once, centrally, in `index.ts`'s `interactionCreate` handler, in this order:

1. If the command isn't found in `client.commands` → generic "not found/disabled" reply.
2. If `cmd.guildOnly` and the interaction isn't in the configured `guildId` → "main server only" reply.
3. `hasCommandPermission()` checks `cmd.permission` against the invoking user (`isOwner`/`isAdmin` from `utils/utils.ts`) → rejection reply with the appropriate embed if it fails.
4. Only then is `cmd.execute(interaction)` called.

This means individual command files never re-implement permission checks — they can assume `execute()` is only reached by an authorized caller in an allowed context.

## Data flow: birthday tracking

1. An admin posts/maintains a birthday list in `birthdayListChannelId`, starting at `birthdayListMessageId`, formatted with the `ღ:` marker (`BIRTHDAY_LIST_MARKER` in `constants.ts`) followed by a `DD.MM` date and a comma-separated list of `@mentions`.
2. `updateBirthdayListFromMessage()` (in `services/birthdays.ts`) fetches the anchor message plus up to `BIRTHDAY_LIST_SCAN_LIMIT` (50) follow-up messages from the same author, concatenates the ones containing the marker, and parses them with `parseBirthdayMessage()`.
3. `resolveParsedBirthdaysWithDiscord()` fetches each mentioned user as a guild member (rate-limited via `MEMBER_FETCH_DELAY_MS`) and fills in their current display name.
4. The result replaces the entire `birthdays` table in one transaction (`replaceAllBirthdays()` — see [DATABASE.md](DATABASE.md)).
5. This re-scan is triggered by: the `/refreshbirthdays` command, the bot's own `clientReady` handler on startup, and automatically whenever a message is created/edited in the birthday channel (`events/birthdayWatcher.ts`).
6. A cron job (`DAILY_MIDNIGHT_CRON`, `0 0 * * *`) runs daily: it first deletes the previous day's announcement messages (`deleteBirthdayMessages()`, walking back to the first message the bot posted), then looks up today's birthdays and posts fresh announcements built from the configured template (`buildBirthdayMessage()`).

## Member cache

`services/memberCache.ts` holds a single in-memory `discord.js` `Collection<userId, GuildMember>`, populated once on `clientReady` via `guild.members.fetch()` and kept up to date by `events/memberEvents.ts` on join/update/leave. It exists purely so `/finduser` can search names without hitting the Discord API per search — it is not persisted and is rebuilt from scratch on every restart.

## Logging

`utils/logger.ts` configures a `winston` logger with:

- Daily-rotating file transports for `error` and `combined` logs (14-day retention, 20MB rotation size — see `LOG_RETENTION_DAYS`/`LOG_MAX_FILE_SIZE` in `constants.ts`).
- Separate `exceptions.log`/`rejections.log` files for anything that would otherwise crash the process silently.
- A colorized console transport, added only when `NODE_ENV !== "production"`.

Because winston's `errors()` format doesn't reliably preserve a custom message when an `Error` is passed as a *second* argument (`logger.error("context:", err)` — the error's own message silently replaces yours), the codebase consistently uses the `errorMessage(err)` helper exported from `logger.ts` to fold the error into the message string itself: `logger.error(\`context: ${errorMessage(err)}\`)`.

Log file location defaults to `<cwd>/../logs` (deliberately one level above the working directory) but is overridable via `LOG_DIR` — see [CONFIGURATION.md](CONFIGURATION.md#environment-variables).

## Type-safety notes

- `BotClient` (`types.ts`) is `discord.js`'s `Client` intersected with `{ commands: Collection<string, Command> }` — the app always works with this type, not the bare `Client`.
- `Config` and `CommandConfig` are inferred from the zod schema (`z.infer<typeof ConfigSchema>`) rather than hand-written interfaces, so the runtime validator and the compile-time type can never drift apart.
- `BirthdayEntry`/`BirthdaysByDate` intentionally do **not** carry a `discordMember` field — earlier revisions persisted a snapshot of the resolved `GuildMember`, but nothing ever read it back, and it doesn't survive a SQLite round-trip meaningfully anyway. Only `mention`/`userId`/`name` are stored.
