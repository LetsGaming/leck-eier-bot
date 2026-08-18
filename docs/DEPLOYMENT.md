# Deployment

## Docker (recommended)

### Prerequisites

- Docker and Docker Compose
- A filled-in `config.json` (see [CONFIGURATION.md](CONFIGURATION.md)) at the **repository root**, named `config.json`

### First run

```bash
cp src/config_structure.json config.json   # then fill in real values
docker compose up -d --build
```

That's it — `docker-compose.yml` builds the image and starts the `bot` service in the background.

### What the Compose setup does

```yaml
services:
  bot:
    build: .
    restart: unless-stopped
    environment:
      LOG_DIR: /app/logs
    volumes:
      - ./config.json:/app/dist/config.json:ro
      - ./data:/app/data
      - ./logs:/app/logs
```

- **`./config.json` → `/app/dist/config.json`**: mounted read-only. Note the target is `dist/config.json`, not the container root — the compiled bot runs from `/app/dist`, and `config.json` lives next to whichever code is running (see [CONFIGURATION.md](CONFIGURATION.md#where-configjson-must-live)). Don't "fix" this to `/app/config.json`; it won't be found there.
- **`./data` → `/app/data`**: the SQLite database (see [DATABASE.md](DATABASE.md)). Persists across container recreation.
- **`./logs` → `/app/logs`**: log files. `LOG_DIR` is explicitly set to `/app/logs` because the app's default (`<cwd>/../logs`) would otherwise resolve outside the container's writable area.

Both `data/` and `logs/` directories are created on the host automatically by Docker if they don't already exist; the container also creates them internally if the volumes are empty.

### The image itself

`Dockerfile` is a two-stage build:

1. **`build`** — `node:lts-slim`, installs *all* dependencies (`npm ci --ignore-scripts` — scripts are skipped since this stage never runs `better-sqlite3`'s native addon, only type-checks against it), compiles TypeScript via `npm run build`.
2. **`runtime`** — a fresh `node:lts-slim`, installs only production dependencies (`npm ci --omit=dev`, this time with scripts enabled so `better-sqlite3` actually compiles/links its native addon for the runtime environment), and copies in just the compiled `dist/` output from the build stage. No source, no dev tooling, no build-time-only files end up in the final image.

### Common operations

```bash
docker compose logs -f bot        # tail logs
docker compose restart bot        # restart after editing config.json
docker compose up -d --build      # rebuild after a code change
docker compose down                # stop (data/ and logs/ survive on the host)
```

After editing `config.json`, restart the container — config is loaded once at startup and cached, so changes aren't picked up live.

### Updating slash commands after a code change

Slash command definitions are re-registered with Discord automatically on every startup (`rest.put(Routes.applicationCommands(...))` in `src/index.ts`), so a rebuild + restart is enough — no separate deploy-commands step.

## Bare-metal / manual deployment

If you'd rather not use Docker:

```bash
npm ci
npm run build
cp src/config_structure.json dist/config.json   # then fill in real values
NODE_ENV=production LOG_DIR=/var/log/leck-eier-bot npm start
```

`data/` will be created automatically next to the project root (one level above `dist/`) on first run.

For process supervision, use whatever your platform standardizes on — `pm2`, `systemd`, or a container orchestrator. A minimal `systemd` unit:

```ini
[Unit]
Description=leck-eier-bot
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/leck-eier-bot
Environment=NODE_ENV=production
Environment=LOG_DIR=/var/log/leck-eier-bot
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Environment parity note

`better-sqlite3` ships a native addon compiled for a specific Node ABI/platform. If you deploy without Docker, make sure `npm ci` (which compiles/links it) runs **on the target machine** (or an environment with an identical OS/architecture/Node version) — don't copy a `node_modules` directory built on a different platform.
