# Configuration

The bot is configured with a single `config.json` file, validated at startup against a [zod](https://zod.dev) schema (`src/config/schema.ts`). If the file is missing or invalid, the bot logs a readable error listing every problem and exits — it will not start with a bad config.

## Where `config.json` must live

`config.json` sits **next to whichever code is actually executing**, not at the repository root:

| How you're running the bot | Expected path |
| --- | --- |
| `npm run dev` (tsx, runs `src/`) | `src/config.json` |
| `npm run build` + `npm start` (runs `dist/`) | `dist/config.json` |
| Docker (see [DEPLOYMENT.md](DEPLOYMENT.md)) | mounted to `/app/dist/config.json` |

This mirrors how `src/config/index.ts` resolves the path: one directory up from itself, i.e. the root of whatever's running. It's a deliberate, long-standing convention in this codebase — don't move `config.json` to the repo root and expect it to be picked up.

`config.json` is git-ignored. Never commit real bot tokens or IDs.

## Getting started

Copy the generated template and fill in real values:

```bash
cp src/config_structure.json src/config.json   # for npm run dev
# or
cp src/config_structure.json dist/config.json  # for npm start, after npm run build
```

## Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `token` | `string` | yes | Discord bot token, from the [Discord Developer Portal](https://discord.com/developers/applications) → your application → Bot. |
| `clientId` | `string` | yes | Your application's ID, used to register slash commands. |
| `botOwnerId` | `string` | yes | Discord user ID of the bot owner. Grants `Owner`-permission commands (e.g. `/cleardm`) and counts as an admin everywhere else. |
| `guildId` | `string` | yes | The "main" server's ID. Used both for guild-restricted commands and as the guild the member cache is built from. |
| `birthdayListChannelId` | `string` | yes | Channel ID containing the birthday announcement message(s) that get parsed for birthdays. |
| `birthdayListMessageId` | `string` | yes | The anchor message ID inside that channel — parsing starts here and continues through any of the same author's follow-up messages containing the list marker (`ღ:`). |
| `commands` | `object` | no | Per-command overrides, keyed by command name. See below. |

### `commands` overrides

Each key is a command name (see [COMMANDS.md](COMMANDS.md) for the full list); the value can set:

- `enabled` (`boolean`, default `true`) — set `false` to disable the command entirely (it won't be registered with Discord).
- `guildOnly` (`boolean`, default `true`) — when `true`, the command only works inside the configured `guildId`; when `false`, it also works in DMs/other servers.

Example (from the generated template):

```json
{
  "commands": {
    "refreshbirthdays": { "enabled": true },
    "cleardm": { "enabled": true, "guildOnly": false }
  }
}
```

Note that `guildOnly` and `enabled` only gate *whether/where* a command runs — they do not change *who* can run it. Who can run a command (`None` / `Admin` / `Owner`) is a code-level decision per command (see [ARCHITECTURE.md](ARCHITECTURE.md#permission-model)) and is not configurable via `config.json`.

## Regenerating the template

`src/config_structure.json` is **generated**, not hand-written. It's produced from the same zod schema that validates real configs, so it can never drift out of sync with what the app actually accepts.

```bash
npm run config:template
```

This runs `scripts/generateConfigTemplate.ts`, which reads each field's `.describe()` call in `src/config/schema.ts` as its example value, builds the template object, validates it against the schema itself (so a broken generator fails loudly), and writes `src/config_structure.json`.

If you add or rename a config field, update `src/config/schema.ts` first (including its `.describe()`), then re-run this script — don't hand-edit `config_structure.json`.

## Environment variables

These are optional and only affect logging (see [ARCHITECTURE.md](ARCHITECTURE.md#logging) for details):

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOG_DIR` | `<cwd>/../logs` | Directory log files are written to. |
| `LOG_LEVEL` | `info` | Minimum [winston log level](https://github.com/winstonjs/winston#logging-levels) written to files. |
| `NODE_ENV` | unset | When set to `production`, disables the colorized console transport (file logging is always on). |

There is no `.env` file support — these are read directly from the process environment. In Docker, set them under `environment:` in `docker-compose.yml`.
