# leck-eier-bot

A Discord bot that tracks member birthdays parsed out of an announcement channel, posts daily birthday shout-outs, lets members self-assign roles by reacting, and provides a handful of moderation/utility slash commands — plus an optional web dashboard to configure all of it live.

Written in TypeScript, backed by SQLite, and deployable via Docker.

## Features

- **Birthday tracking** — parses a specially formatted announcement message/thread for birthdays, resolves each entry against real Discord members, and stores the result in SQLite.
- **Daily birthday announcements** — a cron job (schedule configurable) posts birthday messages using a configurable template, and cleans up the previous day's messages.
- **Reaction roles** — post a panel of emoji↔role options; members react to self-assign. Toggle, unique ("pick one"), and verify (add-only) modes, each independently combinable with auto-clearing the reaction. See [docs/REACTION_ROLES.md](docs/REACTION_ROLES.md).
- **Web dashboard** *(optional)* — a Discord-OAuth-gated UI for editing reaction-role panels, the birthday template/channel/schedule, per-command toggles, and more, without touching a config file or restarting. See [docs/DASHBOARD.md](docs/DASHBOARD.md).
- **Member cache** — caches guild members in memory for fast, offline-friendly name search (`/finduser`).
- **Leave notifications** — DMs the server owner when a member leaves voluntarily (skips kicks/bans, detected via the audit log).
- **Slash commands** — see [docs/COMMANDS.md](docs/COMMANDS.md) for the full reference.

## Quick start

```bash
npm install
cp .env.example .env   # then fill in the real values
npm run dev
```

`.env` lives at the repository root and works the same way whether you're running from source, compiled, or in Docker — see [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the full variable reference.

## Documentation

See [docs/README.md](docs/README.md) for a task-oriented index (e.g. "dashboard shows a login error", "adding a new command"). Full list:

| Doc | Covers |
| --- | --- |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Env vars, the zod schema, regenerating `.env.example` |
| [docs/COMMANDS.md](docs/COMMANDS.md) | Every slash command, its options, and who can run it |
| [docs/REACTION_ROLES.md](docs/REACTION_ROLES.md) | Reaction-role panels, modes, `removeReaction` semantics, requirements |
| [docs/DASHBOARD.md](docs/DASHBOARD.md) | The web dashboard — OAuth setup, enabling it, what each page does |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Project layout, module responsibilities, request/startup flow, permission model |
| [docs/DATABASE.md](docs/DATABASE.md) | SQLite schema, migrations, where the file lives, inspecting/backing it up |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Running in Docker (recommended) or bare-metal with `pm2`/`systemd` |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, npm scripts, project conventions, adding a new command, the dashboard frontend |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the bot from source with hot reload (`tsx watch`) |
| `npm run dev:web` | Run the dashboard's frontend dev server (see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#dashboard-frontend)) |
| `npm run build` | Type-check and compile `src/` to `dist/`, then build the dashboard frontend (`web/dist`) |
| `npm start` | Run the compiled bot (`dist/index.js`) |
| `npm run typecheck` | Type-check without emitting output |
| `npm run env:example` | Regenerate `.env.example` from the config schema |

## Requirements

- Node.js 22+
- A Discord application with a bot token (see [docs/CONFIGURATION.md](docs/CONFIGURATION.md))
- Docker + Docker Compose (only for the containerized deployment path)

## License

No license file is present in this repository — treat the code as all-rights-reserved unless the repository owner states otherwise.
