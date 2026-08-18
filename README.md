# leck-eier-bot

A Discord bot that tracks member birthdays parsed out of an announcement channel, posts daily birthday shout-outs, and provides a handful of moderation/utility slash commands.

Written in TypeScript, backed by SQLite, and deployable via Docker.

## Features

- **Birthday tracking** — parses a specially formatted announcement message/thread for birthdays, resolves each entry against real Discord members, and stores the result in SQLite.
- **Daily birthday announcements** — a midnight cron job posts birthday messages using a configurable template, and cleans up the previous day's messages.
- **Member cache** — caches guild members in memory for fast, offline-friendly name search (`/finduser`).
- **Leave notifications** — DMs the server owner when a member leaves voluntarily (skips kicks/bans, detected via the audit log).
- **Slash commands** — see [docs/COMMANDS.md](docs/COMMANDS.md) for the full reference.

## Quick start

```bash
npm install
cp src/config_structure.json src/config.json   # then fill in the real values
npm run dev
```

`config.json` lives next to whichever code is actually running (`src/` in dev, `dist/` after a build) — see [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for why and for the full field reference.

## Documentation

| Doc | Covers |
| --- | --- |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | `config.json` fields, the zod schema, regenerating the template, environment variables |
| [docs/COMMANDS.md](docs/COMMANDS.md) | Every slash command, its options, and who can run it |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Project layout, module responsibilities, request/startup flow, permission model |
| [docs/DATABASE.md](docs/DATABASE.md) | SQLite schema, where the file lives, inspecting/backing it up |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Running in Docker (recommended) or bare-metal with `pm2`/`systemd` |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, npm scripts, project conventions, adding a new command |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the bot from source with hot reload (`tsx watch`) |
| `npm run build` | Type-check and compile `src/` to `dist/` |
| `npm start` | Run the compiled bot (`dist/index.js`) |
| `npm run typecheck` | Type-check without emitting output |
| `npm run config:template` | Regenerate `src/config_structure.json` from the config schema |

## Requirements

- Node.js 22+
- A Discord application with a bot token (see [docs/CONFIGURATION.md](docs/CONFIGURATION.md))
- Docker + Docker Compose (only for the containerized deployment path)

## License

No license file is present in this repository — treat the code as all-rights-reserved unless the repository owner states otherwise.
