# Database

The bot persists all state in a single SQLite database via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) (synchronous, no ORM). There's still no external migration tool, but as of the reaction-roles/dashboard feature there is a minimal one built on SQLite's own `PRAGMA user_version`: it's safe to delete the database file to reset all state, but it's no longer just `CREATE TABLE IF NOT EXISTS` — see [Migrations](#migrations) below.

## Location

`data/bot.sqlite` at the **project root**, one level above whichever of `src/`/`dist/` is currently running (`src/db/index.ts` resolves this as `path.resolve(__dirname, "..", "..", "data")`). This is consistent whether you run via `npm run dev`, `npm start`, or in Docker.

WAL mode is enabled (`journal_mode = WAL`), so you'll also see `bot.sqlite-wal` and `bot.sqlite-shm` alongside it during normal operation — these are part of the database, not junk files; don't delete them while the bot is running.

The `data/` directory (and therefore the whole database) is git-ignored and Docker-volume-mounted — see [DEPLOYMENT.md](DEPLOYMENT.md).

## Migrations

`src/db/index.ts` holds an ordered array of migration functions, applied in order and tracked via `PRAGMA user_version` (an integer SQLite maintains for you — no separate tracking table needed):

```ts
const MIGRATIONS: Array<(d: Database.Database) => void> = [ /* v1 */, /* v2 */, ... ];
const current = db.pragma("user_version", { simple: true }) as number;
for (let v = current; v < MIGRATIONS.length; v++) {
  db.transaction(() => { MIGRATIONS[v]!(db); db.pragma(`user_version = ${v + 1}`); })();
}
```

Each entry runs once, ever, per database file, in its own transaction. **Migrations already shipped are never edited** — once `v2` is in a released version, changing its SQL retroactively would desync deployed databases that already ran it; add a new entry instead. Currently: v1 is the original schema (`birthdays` + singleton `settings`), v2 adds the birthday-list/cron/leave-notification columns to `settings` plus `command_settings`, v3 adds the `reaction_role_*` tables, v4 adds `web_sessions`, v5 adds selection types (reactions/buttons/dropdown), plain-text-vs-embed messages, the allow-multiple/removable/allowed-roles/draft-until-sent columns to `reaction_role_panels` (data-migrating the old `mode`/`message_id` into them), and rebuilds `reaction_role_mappings` so `emoji_name` can be `null` (buttons/dropdown options don't require an emoji).

## Schema

### `birthdays`

One row per person per date. Repopulated wholesale on every re-scan (see below) — never partially updated.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `date` | `TEXT NOT NULL` | `DD.MM` format, e.g. `"25.12"`. Indexed (`idx_birthdays_date`). |
| `mention` | `TEXT NOT NULL` | The raw `<@id>` mention or `@name` text as parsed from the announcement. |
| `user_id` | `TEXT` | Discord user ID, if the entry was a real mention (`null` for free-text `@name` entries that didn't resolve to an ID). |
| `name` | `TEXT` | Display name — the live Discord display name if the user was successfully resolved, otherwise whatever name text was parsed from the announcement. |

### `settings`

A single-row table (`id` is `CHECK`-constrained to `1`) rather than a generic key-value store, since there's a small, fixed set of scalar settings and a real schema is simpler than parsing a blob. Every write goes through `updateSettings()` (read-merge-write of the whole row) and emits `SettingsEvent.Settings` on `settingsBus` (`src/services/settingsBus.ts`) so live consumers — the cron scheduler, `birthdayWatcher`, `memberEvents` — pick up the change without a restart.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY CHECK (id = 1)` | Always `1`. |
| `birthday_template` | `TEXT NOT NULL` | The active birthday message template. Seeded with the default from `constants.ts` (`DEFAULT_BIRTHDAY_TEMPLATE`) on first run. |
| `first_birthday_message_id` | `TEXT` | ID of the first message the bot posted in the current announcement "batch" — the anchor the nightly cleanup walks back to. `null` when there's nothing pending cleanup. |
| `birthday_list_channel_id` | `TEXT` | Channel containing the birthday announcement list. `null` on a fresh install until set from the [dashboard](DASHBOARD.md). |
| `birthday_list_message_id` | `TEXT` | Anchor message id within that channel. Same null-until-set/seed behavior as above. |
| `birthday_cron` | `TEXT NOT NULL` | `node-cron` expression for the daily announcement job. Defaults to `DAILY_MIDNIGHT_CRON` (`0 0 * * *`). Changing it live reschedules the job in `src/index.ts` via `settingsBus`. |
| `leave_notifications_enabled` | `INTEGER NOT NULL` (0/1) | Whether `memberEvents.ts` DMs the guild owner on a voluntary leave. Defaults to `1`. |

`getBirthdayListLocation()` (`src/services/birthdays.ts`) wraps the two `birthday_list_*` columns and returns `null` if either is unset — every call site (the cron job, `/refreshbirthdays`, `/clearbirthdaychannel`, `birthdayWatcher`) handles that case explicitly instead of assuming they're always present.

### `command_settings`

Per-command `enabled`/`guildOnly` overrides, set from the dashboard's Commands page. One row per command that's ever been explicitly toggled; a command with no row here uses the code defaults (`enabled: true, guildOnly: true`) via `getCommandOverride()`.

| Column | Type | Notes |
| --- | --- | --- |
| `name` | `TEXT PRIMARY KEY` | Matches `CommandName` in `constants.ts`. |
| `enabled` | `INTEGER NOT NULL DEFAULT 1` | |
| `guild_only` | `INTEGER NOT NULL DEFAULT 1` | |

### `reaction_role_panels` / `reaction_role_mappings`

See [REACTION_ROLES.md](REACTION_ROLES.md) for the feature itself. A panel is a message members interact with to pick roles — either one the bot posts and owns, or one it's attached to after the fact (`managed`, below). Mappings are the options (emoji/button/dropdown entry) shown on it, deleted automatically when the panel is (`ON DELETE CASCADE`).

**`reaction_role_panels`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `channel_id` | `TEXT NOT NULL` | |
| `message_id` | `TEXT` | `null` until a *managed* panel has been sent for the first time; set immediately at creation for an *unmanaged* one (see `managed`). Unique when non-null. |
| `managed` | `INTEGER NOT NULL DEFAULT 1` | `1`: the bot owns the message — posts it, rebuilds it on every change. `0`: attached to a pre-existing message (e.g. an admin's rules post) instead, reactions-only — see [REACTION_ROLES.md § Attaching to an existing message](REACTION_ROLES.md#attaching-to-an-existing-message). Set once at creation via `createPanel()`'s `existingMessageId` and never changed afterward. |
| `selection_type` | `TEXT NOT NULL DEFAULT 'reactions'` | `reactions` / `buttons` / `dropdown` (`SelectionType` in `constants.ts`). Set once at creation, immutable — buttons/dropdown need a bot-owned message, so this can't combine with `managed: 0`. See [REACTION_ROLES.md § Selection types](REACTION_ROLES.md#selection-types). |
| `message_type` | `TEXT NOT NULL DEFAULT 'embed'` | `text` / `embed` (`PanelMessageType` in `constants.ts`). Ignored for an unmanaged panel — there's no message content to render it into. |
| `remove_reaction` | `INTEGER NOT NULL DEFAULT 0` | Reactions-only — see [REACTION_ROLES.md § removeReaction](REACTION_ROLES.md#removereaction-reactions-only). |
| `allow_multiple` | `INTEGER NOT NULL DEFAULT 0` | Off: only one of the panel's roles may be held at a time (picking a new one revokes the previous). On: no limit. Replaces the old `mode` column (still present, unused — see [Migrations](#migrations)). |
| `removable` | `INTEGER NOT NULL DEFAULT 1` | Off: a granted role can never be given up through this panel again (rules-acceptance style). |
| `allowed_role_ids` | `TEXT` | JSON array of role id strings; `null`/empty means everyone may use the panel. Parsed/serialized in `reactionRolesRepository.ts` — there's no separate join table, since it's a small, panel-scoped, order-independent set. |
| `sent` | `INTEGER NOT NULL DEFAULT 0` | Off: a draft — no writes are pushed to Discord (see [REACTION_ROLES.md § Draft, then send](REACTION_ROLES.md#draft-then-send)). Flipped on by `setPanelSent()`, called from the dashboard's/`/reactionroles`'s explicit send action once the first sync succeeds. |
| `title` / `description` | `TEXT` | Both nullable; rendered into the panel's message for a managed panel (title only used for `message_type: embed`). Always `null` for an unmanaged one — there's no message content to render them into, since it's someone else's. |
| `created_at` | `TEXT NOT NULL` | ISO timestamp. |

**`reaction_role_mappings`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `panel_id` | `INTEGER NOT NULL REFERENCES reaction_role_panels(id) ON DELETE CASCADE` | |
| `emoji_name` | `TEXT` | The unicode character itself for standard emoji, or the custom emoji's name. `null` for a buttons/dropdown option with no emoji — a reaction always has one, so this is effectively required only for `selection_type: reactions` (enforced in the API route, not the schema). |
| `emoji_id` | `TEXT` | `null` for unicode emoji, or no emoji at all; the snowflake for custom (guild) emoji. `emoji_id ?? emoji_name` is used throughout as the lookup key, matching discord.js's own `reaction.emoji.id ?? reaction.emoji.name`. |
| `role_id` | `TEXT NOT NULL` | |
| `label` | `TEXT` | Shown next to the role in a reactions panel's message; used as the button/dropdown-option text otherwise (falling back to the role's name if unset). |
| `position` | `INTEGER NOT NULL DEFAULT 0` | Display/seed-reaction order within the panel. |

Unique on `(panel_id, emoji_id, emoji_name)` — one mapping per emoji per panel. SQL `NULL` is never equal to another `NULL` even under a unique index, so this doesn't stop a panel from having any number of emoji-less button/dropdown mappings.

### `web_sessions`

Server-side dashboard login sessions (see [DASHBOARD.md](DASHBOARD.md#who-can-log-in)), referenced by a signed cookie. Every row that exists already passed the owner/guild-owner/Administrator check at login — there's no separate "authenticated but unauthorized" state stored here.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | Random UUID; the value the session cookie holds (signed, not this raw id). |
| `user_id` | `TEXT NOT NULL` | Discord user id. |
| `username` | `TEXT NOT NULL` | Discord username at login time — not kept live-updated. |
| `avatar` | `TEXT` | Avatar hash, or `null`. |
| `is_owner` | `INTEGER NOT NULL` (0/1) | Whether this user is `config.botOwnerId`. |
| `expires_at` | `INTEGER NOT NULL` | Unix ms timestamp. `getSession()` treats an expired row as absent and deletes it lazily; `sweepExpiredSessions()` also runs once at startup. |

## Access pattern

Raw SQL lives in `src/db/`:

- `src/db/index.ts` — opens the connection, runs migrations (see above).
- `src/db/birthdaysRepository.ts` — `getBirthdaysForDate(date)`, `getAllBirthdaysByDate()`, `replaceAllBirthdays(data)` (transactional delete-then-insert).
- `src/db/settingsRepository.ts` — `getSettings()`/`updateSettings(patch)`, `getCommandOverride(name)`/`getAllCommandOverrides()`/`setCommandOverride(name, override)`.
- `src/db/reactionRolesRepository.ts` — panel/mapping CRUD (`listPanels`, `getPanel`, `createPanel`, `updatePanel`, `deletePanel`, `setPanelMessageId`, `upsertMapping`, `deleteMapping`, `reorderMappings`).
- `src/db/sessionsRepository.ts` — `createSession`, `getSession`, `deleteSession`, `sweepExpiredSessions`.

`src/services/*.ts` (business logic) and `src/web/routes/*.ts` (dashboard API handlers) are the only consumers of these repositories; nothing outside `src/db/` writes SQL directly. Repository writes that other parts of the app need to react to live (settings, command overrides, reaction-role panels/mappings) emit an event on the shared `settingsBus` (`src/services/settingsBus.ts`) after writing.

## Inspecting or backing up the database

Since it's a plain SQLite file, any standard tool works. With the bot stopped (to avoid reading mid-write):

```bash
sqlite3 data/bot.sqlite ".tables"
sqlite3 data/bot.sqlite "SELECT * FROM settings;"
sqlite3 data/bot.sqlite "SELECT * FROM birthdays ORDER BY date;"
```

To back up, copy `bot.sqlite`, `bot.sqlite-wal`, and `bot.sqlite-shm` together (or run `sqlite3 data/bot.sqlite ".backup data/backup.sqlite"` to get a consistent snapshot without stopping the bot).

## Why SQLite instead of JSON files

Earlier revisions of this bot stored `birthdays.json`/`settings.json` directly under `data/`. That approach had no atomicity (a crash mid-write could corrupt the file), no indexing, and required loading/reserializing the entire dataset for any single read or write. SQLite with WAL mode gives transactional writes (`replaceAllBirthdays` is one atomic swap) and indexed date lookups, for effectively the same operational footprint (still a single file to back up).
