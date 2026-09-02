# Dashboard

An optional web UI for configuring the bot without SSH access: reaction-role panels, the birthday template/channel/schedule, per-command enable/guildOnly toggles, the leave-notification setting, and a member audit log (current and former members, join/rules-acceptance/leave dates). Everything it edits takes effect live — no restart.

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

## Who can log in — RBAC

`GET /auth/callback` resolves the logged-in Discord user to a dashboard role (`WebRole` in `src/types.ts`, `resolveDashboardRole()` in `src/web/auth.ts`):

Strict hierarchy, highest first — resolved by checking each in order and stopping at the first match:

| Role | Who gets it |
| --- | --- |
| `bot-owner` | The bot owner (`DISCORD_BOT_OWNER_ID`). Always total access. |
| `guild-owner` | Owns the configured guild, but isn't the bot owner. |
| `admin` | Anyone else who holds a role in the guild with the **Administrator** permission. |

Anyone who resolves to none of the three gets a 403 and no session is created — there's no separate "logged in but no role" state to worry about downstream, since every session that exists already passed this check and carries its role.

The role is stored on the session and checked per-route by `requireRole(...roles)` (`src/web/session.ts`); `requireAdmin` is the blanket `requireRole("bot-owner", "guild-owner", "admin")` every route currently uses, so **all three tiers see every feature that exists today** — they exist as separate tiers so a specific route can be narrowed later (e.g. `requireRole("bot-owner")` for something destructive) without a schema or login-flow change. A role is fixed for the life of a session — a Discord-side ownership/role change takes effect on the next login, not live.

Sessions are server-side rows in the `web_sessions` table (see [DATABASE.md](DATABASE.md#web_sessions)), referenced by a signed, `httpOnly` cookie. They expire after 7 days or immediately on logout; expired rows are swept on every startup.

## Pages

| Route | What it does |
| --- | --- |
| `/` | Bot status (uptime, guild, member/cache counts, panel count) and quick links. |
| `/reaction-roles` | Create/edit/delete reaction-role panels (reactions, buttons, or a dropdown) and their role mappings as a draft, then send them; manual re-sync afterward. A role already used by another option on the same panel is filtered out of the picker, a "Use font" toggle styles the title/text/labels with the [global font](#the-global-font) if one's set, and a live preview shows roughly how the message will render on Discord before you send it. See [REACTION_ROLES.md](REACTION_ROLES.md#dashboard-workflow). |
| `/birthdays` | Edit the message template (with live preview) and its own "Use font" toggle, the announcement/anchor channel, and the cron schedule; configure self-registration's notifications channel, an intro note, a month-heading template, and its own "Use font" toggle for the bot-managed anchor message — see [below](#self-registration--the-bot-managed-anchor-message); a "next up" tile for the soonest birthday(ies) and an editable, chronologically-sorted table of every registered birthday (add/edit/delete) with days-until and its source (admin-managed vs. self-registered). |
| `/commands` | Table of every command on disk (including currently-disabled ones) with `enabled`/`guildOnly` switches. |
| `/members` | Member Audit — every member ever seen, current and former, in separate tables. Lists everyone by default; search narrows both tables by username, global name, nickname, or display name — same matching (including stylized/lookalike Unicode names) as [`/finduser`](COMMANDS.md#finduser). Each row shows joined date, rules-acceptance date (Discord's membership screening), and — for a former member — leave date, each as both an absolute timestamp in your own local timezone and a relative "xM, yD and zHr ago" breakdown. See [below](#member-audit). |
| `/events` | Event-Anwesenheit — every Apollo event the bot has detected, newest first, with each signed-up member's sign-up choice vs. actual attendance (on time/late/no-show/left early), and a picker to manually link a name Apollo listed that couldn't be auto-matched to a member. See [EVENT_ATTENDANCE.md](EVENT_ATTENDANCE.md). |
| `/settings` | The leave-notification toggle, the [global font](#the-global-font), the register-gate/registration-tier roles and the "rules accepted" detection method, the Apollo/event-voice channels for event attendance tracking, and current session info (including your dashboard role). |

## Self-registration & the bot-managed anchor message

The bot owns the birthday list end to end — there's no hand-maintained mode. Birthdays get in one of two ways:

- **Admin-managed**, from the "Registered birthdays" table on `/birthdays`: add, edit, or delete an entry directly (`source: 'list'` — see [DATABASE.md](DATABASE.md#birthdays)). Each Discord user can only have one entry (adding a second for the same user id is rejected — edit the existing one instead).
- **Self-registration**, which is always on: `/setmybirthday` any time, or posting a bare date (e.g. `15.03`) directly in the configured birthday channel — the bot parses it, saves it under that member (`source: 'self'`), deletes their message, and optionally posts a heads-up to a notifications channel.

Either way, the bot re-renders the **anchor message** — posting it the first time, then editing it in place after every registration/dashboard change and once at startup, from the full current birthday list. There's nothing to hand-edit — a human edit to it in the channel is simply ignored, since the bot overwrites it on the next change anyway. Once the full list outgrows Discord's 2000-character message limit, it's automatically split across a chain of messages instead of one, each still edited in place; see [ARCHITECTURE.md § Data flow: birthday tracking](ARCHITECTURE.md#data-flow-birthday-tracking) for how chunks are packed and kept stable across syncs.

An **intro note** (optional) is shown once above every month, e.g. explaining how to self-register — never repeated per month, never font-styled. A **month heading template** controls each month's block — `{month}` and `{entries}` placeholders, defaulting to `**{month}**\n{entries}` (`DEFAULT_BIRTHDAY_ANCHOR_TEMPLATE` in `constants.ts`). `{entries}` is always the plain `ღ: DD.MM: mentions` lines (never font-styled, so mentions/dates always render correctly on Discord); `{month}` is the month name, styled with the [global font](#the-global-font) if this panel's own "Use font" toggle is on. "Regenerate message now" re-syncs it on demand, e.g. right after editing the template or font.

## The global font

A "fancy text" font — any stylized Unicode alphabet from a "fancy text" generator, etc. — can style text the bot generates, without pasting it more than once. Set it on `/settings`: paste an alphabet matching `AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz` (`FONT_REFERENCE` in `src/utils/font.ts`) character for character — 52 in total — and it's saved as `settings.font_map`. The dashboard shows a live preview and rejects anything not exactly 52 characters (counted by code point, so supplementary-plane alphabets like Mathematical Bold still count right). Leave it blank to configure nothing.

Setting it doesn't style anything by itself — each feature that can render through it has its own "Use font" toggle, off by default, so the font can be set once and forgotten while still being opt-in everywhere:

| Feature | Toggle | What gets styled |
| --- | --- | --- |
| Birthday announcement message | `/birthdays` → Message template card | The entire rendered message (mentions/`@everyone` are untouched — `applyFont()` only ever substitutes plain Latin letters, so it's always safe to apply to a fully-composed message). |
| Bot-managed anchor message | `/birthdays` → Self-registration card | Just the `{month}` heading — `{entries}` (dates/mentions) always renders plain. |
| A reaction-role panel | `/reaction-roles` → panel editor | The title, message text, and every button/dropdown option's label. |

`applyFont()` renders through the map position-for-position (`src/utils/font.ts`); characters outside the reference alphabet (digits, punctuation, emoji, `<@id>` mentions) pass through unchanged.

## Member Audit

`/members` replaces the old Find User page — same search, plus a persistent per-member record instead of just a live cache lookup: `member_records` (see [DATABASE.md](DATABASE.md#member_records)), one row per Discord user ever seen in the configured guild, current or former.

- **Current members** come from the live member cache (same one `/finduser` searches), joined with that row for its dates.
- **Former members** exist *only* as that row — once someone leaves, Discord stops telling the bot anything about them, so this table is the sole record. They're listed in their own table, most-recently-left first, capped at `MEMBER_AUDIT_LEFT_LIMIT` (`constants.ts`).
- Three dates per member, each recorded live by the bot the moment it happens (`src/services/memberRecords.ts`) — **not** backfilled from Discord history, because Discord doesn't expose most of this after the fact:
  - **Joined** — backfilled once at every startup for anyone already in the guild (Discord does still report a current member's join date), then kept current via `guildMemberAdd`.
  - **Rules accepted** — by default, the moment the member is newly granted the register-gate role (the reaction-role panel on the rules message — see `register_gate_role_id` in [DATABASE.md](DATABASE.md#settings)), detected on a `guildMemberUpdate`. A checkbox on `/settings` → Registration ("Detect 'rules accepted' via Discord's membership screening instead of the register-gate role", off by default) switches this to Discord's own membership-screening `pending` flag instead, for a server that uses that built-in feature rather than a reaction role. Discord has no historical record of either signal, so it reads as "not tracked" (shown as `—`) for anyone who triggered it before this feature shipped, before the setting was switched, or (role-based) if the role isn't configured.
  - **Left** — recorded on `guildMemberRemove`. `null` while still in the guild.
- Every date is stored as an ISO UTC string and rendered in the viewer's own local timezone in the browser (`formatAbsolute()`/`formatRelative()` in `web/src/dateFormat.ts` — plain `Date`/`toLocaleString()`, no timezone library needed); the relative form is a calendar-aware "xM, yD and zHr ago" breakdown rather than one giant unit.

## How it's wired up (for developers)

- `src/web/server.ts` — starts Fastify, registers `@fastify/cookie`/`@fastify/formbody`, mounts the auth and API routes, and serves `web/dist` as static files with an SPA fallback (`setNotFoundHandler`) so client-side routes survive a hard refresh.
- `src/web/auth.ts` — `/auth/login`, `/auth/callback`, `/auth/logout`, `GET /api/me`. `resolveRequestOrigin()` picks (and validates) which `WEB_PUBLIC_URLS` entry a given request matches — see [Multiple domains](#multiple-domains) above. The OAuth2 code exchange and profile/membership lookups use the global `fetch` (Node 22+) directly against Discord's REST API — no HTTP client dependency.
- `src/web/session.ts` — cookie helpers and `requireRole(...roles)`/`requireAdmin` (RBAC — see [Who can log in](#who-can-log-in--rbac) above), applied to every route under `/api/*` except `/api/me` (see `src/web/routes/index.ts`).
- `src/web/routes/*.ts` — one file per resource, all thin: validate the body with `zod`, delegate to the same repository/service functions the slash commands and cron job use (`src/db/*Repository.ts`, `src/services/*.ts`). The dashboard never has its own copy of business logic.
- `web/` — a separate `package.json`/Vite project (see [DEVELOPMENT.md](DEVELOPMENT.md#dashboard-frontend)), deliberately dependency-light: plain CSS custom properties for theming, no component library, no state-management library.

Writes from the dashboard use the same `settingsBus` event emitter as slash-command writes (`src/services/settingsBus.ts`), so e.g. saving a new birthday cron expression from `/birthdays` reschedules the live cron job in `src/index.ts` exactly the same way `/setbirthdaymessage` would. Reads work the same way: `/members`'s `GET /api/members/audit` and the `/finduser` slash command both filter through `matchesSearch()` (`src/services/memberSearch.ts`) — the matching/normalization logic exists in exactly one place.
