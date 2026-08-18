# Development

## Setup

```bash
npm install
cp src/config_structure.json src/config.json   # then fill in real values — see CONFIGURATION.md
npm run dev
```

`npm run dev` runs `tsx watch src/index.ts` — the bot restarts automatically on file changes, running TypeScript directly with no separate build step.

You'll need a real (or disposable test) Discord application/bot token to actually connect; see [CONFIGURATION.md](CONFIGURATION.md) for what each field means and where to get it.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Run from source with hot reload (`tsx watch`) |
| `npm run build` | Type-check and compile `src/` → `dist/` (`tsc`) |
| `npm start` | Run the compiled bot (`node dist/index.js`) — requires `npm run build` first |
| `npm run typecheck` | Type-check only, no output (`tsc --noEmit`) — fast, useful in CI or before committing |
| `npm run config:template` | Regenerate `src/config_structure.json` from `src/config/schema.ts` |

There is currently no automated test suite. Verify changes with `npm run typecheck`, `npm run build`, and manual testing against a test bot/server.

## Project conventions

These are enforced by convention/review, not tooling — keep them in mind when adding code:

- **No magic numbers/strings.** Add new literals (timeouts, limits, Discord error codes, cron expressions, etc.) to `src/constants.ts` rather than inlining them. Group related constants with a comment header.
- **Enums over ad-hoc strings.** `CommandPermission`, `CommandName`, and `EmbedColor` live in `src/constants.ts`. Extend them rather than typing raw strings/hex values at call sites.
- **Permission checks belong in the command's `permission` export, not in `execute()`.** See [ARCHITECTURE.md](ARCHITECTURE.md#permission-model) — the central dispatcher in `index.ts` already handles the check and the rejection reply.
- **`config.json` shape changes go through the zod schema first.** Edit `src/config/schema.ts` (including the field's `.describe()` placeholder), then run `npm run config:template` to regenerate `config_structure.json`. Never hand-edit that generated file.
- **Data access goes through `src/db/*Repository.ts`.** Business logic in `src/services/` should not contain raw SQL — add a repository function instead.
- **Error logging:** use the `errorMessage()` helper from `utils/logger.ts` rather than passing an `Error` as a second argument to `logger.error()`/`logger.warn()` — see [ARCHITECTURE.md](ARCHITECTURE.md#logging) for why the latter silently drops your message.

## Adding a new command

1. Create a file under `src/commands/<category>/<name>.ts` (an existing category like `birthday`/`general`, or a new one — the loader recurses into any subdirectory).
2. Export `data` (a `SlashCommandBuilder`), `execute` (an async function taking a `ChatInputCommandInteraction`), and `permission` (a `CommandPermission` from `constants.ts` — omit for `None`/public).
3. Add the command's name to the `CommandName` enum in `constants.ts` and use it in `.setName(...)` instead of a raw string literal.
4. If the command needs a non-default `guildOnly` behavior, note it under `commands` in `config_structure.json`'s illustrative examples (optional — it works either way via `config.json`, this just documents the intent).

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

## Adding a new config field

1. Add it to `ConfigSchema` in `src/config/schema.ts`, including `.describe("EXAMPLE_VALUE")`.
2. Run `npm run config:template` to regenerate `src/config_structure.json`.
3. Update [CONFIGURATION.md](CONFIGURATION.md)'s field table.

The `Config` TypeScript type is inferred from the schema (`z.infer<typeof ConfigSchema>`) — nothing else to keep in sync.

## TypeScript setup notes

- Module resolution is `NodeNext` — relative imports use `.js` extensions even though the source files are `.ts` (standard for ESM + TypeScript; `tsx`/`tsc` resolve them to the `.ts` source or compiled `.js` output as appropriate).
- `tsconfig.json` targets `ES2022` with `strict: true`. Keep new code strict-mode clean — run `npm run typecheck` before considering a change done.
- `src/loaders/commandLoader.ts` detects its own file extension (`.ts` vs `.js`) at runtime to decide which command file extension to scan for, so command discovery works identically whether you're running via `tsx` (dev) or compiled output (prod/Docker). If you ever restructure the loader, preserve this — don't hardcode `.js`.
