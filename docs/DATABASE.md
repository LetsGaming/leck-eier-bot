# Database

The bot persists all state in a single SQLite database via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) (synchronous, no ORM). There is no separate migration tool — the schema is created with `CREATE TABLE IF NOT EXISTS` on every startup, so it's safe to delete the database file to reset all state.

## Location

`data/bot.sqlite` at the **project root**, one level above whichever of `src/`/`dist/` is currently running (`src/db/index.ts` resolves this as `path.resolve(__dirname, "..", "..", "data")`). This is consistent whether you run via `npm run dev`, `npm start`, or in Docker.

WAL mode is enabled (`journal_mode = WAL`), so you'll also see `bot.sqlite-wal` and `bot.sqlite-shm` alongside it during normal operation — these are part of the database, not junk files; don't delete them while the bot is running.

The `data/` directory (and therefore the whole database) is git-ignored and Docker-volume-mounted — see [DEPLOYMENT.md](DEPLOYMENT.md).

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

A single-row table (`id` is `CHECK`-constrained to `1`) rather than a generic key-value store, since there are exactly two settings and a real schema is simpler than parsing a blob.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY CHECK (id = 1)` | Always `1`. |
| `birthday_template` | `TEXT NOT NULL` | The active birthday message template. Seeded with the default from `constants.ts` (`DEFAULT_BIRTHDAY_TEMPLATE`) on first run. |
| `first_birthday_message_id` | `TEXT` | ID of the first message the bot posted in the current announcement "batch" — the anchor the nightly cleanup walks back to. `null` when there's nothing pending cleanup. |

## Access pattern

Raw SQL lives in `src/db/`:

- `src/db/index.ts` — opens the connection, creates tables, seeds the default settings row.
- `src/db/birthdaysRepository.ts` — `getBirthdaysForDate(date)`, `getAllBirthdaysByDate()`, `replaceAllBirthdays(data)` (transactional delete-then-insert).
- `src/db/settingsRepository.ts` — `getSettings()`, `updateSettings(patch)`.

`src/services/birthdays.ts` (business logic — parsing, Discord resolution, message building) is the only consumer of these repositories; nothing outside `src/db/` writes SQL directly.

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
