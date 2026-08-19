# Deployment

## Docker (recommended)

### Prerequisites

- Docker and Docker Compose
- A filled-in `.env` (see [CONFIGURATION.md](CONFIGURATION.md)) at the **repository root**

### First run

```bash
cp .env.example .env   # then fill in real values
docker compose up -d --build
```

That's it — `docker-compose.yml` builds the image and starts the `bot` service in the background.

### Enabling the dashboard (optional)

If you set the `WEB_*`/`DISCORD_CLIENT_SECRET` variables in `.env` to turn on the [dashboard](DASHBOARD.md), there's one more **required** step outside of `.env` entirely: register a redirect URI on the Discord application for every origin in `WEB_PUBLIC_URLS`, in the [Discord Developer Portal](https://discord.com/developers/applications) → your application → OAuth2 → Redirects. This isn't optional — login fails (with a clear error, but it's easy to not immediately connect the error to a missing Portal step) for any domain that isn't registered there, even if it's correctly listed in `WEB_PUBLIC_URLS`. See [DASHBOARD.md § Registering redirect URIs](DASHBOARD.md#registering-redirect-uris) for exactly what to add, and [DASHBOARD.md § Multiple domains](DASHBOARD.md#multiple-domains) if the bot is reachable at more than one hostname (e.g. a LAN name and a public domain at once).

### What the Compose setup does

```yaml
services:
  bot:
    build: .
    restart: unless-stopped
    env_file:
      - ./.env
    environment:
      LOG_DIR: /app/logs
    ports:
      - "${WEB_PORT:-3000}:${WEB_PORT:-3000}"
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
```

- **`env_file: ./.env`**: loads every variable from `.env` into the *container's* environment. Nothing secret is baked into the image — it's only ever supplied at run time.
- **`./data` → `/app/data`**: the SQLite database (see [DATABASE.md](DATABASE.md)). Persists across container recreation.
- **`./logs` → `/app/logs`**: log files. `LOG_DIR` is explicitly set to `/app/logs` because the app's default (`<cwd>/../logs`) would otherwise resolve outside the container's writable area.
- **`ports: "${WEB_PORT:-3000}:${WEB_PORT:-3000}"`**: only relevant if the [dashboard](DASHBOARD.md) is enabled. This is Compose's *own* `${...}` substitution — separate from `env_file` above — which it does by reading the same `./.env` file directly (any `.env` in the same directory as `docker-compose.yml` is used for this automatically, no extra config needed). Both sides always match `WEB_PORT`, so changing it in `.env` and re-running `docker compose up -d` is enough — no need to touch this file. Every origin in `WEB_PUBLIC_URLS` should then point at that same port. Remove this block entirely if you're not using the dashboard, or front it with a reverse proxy instead of publishing it directly.

Both `data/` and `logs/` directories are created on the host automatically by Docker if they don't already exist; the container also creates them internally if the volumes are empty.

### The image itself

`Dockerfile` is a three-stage build:

1. **`build`** — `node:lts-slim`, installs *all* bot dependencies (`npm ci --ignore-scripts` — scripts are skipped since this stage never runs `better-sqlite3`'s native addon, only type-checks against it), compiles TypeScript via `tsc`.
2. **`build-web`** — a separate `node:lts-slim` stage for the dashboard frontend (`web/`, its own `package.json`/lockfile — see [DEVELOPMENT.md](DEVELOPMENT.md#dashboard-frontend)), runs `npm ci && npm run build` to produce `web/dist`.
3. **`runtime`** — a fresh `node:lts-slim`, installs only the bot's production dependencies (`npm ci --omit=dev`, this time with scripts enabled so `better-sqlite3` actually compiles/links its native addon for the runtime environment). That compile step needs Python + a C++ toolchain, which the slim base image doesn't ship — this stage installs `python3 make g++` via `apt-get`, runs `npm ci`, then purges them again, all in one `RUN` layer, so the final image doesn't permanently carry a build toolchain for a step that only runs once at image-build time. Copies in the compiled `dist/` output from `build` plus `web/dist` from `build-web`. No source, no dev tooling, no build-time-only files (including the now-removed apt packages) end up in the final image layers. `src/web/server.ts` serves `web/dist` as static files if it's present, and logs a warning (dashboard-only feature, rest of the bot unaffected) if it isn't.

### Common operations

```bash
docker compose logs -f bot        # tail logs
docker compose restart bot        # restart after editing .env
docker compose up -d --build      # rebuild after a code change
docker compose down                # stop (data/ and logs/ survive on the host)
```

After editing `.env`, restart the container — env vars are read once at startup and cached, so changes aren't picked up live. This only matters for the bootstrap/secret variables in [CONFIGURATION.md](CONFIGURATION.md) (token, IDs, `WEB_*`) — everything else (birthday channel/template/cron, per-command toggles, reaction roles) lives in the DB and is editable live from the [dashboard](DASHBOARD.md) instead.

### Updating slash commands after a code change

Slash command definitions are re-registered with Discord automatically on every startup (`rest.put(Routes.applicationCommands(...))` in `src/index.ts`), so a rebuild + restart is enough — no separate deploy-commands step.

## Bare-metal / manual deployment

If you'd rather not use Docker:

```bash
npm ci
npm run build
cp .env.example .env   # then fill in real values
NODE_ENV=production LOG_DIR=/var/log/leck-eier-bot npm start
```

`.env` lives at the project root regardless of dev vs. prod (see [CONFIGURATION.md](CONFIGURATION.md)); `data/` will be created automatically next to it (one level above `dist/`) on first run.

If you're enabling the [dashboard](DASHBOARD.md), the same Discord Developer Portal step from [above](#enabling-the-dashboard-optional) applies here too — it's not Docker-specific.

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
