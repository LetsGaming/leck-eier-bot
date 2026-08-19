# Development

## Setup

```bash
npm install
cp .env.example .env   # then fill in real values — see CONFIGURATION.md
npm run dev
```

`npm run dev` runs `tsx watch src/index.ts` — the bot restarts automatically on file changes, running TypeScript directly with no separate build step.

You'll need a real (or disposable test) Discord application/bot token to actually connect; see [CONFIGURATION.md](CONFIGURATION.md) for what each field means and where to get it.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Run from source with hot reload (`tsx watch`) |
| `npm run dev:web` | Run the dashboard's Vite dev server (hot-reloading frontend) — see [Dashboard frontend](#dashboard-frontend) |
| `npm run build` | Type-check and compile `src/` → `dist/` (`tsc`), then install and build `web/` too |
| `npm start` | Run the compiled bot (`node dist/index.js`) — requires `npm run build` first |
| `npm run typecheck` | Type-check only, no output (`tsc --noEmit`) — fast, useful in CI or before committing. Bot-only; run `npm --prefix web run build` to type-check the dashboard. |
| `npm run env:example` | Regenerate `.env.example` from `src/config/schema.ts` |

There is currently no automated test suite. Verify changes with `npm run typecheck`, `npm run build`, and manual testing against a test bot/server.

## Dashboard frontend

`web/` is a separate Vite + React + TypeScript project with its own `package.json`/lockfile — it isn't part of the root npm workspace, so its dependencies (`react`, `vite`, ...) never end up in the bot's own `node_modules` or its `npm ci --omit=dev` production install.

```bash
npm install                       # once, at the repo root
cd web && npm install              # once, for the dashboard
cd ..
npm run dev                        # terminal 1: the bot (also serves /api, /auth on :3000)
npm run dev:web                    # terminal 2: Vite dev server, proxies /api and /auth to :3000
```

Vite's dev server proxy (`web/vite.config.ts`) is dev-only — in production the bot's own Fastify server (`src/web/server.ts`) serves `web/dist` directly, no proxy involved. `npm run build` at the repo root builds both; see [DASHBOARD.md](DASHBOARD.md) for enabling/configuring the dashboard itself and [ARCHITECTURE.md](ARCHITECTURE.md#dashboard) for how the backend is wired.

The frontend is deliberately dependency-light: plain CSS custom properties for theming (`web/src/theme.css`), no component library, a small hand-written `fetch` wrapper (`web/src/api.ts`) instead of a data-fetching library, no state-management library. Keep new pages consistent with that — see the existing pages under `web/src/pages/` before reaching for a new dependency.

## Project conventions

These are enforced by convention/review, not tooling — keep them in mind when adding code:

- **No magic numbers/strings.** Add new literals (timeouts, limits, Discord error codes, cron expressions, etc.) to `src/constants.ts` rather than inlining them. Group related constants with a comment header.
- **Enums over ad-hoc strings.** `CommandPermission`, `CommandName`, and `EmbedColor` live in `src/constants.ts`. Extend them rather than typing raw strings/hex values at call sites.
- **Permission checks belong in the command's `permission` export, not in `execute()`.** See [ARCHITECTURE.md](ARCHITECTURE.md#permission-model) — the central dispatcher in `index.ts` already handles the check and the rejection reply.
- **Env var shape changes go through the zod schema first.** Edit `EnvSchema` in `src/config/schema.ts` (including the field's `.describe()` placeholder), then run `npm run env:example` to regenerate `.env.example`. Never hand-edit that generated file.
- **Data access goes through `src/db/*Repository.ts`.** Business logic in `src/services/` and dashboard route handlers in `src/web/routes/` should not contain raw SQL — add a repository function instead.
- **A setting an admin might want to change while the bot is running belongs in the DB, not an env var.** Env vars are read once at startup and cached (`loadConfig()` never re-reads `process.env`) — see [CONFIGURATION.md](CONFIGURATION.md). If something else in the process needs to react live to that change (a scheduled job, a cache), have the repository function emit on `settingsBus` (`src/services/settingsBus.ts`) after writing rather than having callers poke the consumer directly.
- **Error logging:** use the `errorMessage()` helper from `utils/logger.ts` rather than passing an `Error` as a second argument to `logger.error()`/`logger.warn()` — see [ARCHITECTURE.md](ARCHITECTURE.md#logging) for why the latter silently drops your message.

## Adding a new command

1. Create a file under `src/commands/<category>/<name>.ts` (an existing category like `birthday`/`general`, or a new one — the loader recurses into any subdirectory).
2. Export `data` (a `SlashCommandBuilder`), `execute` (an async function taking a `ChatInputCommandInteraction`), and `permission` (a `CommandPermission` from `constants.ts` — omit for `None`/public).
3. Add the command's name to the `CommandName` enum in `constants.ts` and use it in `.setName(...)` instead of a raw string literal.
4. If the command needs a non-default `guildOnly` behavior, that's set from the dashboard's Commands page after the command exists — nothing to declare in code beyond the default.

Minimal example:

```ts
import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { CommandName, CommandPermission } from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.MyNewCommand)
  .setDescription("Does the thing.");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.reply({ content: "Done!", flags: MessageFlags.Ephemeral });
}
```

No manual registration step needed — `commandLoader.ts` discovers it automatically, and it's re-registered with Discord on the next startup.

## Adding a new env var

1. Add it to `EnvSchema` in `src/config/schema.ts`, including `.describe("EXAMPLE_VALUE")`.
2. Run `npm run env:example` to regenerate `.env.example`.
3. If it's a plain bootstrap value, add it to `Config` and populate it in `loadConfig()` (`src/config/index.ts`). If it's dashboard-only, fold it into the `WebConfig` construction there instead.
4. Update [CONFIGURATION.md](CONFIGURATION.md)'s variable table.

Unlike `Config`, `EnvSchema`'s inferred type (`Env`) is all-flat-strings-and-optionals by design (that's what `process.env` actually looks like) — `loadConfig()` is where cross-field logic (e.g. "the dashboard needs these three set together") and type coercion happen, so `Config` stays a clean, fully-typed shape for the rest of the app to consume.

## TypeScript setup notes

- Module resolution is `NodeNext` — relative imports use `.js` extensions even though the source files are `.ts` (standard for ESM + TypeScript; `tsx`/`tsc` resolve them to the `.ts` source or compiled `.js` output as appropriate).
- `tsconfig.json` targets `ES2022` with `strict: true`. Keep new code strict-mode clean — run `npm run typecheck` before considering a change done.
- `src/loaders/commandLoader.ts` detects its own file extension (`.ts` vs `.js`) at runtime to decide which command file extension to scan for, so command discovery works identically whether you're running via `tsx` (dev) or compiled output (prod/Docker). If you ever restructure the loader, preserve this — don't hardcode `.js`.
