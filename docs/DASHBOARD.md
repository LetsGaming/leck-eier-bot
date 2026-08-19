# Dashboard

An optional web UI for configuring the bot without SSH access: reaction-role panels, the birthday template/channel/schedule, per-command enable/guildOnly toggles, and the leave-notification setting. Everything it edits takes effect live — no restart.

It's a React SPA (`web/`) served as static files by the bot's own HTTP server (Fastify, `src/web/`), gated behind Discord OAuth2. There's no separate deployment: setting the right env vars is the whole setup.

## Setting up the Discord OAuth2 app

The dashboard reuses your existing bot application — no second Discord app needed.

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → your application → **OAuth2**.
2. Copy the **Client Secret** (next to Client ID) into `DISCORD_CLIENT_SECRET`. Keep this as secret as the bot token.
3. Under **Redirects**, add every domain you listed in `WEB_PUBLIC_URLS`, each with `/auth/callback` appended — see [Registering redirect URIs](#registering-redirect-uris) below. **This step is easy to miss and login fails silently (well, with a clear error, but easy to not connect to "I forgot a step in the Developer Portal") if you skip it** — it isn't optional even for a single-domain setup.

No extra OAuth2 scopes need enabling on the application itself; the dashboard requests `identify` and `guilds.members.read` at login time.

### Registering redirect URIs

Discord's OAuth2 flow requires every `redirect_uri` the app might send to be pre-registered, byte-for-byte, on the application — the dashboard's login route refuses to guess or fall back, and Discord itself will reject an unregistered one before ever redirecting back to you. Concretely: for **each** origin in `WEB_PUBLIC_URLS`, add `<that origin>/auth/callback` under OAuth2 → Redirects. For example, with

```bash
WEB_PUBLIC_URLS=http://eier.lan.net:3000,https://bot.example.com
```

register both:

```
http://eier.lan.net:3000/auth/callback
https://bot.example.com/auth/callback
```

Scheme, hostname, and port all have to match exactly on both sides (Discord's registration *and* `WEB_PUBLIC_URLS`) — `http://` vs `https://`, a missing/extra port, or a trailing slash all count as a mismatch. Forgetting to add one, or a typo in either place, is the single most common reason login fails.

## Configuring and starting it

Set these in `.env` (see [CONFIGURATION.md](CONFIGURATION.md#dashboard-variables-optional) for the full reference):

```bash
DISCORD_CLIENT_SECRET=your-application-client-secret
WEB_ENABLED=true
WEB_PORT=3000
WEB_PUBLIC_URLS=http://localhost:3000
WEB_SESSION_SECRET=a-random-string-at-least-32-characters-long
```

Then build and run as usual (`npm run build && npm start`, or `docker compose up -d --build`) — the dashboard starts automatically once the bot's guild is cached, right after `clientReady`. If `WEB_PUBLIC_URLS`/`WEB_SESSION_SECRET`/`DISCORD_CLIENT_SECRET` aren't all set (or `WEB_ENABLED=false` is set explicitly), the HTTP server never starts and the rest of the bot is unaffected.

For local development, run the bot (`npm run dev`) and the dashboard's dev server (`npm run dev:web`) in two terminals — Vite proxies `/api` and `/auth` to `http://localhost:3000` (see `web/vite.config.ts`), so you get hot-reload on the frontend while talking to the real backend.

## Multiple domains

`WEB_PUBLIC_URLS` accepts a comma-separated list, so the same running instance can be reached at more than one hostname — a local LAN name (`http://eier.lan.net:3000`) and a public domain behind a reverse proxy (`https://bot.example.com`) at once, for example. There's exactly one bot process, one SQLite database, one dashboard — just several front doors to it.

Each origin is validated independently and strictly on every login attempt (`resolveRequestOrigin()` in `src/web/auth.ts`): the incoming request's scheme + host + port must match one `WEB_PUBLIC_URLS` entry exactly, or `/auth/login` rejects it with a 400 explaining which origin wasn't recognized — it never falls back to a different configured origin, since that would send Discord a `redirect_uri` for a domain the browser isn't actually on and just break the redirect. Behind a TLS-terminating reverse proxy, that scheme check relies on `X-Forwarded-Proto` being forwarded correctly (the app trusts proxy headers — `trustProxy: true` in `src/web/server.ts`); if your proxy doesn't set that header, requests will look like plain `http://` to the app even though the browser used `https://`, and get rejected.

Common causes of "this dashboard isn't reachable at ..." even with the right domain in `WEB_PUBLIC_URLS`:

- The port doesn't match — `http://eier.lan.net` and `http://eier.lan.net:3000` are different origins.
- The reverse proxy doesn't forward `X-Forwarded-Proto` (or `X-Forwarded-Host`), so the app sees the wrong scheme/host.
- The redirect URI wasn't (also) registered on the Discord application — see [Registering redirect URIs](#registering-redirect-uris) above. This one specifically surfaces as Discord's own error page, or a state-mismatch error at `/auth/callback`, rather than the 400 from `/auth/login` — if you get that far, the origin check already passed.

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
| `/reaction-roles` | Create/edit/delete reaction-role panels (reactions, buttons, or a dropdown) and their role mappings as a draft, then send them; manual re-sync afterward. See [REACTION_ROLES.md](REACTION_ROLES.md#dashboard-workflow). |
| `/birthdays` | Edit the message template (with live preview), the announcement channel/anchor message, the cron schedule, and a read-only table of currently-parsed birthdays. |
| `/commands` | Table of every command on disk (including currently-disabled ones) with `enabled`/`guildOnly` switches. |
| `/settings` | The leave-notification toggle and current session info. |

## How it's wired up (for developers)

- `src/web/server.ts` — starts Fastify, registers `@fastify/cookie`/`@fastify/formbody`, mounts the auth and API routes, and serves `web/dist` as static files with an SPA fallback (`setNotFoundHandler`) so client-side routes survive a hard refresh.
- `src/web/auth.ts` — `/auth/login`, `/auth/callback`, `/auth/logout`, `GET /api/me`. `resolveRequestOrigin()` picks (and validates) which `WEB_PUBLIC_URLS` entry a given request matches — see [Multiple domains](#multiple-domains) above. The OAuth2 code exchange and profile/membership lookups use the global `fetch` (Node 22+) directly against Discord's REST API — no HTTP client dependency.
- `src/web/session.ts` — cookie helpers and the `requireAdmin` preHandler applied to every route under `/api/*` except `/api/me` (see `src/web/routes/index.ts`).
- `src/web/routes/*.ts` — one file per resource, all thin: validate the body with `zod`, delegate to the same repository/service functions the slash commands and cron job use (`src/db/*Repository.ts`, `src/services/*.ts`). The dashboard never has its own copy of business logic.
- `web/` — a separate `package.json`/Vite project (see [DEVELOPMENT.md](DEVELOPMENT.md#dashboard-frontend)), deliberately dependency-light: plain CSS custom properties for theming, no component library, no state-management library.

Writes from the dashboard use the same `settingsBus` event emitter as slash-command writes (`src/services/settingsBus.ts`), so e.g. saving a new birthday cron expression from `/birthdays` reschedules the live cron job in `src/index.ts` exactly the same way `/setbirthdaymessage` would.
