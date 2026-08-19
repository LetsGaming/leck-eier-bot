# Dashboard

An optional web UI for configuring the bot without SSH access: reaction-role panels, the birthday template/channel/schedule, per-command enable/guildOnly toggles, and the leave-notification setting. Everything it edits takes effect live — no restart.

It's a React SPA (`web/`) served as static files by the bot's own HTTP server (Fastify, `src/web/`), gated behind Discord OAuth2. There's no separate deployment: setting the right env vars is the whole setup.

## Setting up the Discord OAuth2 app

The dashboard reuses your existing bot application — no second Discord app needed.

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → your application → **OAuth2**.
2. Copy the **Client Secret** (next to Client ID) into `DISCORD_CLIENT_SECRET`. Keep this as secret as the bot token.
3. Under **Redirects**, add `<WEB_PUBLIC_URL>/auth/callback` — this must be byte-for-byte identical to `WEB_PUBLIC_URL` plus `/auth/callback`. For local development that's typically `http://localhost:3000/auth/callback`.

No extra OAuth2 scopes need enabling on the application itself; the dashboard requests `identify` and `guilds.members.read` at login time.

## Configuring and starting it

Set these in `.env` (see [CONFIGURATION.md](CONFIGURATION.md#dashboard-variables-optional) for the full reference):

```bash
DISCORD_CLIENT_SECRET=your-application-client-secret
WEB_ENABLED=true
WEB_PORT=3000
WEB_PUBLIC_URL=http://localhost:3000
WEB_SESSION_SECRET=a-random-string-at-least-32-characters-long
```

Then build and run as usual (`npm run build && npm start`, or `docker compose up -d --build`) — the dashboard starts automatically once the bot's guild is cached, right after `clientReady`. If `WEB_PUBLIC_URL`/`WEB_SESSION_SECRET`/`DISCORD_CLIENT_SECRET` aren't all set (or `WEB_ENABLED=false` is set explicitly), the HTTP server never starts and the rest of the bot is unaffected.

For local development, run the bot (`npm run dev`) and the dashboard's dev server (`npm run dev:web`) in two terminals — Vite proxies `/api` and `/auth` to `http://localhost:3000` (see `web/vite.config.ts`), so you get hot-reload on the frontend while talking to the real backend.

## Who can log in

`GET /auth/callback` only creates a session if the logged-in Discord user is:

- the bot owner (`DISCORD_BOT_OWNER_ID`), **or**
- the guild owner, **or**
- holds a role in the guild with the **Administrator** permission.

Anyone else gets a 403 and no session is created — there's no separate "logged in but not admin" state to worry about downstream, since every session that exists already passed this check (`src/web/session.ts`'s `requireAdmin`).

Sessions are server-side rows in the `web_sessions` table (see [DATABASE.md](DATABASE.md#web_sessions)), referenced by a signed, `httpOnly` cookie. They expire after 7 days or immediately on logout; expired rows are swept on every startup.

## Pages

| Route | What it does |
| --- | --- |
| `/` | Bot status (uptime, guild, member/cache counts, panel count) and quick links. |
| `/reaction-roles` | Create/edit/delete reaction-role panels and their emoji→role mappings; manual re-sync. See [REACTION_ROLES.md](REACTION_ROLES.md#dashboard-workflow). |
| `/birthdays` | Edit the message template (with live preview), the announcement channel/anchor message, the cron schedule, and a read-only table of currently-parsed birthdays. |
| `/commands` | Table of every command on disk (including currently-disabled ones) with `enabled`/`guildOnly` switches. |
| `/settings` | The leave-notification toggle and current session info. |

## How it's wired up (for developers)

- `src/web/server.ts` — starts Fastify, registers `@fastify/cookie`/`@fastify/formbody`, mounts the auth and API routes, and serves `web/dist` as static files with an SPA fallback (`setNotFoundHandler`) so client-side routes survive a hard refresh.
- `src/web/auth.ts` — `/auth/login`, `/auth/callback`, `/auth/logout`, `GET /api/me`. The OAuth2 code exchange and profile/membership lookups use the global `fetch` (Node 22+) directly against Discord's REST API — no HTTP client dependency.
- `src/web/session.ts` — cookie helpers and the `requireAdmin` preHandler applied to every route under `/api/*` except `/api/me` (see `src/web/routes/index.ts`).
- `src/web/routes/*.ts` — one file per resource, all thin: validate the body with `zod`, delegate to the same repository/service functions the slash commands and cron job use (`src/db/*Repository.ts`, `src/services/*.ts`). The dashboard never has its own copy of business logic.
- `web/` — a separate `package.json`/Vite project (see [DEVELOPMENT.md](DEVELOPMENT.md#dashboard-frontend)), deliberately dependency-light: plain CSS custom properties for theming, no component library, no state-management library.

Writes from the dashboard use the same `settingsBus` event emitter as slash-command writes (`src/services/settingsBus.ts`), so e.g. saving a new birthday cron expression from `/birthdays` reschedules the live cron job in `src/index.ts` exactly the same way `/setbirthdaymessage` would.
