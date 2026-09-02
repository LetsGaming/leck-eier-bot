# Configuration

The bot is configured entirely through environment variables — a `.env` file for local/bare-metal use, or real env vars (Docker's `environment:`/`env_file:`, systemd's `Environment=`, etc.) in deployment. They're validated at startup against a [zod](https://zod.dev) schema (`src/config/schema.ts`); if anything required is missing or invalid, the bot logs a readable error listing every problem and exits — it will not start with a bad config.

Env vars are deliberately **bootstrap-only**: secrets and values needed before the bot (or the dashboard's HTTP server) can even start. Everything an admin might want to change while the bot is running — the birthday template/channel/schedule, per-command enable/guildOnly overrides, reaction-role panels — lives in the SQLite `settings`/`command_settings`/`reaction_role_*` tables instead, editable live from the [dashboard](DASHBOARD.md) with no restart, no redeploy, and no env var to remember. See [DATABASE.md](DATABASE.md) for the full schema.

## Getting started

```bash
cp .env.example .env   # then fill in real values
```

`.env` lives at the **repository root** and is loaded via [`dotenv`](https://github.com/motdotla/dotenv) from the process's current working directory — which is the project root for `npm run dev`, `npm start`, and the Docker image alike, so this is the one place it goes regardless of how you run the bot (no more `src/` vs `dist/` path juggling). `dotenv` never overrides a variable that's already set in the real environment, so in Docker/systemd you can skip `.env` entirely and just set real env vars instead.

`.env` is git-ignored. Never commit real bot tokens or secrets.

## Required variables

| Variable | Description |
| --- | --- |
| `DISCORD_TOKEN` | Discord bot token, from the [Discord Developer Portal](https://discord.com/developers/applications) → your application → Bot. |
| `DISCORD_CLIENT_ID` | Your application's ID, used to register slash commands and for the dashboard's OAuth2 flow. |
| `DISCORD_BOT_OWNER_ID` | Discord user ID of the bot owner. Grants `Owner`-permission commands (e.g. `/cleardm`) and full dashboard access, and counts as an admin everywhere else. |
| `DISCORD_GUILD_ID` | The "main" server's ID. Used both for guild-restricted commands and as the guild the member cache/dashboard are built from. |

## Timezone (optional)

| Variable | Required | Description |
| --- | --- | --- |
| `TIMEZONE` | no, default `Europe/Berlin` | IANA timezone name (e.g. `America/New_York`). Every user-facing date/time — dashboard timestamps, Discord replies that show a date, and what counts as "today" for birthday matching — uses this instead of the server's default (commonly UTC in a Docker container). Data is still always **stored** in UTC; this only affects display and "what day is it" logic. Validated at startup (`Intl.DateTimeFormat`) — an unrecognized name fails fast with a clear error instead of silently falling back somewhere deep in a formatter. |

## Dashboard variables (optional)

The [dashboard](DASHBOARD.md) starts automatically once every variable below is set. Leave them all unset, or set `WEB_ENABLED=false`, to run without it — the rest of the bot is unaffected either way.

| Variable | Required | Description |
| --- | --- | --- |
| `WEB_ENABLED` | no, default `true` | Set `false` to force the dashboard off even if the other variables below are present. |
| `WEB_PORT` | no, default `3000` | Port the dashboard listens on inside the process/container. One port for every domain in `WEB_PUBLIC_URLS` — a reverse proxy (or your router, for a plain LAN name) is what maps each domain to it. |
| `WEB_PUBLIC_URLS` | yes, to enable the dashboard | One or more externally-reachable origins, **comma-separated**, e.g. `http://eier.lan.net:3000,https://bot.example.com`. Each one is a distinct way to reach the *same* dashboard — a local LAN name and a public domain at once, for example. Every origin listed here needs its own `<origin>/auth/callback` redirect registered on the Discord application — see [Registering redirect URIs](DASHBOARD.md#registering-redirect-uris) in DASHBOARD.md, and don't skip it: login silently fails for any origin that isn't both listed here *and* registered there. |
| `WEB_SESSION_SECRET` | yes, to enable the dashboard | Random secret (≥32 chars) used to sign session cookies. Generate one with e.g. `openssl rand -hex 32`; never reuse the bot token for this. |
| `DISCORD_CLIENT_SECRET` | yes, to enable the dashboard | Your application's OAuth2 client secret (Developer Portal → OAuth2). Used for the dashboard login's code exchange. |

If `WEB_ENABLED` isn't explicitly `false` but one of the other three is missing, the bot still starts — it just logs a warning and skips starting the HTTP server, same as if `WEB_ENABLED=false` had been set. `src/config/index.ts`'s `loadConfig()` is what decides this once, at startup; see [ARCHITECTURE.md](ARCHITECTURE.md#startup-sequence).

Visiting the dashboard from a Host not listed in `WEB_PUBLIC_URLS` (scheme, hostname, *and* port must match one entry exactly) fails at `/auth/login` with a 400 explaining which origin was rejected — the app never guesses at a fallback origin, since sending Discord a `redirect_uri` for a domain the browser isn't actually on would just break the redirect. See [DASHBOARD.md](DASHBOARD.md#multiple-domains) for how this is enforced.

## Everything else lives in the database

The birthday channel/message/template/cron schedule, per-command `enabled`/`guildOnly` overrides, and reaction-role panels all live in SQLite (`settings`, `command_settings`, `reaction_role_panels`, `reaction_role_mappings` — see [DATABASE.md](DATABASE.md#schema)), which the [dashboard](DASHBOARD.md) reads and writes directly and which takes effect immediately, no restart. There is no `.env` equivalent for any of these and no seed step — a fresh install starts with the birthday list unconfigured and every command at its code-level default (`enabled: true, guildOnly: true`) until you set them from the dashboard.

Note that per-command `enabled`/`guildOnly` only gate *whether/where* a command runs — they do not change *who* can run it. Who can run a command (`None` / `Admin` / `Owner`) is a code-level decision per command (see [ARCHITECTURE.md](ARCHITECTURE.md#permission-model)) and isn't configurable at all, by design.

## Regenerating `.env.example`

`.env.example` is **generated**, not hand-written. It's produced from the same zod schema that validates the real environment, so it can never drift out of sync with what the app actually accepts.

```bash
npm run env:example
```

This runs `scripts/generateEnvExample.ts`, which reads each variable's `.describe()` call in `src/config/schema.ts` as its example value and writes `.env.example` at the repository root.

If you add or rename an env var, update `src/config/schema.ts` first (including its `.describe()`), then re-run this script — don't hand-edit `.env.example`.

## Logging variables

These are optional and only affect logging (see [ARCHITECTURE.md](ARCHITECTURE.md#logging) for details) — they're read directly from `process.env`, not part of the validated schema above, so they work the same whether set via `.env` or the real environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOG_DIR` | `<cwd>/../logs` | Directory log files are written to. |
| `LOG_LEVEL` | `info` | Minimum [winston log level](https://github.com/winstonjs/winston#logging-levels) written to files. |
| `NODE_ENV` | unset | No effect on logging — console output is always on (colorized) alongside the rotated file logs. |
