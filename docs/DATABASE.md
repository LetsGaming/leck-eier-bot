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

Each entry runs once, ever, per database file, in its own transaction. **Migrations already shipped are never edited** — once `v2` is in a released version, changing its SQL retroactively would desync deployed databases that already ran it; add a new entry instead. Currently: v1 is the original schema (`birthdays` + singleton `settings`), v2 adds the birthday-list/cron/leave-notification columns to `settings` plus `command_settings`, v3 adds the `reaction_role_*` tables, v4 adds `web_sessions`, v5 adds selection types (reactions/buttons/dropdown), plain-text-vs-embed messages, the allow-multiple/removable/allowed-roles/draft-until-sent columns to `reaction_role_panels` (data-migrating the old `mode`/`message_id` into them), and rebuilds `reaction_role_mappings` so `emoji_name` can be `null` (buttons/dropdown options don't require an emoji); v6 adds the required `name` column to `reaction_role_panels`, backfilled from `title` where one exists; v7 adds `source` to `birthdays` and `birthday_mod_channel_id` to `settings` for self-service birthday registration (see below); v8 adds `role` to `web_sessions` for dashboard RBAC (buggy — see v11); v9 adds the bot-managed-anchor-message columns to `settings` (see below); v10 adds the global `font_map` on `settings` plus each feature's own `*_use_font`/`use_font` opt-in column (see below); v11 backfills `role = 'bot-owner'` for pre-existing sessions with `is_owner = 1` that v8 had incorrectly left at the `role` column's `'admin'` default; v12 turns `birthday_self_registration_enabled` back off wherever `birthday_bot_manages_anchor` is off, now that the two are required to move together; v13 adds `member_records` for the dashboard's Member Audit page (see below); v14 drops the dead `web_sessions.is_owner` `NOT NULL` constraint that had been silently failing every fresh login since v8; v15 adds the register-gate-role columns to `settings`; v16 adds `birthday_anchor_intro`; v17 adds `birthday_anchor_messages` (see below), seeded from `birthday_list_message_id` where bot-managed mode was already active; v18 adds `months` to `birthday_anchor_messages`, letting each chunk stay pinned to the same months across syncs; v19 backfills `birthday_self_registration_enabled`/`birthday_bot_manages_anchor` to `1` now that both are the bot's only mode (the columns themselves are left in the schema, unread — see [Schema § settings](#settings)); v20 adds `rules_accepted_use_discord_screening`, defaulting to role-based detection; v21 replaces `reaction_role_mappings.role_id` with `role_ids` (a JSON array), so a Reactions-panel option can grant more than one role at once.

## Schema

### `birthdays`

One row per person per date. `source = 'list'` rows are added/edited/removed one at a time by an admin from the dashboard's Birthdays page (`web/routes/birthdays.ts`); `source = 'self'` rows (registered via `/setmybirthday` or a message in the birthday channel) are individually upserted by `user_id` instead. Either kind is deleted the moment the member leaves the guild for any reason (voluntary leave, kick, or ban) — see `removeBirthdayOnMemberLeave()` in `services/birthdays.ts`, called from `guildMemberRemove`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `date` | `TEXT NOT NULL` | `DD.MM` format, e.g. `"25.12"`. Indexed (`idx_birthdays_date`). |
| `mention` | `TEXT NOT NULL` | `<@userId>` if the entry has a Discord user id, else `@name`. |
| `user_id` | `TEXT` | Discord user ID, if one was given (`null` for a name-only entry). Uniquely indexed where non-null (`idx_birthdays_user`) so a self-registration can upsert by user, and so an admin can't add a second entry for the same user. |
| `name` | `TEXT` | Display name. |
| `source` | `TEXT NOT NULL DEFAULT 'list'` | `'list'` (admin-managed via the dashboard) or `'self'` (registered directly by the member — see [COMMANDS.md](COMMANDS.md#setmybirthday)). |

### `settings`

A single-row table (`id` is `CHECK`-constrained to `1`) rather than a generic key-value store, since there's a small, fixed set of scalar settings and a real schema is simpler than parsing a blob. Every write goes through `updateSettings()` (read-merge-write of the whole row) and emits `SettingsEvent.Settings` on `settingsBus` (`src/services/settingsBus.ts`) so live consumers — the cron scheduler, `birthdayWatcher`, `memberEvents` — pick up the change without a restart.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY CHECK (id = 1)` | Always `1`. |
| `birthday_template` | `TEXT NOT NULL` | The active birthday message template. Seeded with the default from `constants.ts` (`DEFAULT_BIRTHDAY_TEMPLATE`) on first run. |
| `first_birthday_message_id` | `TEXT` | ID of the first message the bot posted in the current announcement "batch" — the anchor the nightly cleanup walks back to. `null` when there's nothing pending cleanup. |
| `birthday_list_channel_id` | `TEXT` | Channel the bot-managed anchor message chain (and the daily announcement) lives in. `null` on a fresh install until set from the [dashboard](DASHBOARD.md). |
| `birthday_list_message_id` | `TEXT` | Unread since the anchor message became a chain (see `birthday_anchor_messages` below) — kept in the schema rather than dropped, per the additive-only migration policy above. |
| `birthday_cron` | `TEXT NOT NULL` | `node-cron` expression for the daily announcement job. Defaults to `DAILY_MIDNIGHT_CRON` (`0 0 * * *`). Changing it live reschedules the job in `src/index.ts` via `settingsBus`. |
| `birthday_mod_channel_id` | `TEXT` | Channel the bot posts a heads-up to whenever someone self-registers their birthday (`notifyBirthdayRegistration()`). `null` = no notification posted. |
| `birthday_self_registration_enabled` / `birthday_bot_manages_anchor` | `INTEGER NOT NULL` (0/1) | Unread since v19 — self-registration and the bot-managed anchor message are no longer optional, so both columns are just backfilled to `1` and otherwise ignored. Kept rather than dropped, per the additive-only migration policy above. |
| `birthday_anchor_template` | `TEXT NOT NULL` | `{month}`/`{entries}` placeholder template for each month's heading in the bot-managed anchor message. Defaults to `DEFAULT_BIRTHDAY_ANCHOR_TEMPLATE`. |
| `birthday_anchor_intro` | `TEXT` | Shown once above all the month blocks (e.g. "use `/setmybirthday` to register!") — unlike `birthday_anchor_template`, never repeated per month and never rendered through `font_map`. `null` = no intro shown. |
| `font_map` | `TEXT` | A pasted 52-character stylized alphabet (matching `FONT_REFERENCE` in `utils/font.ts` position for position), set once from the dashboard's Settings page and reused by any feature below with its own opt-in flag on — see `applyFont()`. `null` = no font configured. |
| `birthday_anchor_use_font` | `INTEGER NOT NULL` (0/1) | Whether the bot-managed anchor message's `{month}` heading renders through `font_map`. Defaults to `0`. |
| `birthday_announcement_use_font` | `INTEGER NOT NULL` (0/1) | Whether the daily birthday announcement message renders through `font_map`. Defaults to `0`. |
| `leave_notifications_enabled` | `INTEGER NOT NULL` (0/1) | Whether `memberEvents.ts` DMs the guild owner on a voluntary leave. Defaults to `1`. |
| `register_gate_role_id` / `registration_tier_role_id` | `TEXT` | The register-channel role swap — see `Settings` in `src/types.ts`. Unrelated to birthdays. |
| `rules_accepted_use_discord_screening` | `INTEGER NOT NULL` (0/1) | Which signal counts as "rules accepted" for `member_records.rules_accepted_at`. Defaults to `0` (role-based: `register_gate_role_id` newly granted). `1` = Discord's own membership-screening `pending` flag instead — see `recordRulesAcceptedIfJustVerified()` in `services/memberRecords.ts`. |

`syncAnchorMessage()` (`src/services/birthdays.ts`) only needs `birthday_list_channel_id` — it creates the anchor chain itself on first use (see `birthday_anchor_messages` below), and it's the only ingest path left for admin-entered birthdays besides the dashboard's own add/edit/delete on `birthdays` directly.

### `birthday_anchor_messages`

The bot-managed anchor message can outgrow Discord's 2000-character `content` cap, so it's rendered as an ordered chain of messages instead of one. One row per message currently in that chain.

| Column | Type | Notes |
| --- | --- | --- |
| `position` | `INTEGER PRIMARY KEY` | 0-based order within the chain. The whole table is replaced transactionally on every sync (`setAnchorMessageChunks()`), not diffed row by row. |
| `message_id` | `TEXT NOT NULL` | The Discord message id at that position. |
| `months` | `TEXT NOT NULL DEFAULT ''` | Comma-separated content keys this chunk currently renders — `"intro"` and/or month numbers `1`-`12` (added in v18). Read back on the next sync as a stability bias in `paginateAnchorParts()` (`src/services/birthdays.ts`) so a month stays pinned to the message it's already in for as long as it still fits, instead of reflowing into a different message whenever an unrelated month's entry count changes. Empty string (pre-v18 rows) means "unknown", so the first post-upgrade sync has no stability constraint. |

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
| `name` | `TEXT NOT NULL` | Admin-facing label for the dashboard's panel list and `/reactionroles list` — never rendered into the Discord message itself, unlike `title`. Added in v6; existing rows were backfilled from `title` (or a generic placeholder) at migration time. |
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
| `use_font` | `INTEGER NOT NULL DEFAULT 0` | Whether the title, message text, and button/dropdown labels render through `settings.font_map` — see `utils/font.ts` and [DATABASE.md § settings](#settings). |
| `created_at` | `TEXT NOT NULL` | ISO timestamp. |

**`reaction_role_mappings`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `panel_id` | `INTEGER NOT NULL REFERENCES reaction_role_panels(id) ON DELETE CASCADE` | |
| `emoji_name` | `TEXT` | The unicode character itself for standard emoji, or the custom emoji's name. `null` for a buttons/dropdown option with no emoji — a reaction always has one, so this is effectively required only for `selection_type: reactions` (enforced in the API route, not the schema). |
| `emoji_id` | `TEXT` | `null` for unicode emoji, or no emoji at all; the snowflake for custom (guild) emoji. `emoji_id ?? emoji_name` is used throughout as the lookup key, matching discord.js's own `reaction.emoji.id ?? reaction.emoji.name`. |
| `role_ids` | `TEXT NOT NULL` | JSON array of role id strings this option grants — more than one only ever possible on a Reactions panel (enforced in `web/routes/reactionRolePanels.ts`, not here); Buttons/Dropdown are restricted to exactly one. Same JSON-array-in-a-TEXT-column convention as `reaction_role_panels.allowed_role_ids`. Added in v21, replacing the single-role `role_id` column. |
| `label` | `TEXT` | Shown next to the role in a reactions panel's message; used as the button/dropdown-option text otherwise (falling back to the role's name if unset). |
| `position` | `INTEGER NOT NULL DEFAULT 0` | Display/seed-reaction order within the panel. |

Unique on `(panel_id, emoji_id, emoji_name)` — one mapping per emoji per panel. SQL `NULL` is never equal to another `NULL` even under a unique index, so this doesn't stop a panel from having any number of emoji-less button/dropdown mappings.

### `web_sessions`

Server-side dashboard login sessions (see [DASHBOARD.md](DASHBOARD.md#who-can-log-in--rbac)), referenced by a signed cookie. Every row that exists already passed the owner/guild-owner/Administrator check at login — there's no separate "authenticated but unauthorized" state stored here.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | Random UUID; the value the session cookie holds (signed, not this raw id). |
| `user_id` | `TEXT NOT NULL` | Discord user id. |
| `username` | `TEXT NOT NULL` | Discord username at login time — not kept live-updated. |
| `avatar` | `TEXT` | Avatar hash, or `null`. |
| `is_owner` | `INTEGER NOT NULL` (0/1) | Unused since v8 (kept rather than dropped — see the migration notes above); superseded by `role`. |
| `role` | `TEXT NOT NULL DEFAULT 'admin'` | `'bot-owner'`, `'guild-owner'`, or `'admin'` — see `WebRole` in `src/types.ts` and [DASHBOARD.md](DASHBOARD.md#who-can-log-in--rbac). Resolved once at login and fixed for the session's lifetime. |
| `expires_at` | `INTEGER NOT NULL` | Unix ms timestamp. `getSession()` treats an expired row as absent and deletes it lazily; `sweepExpiredSessions()` also runs once at startup. |

### `member_records`

One row per Discord user ever seen in the configured guild, current or former (`in_guild` tells them apart) — backs the dashboard's [Member Audit](DASHBOARD.md#member-audit) page. This one *is* the primary record for a former member — Discord tells the bot nothing more about someone once they've left, so there's no live source of truth to re-derive it from. Every date is recorded live, the moment the corresponding Discord event fires (`src/services/memberRecords.ts`); none of them are backfilled from history except `joined_at`, which Discord does still expose for a current member.

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `TEXT PRIMARY KEY` | Discord user id. |
| `username` | `TEXT NOT NULL` | Snapshotted on every join/profile-update/leave — not kept live for a former member (can't be, there's nothing left to read it from). |
| `display_name` | `TEXT NOT NULL` | Nickname if set, else global name, else username — same precedence `GuildMember#displayName` uses. |
| `avatar` | `TEXT` | Global user avatar hash, or `null`. Only read back for a former member; a current one's avatar is fetched live from the cache instead (fresher, and handles a guild-specific avatar). |
| `joined_at` | `TEXT` | ISO UTC. Backfilled once at every startup (`seedMemberRecordsFromCache()`) for anyone already in the guild, then kept current via `guildMemberAdd`. `null` only if the bot has never observed this user's join at all. |
| `rules_accepted_at` | `TEXT` | ISO UTC. Set the moment a `guildMemberUpdate` shows the configured "rules accepted" signal firing — see `rules_accepted_use_discord_screening` below. Only ever set once (e.g. a later strip-then-regrant of the gate role doesn't overwrite it). No historical equivalent exists — `null` means "not tracked" (e.g. it fired before this shipped, or the role-based signal isn't configured), not "never accepted". |
| `left_at` | `TEXT` | ISO UTC. Set on `guildMemberRemove`. `null` while still in the guild. |
| `in_guild` | `INTEGER NOT NULL DEFAULT 1` (0/1) | `0` once `left_at` is set; flips back to `1` (and `left_at` back to `null`) on a rejoin — `rules_accepted_at` is left alone on a rejoin, since screening isn't redone. |

### `apollo_events` / `apollo_event_signups` / `apollo_event_voice_log`

Backs [EVENT_ATTENDANCE.md](EVENT_ATTENDANCE.md) — see that doc for the full parsing/tracking design. `settings` also gains two columns here: `apollo_event_channel_id` (where the bot watches for Apollo's event embeds) and `event_voice_channel_id` (the one voice channel every tracked event happens in).

`apollo_events` — one row per Apollo event embed, keyed preferably by `apollo_event_id` (parsed from an `apollo.fyi/.../events/<id>` link, nullable) and otherwise by `message_id` (Apollo edits the same message in place as RSVPs change). `status` walks `scheduled -> active -> completed` (or `-> cancelled` if the message is deleted while still `scheduled`). `starts_at`/`ends_at` freeze once `status` leaves `scheduled` — a later Apollo edit mid-event can't move an in-flight measurement's goalposts. `voice_channel_id` snapshots `settings.event_voice_channel_id` at activation. `tracking_incomplete` flags an event the bot was offline for some/all of.

`apollo_event_signups` — one row per signed-up member, with two column groups written by two independent code paths that must never touch each other's columns: **intent** (`raw_name`, `normalized_name`, `choice`, `user_id`, `match_source`, `withdrawn_at`) is rewritten on every re-parse of the Apollo message; **attendance** (`attendance_status`, `first_joined_at`, `last_left_at`) is written only by `finalizeAttendance()`/`recomputeAttendanceForEvent()` in `src/services/eventAttendance.ts`, derived from the voice log. `match_source` is `'auto'` (name/mention resolved automatically), `'manual'` (a dashboard admin linked it — never overwritten by a later re-parse), `'unmatched'`, or `'ambiguous'`.

`apollo_event_voice_log` — an append-only log of every join/leave (plus `present_at_start`/`present_at_end` snapshot rows) in the tracked voice channel while an event is active, for every non-bot member who touches the channel (not just resolved signups, so a manual link made after the fact can still reconstruct real attendance). This is the source of truth; `attendance_status` above is a cache derived from replaying it — see `deriveAttendance()`.

## Access pattern

Raw SQL lives in `src/db/`:

- `src/db/index.ts` — opens the connection, runs migrations (see above).
- `src/db/birthdaysRepository.ts` — `getBirthdaysForDate(date)`, `getAllBirthdaysByDate()`, `insertBirthday(entry)`/`updateBirthdayEntry(id, entry)`/`deleteBirthday(id)` (the dashboard's admin CRUD, all `source = 'list'`), `upsertSelfBirthday(entry)` (insert/update a single `source = 'self'` row by `user_id`).
- `src/db/birthdayAnchorMessagesRepository.ts` — `getAnchorMessageChunks()`/`setAnchorMessageChunks(chunks)` (transactional full replace of `birthday_anchor_messages`).
- `src/db/settingsRepository.ts` — `getSettings()`/`updateSettings(patch)`, `getCommandOverride(name)`/`getAllCommandOverrides()`/`setCommandOverride(name, override)`.
- `src/db/reactionRolesRepository.ts` — panel/mapping CRUD (`listPanels`, `getPanel`, `createPanel`, `updatePanel`, `deletePanel`, `setPanelMessageId`, `upsertMapping`, `deleteMapping`, `reorderMappings`).
- `src/db/sessionsRepository.ts` — `createSession`, `getSession`, `deleteSession`, `sweepExpiredSessions`.
- `src/db/memberRecordsRepository.ts` — `listAllMemberRecords`, `getMemberRecord`, `upsertJoin`, `updateProfile`, `recordRulesAccepted`, `recordLeave`.
- `src/db/eventAttendanceRepository.ts` — event/signup/voice-log CRUD (`upsertApolloEvent`, `listEventsWithSignups`, `listDueScheduledEvents`/`listDueActiveEvents`/`listActiveEvents`, `setEventActive`/`setEventCompleted`/`setEventCancelled`, `replaceEventSignups` (intent only), `linkSignupToUser`, `setSignupAttendance` (attendance only), `appendVoiceLog`, `listVoiceLog`/`listVoiceLogForUser`).

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

Earlier revisions of this bot stored `birthdays.json`/`settings.json` directly under `data/`. That approach had no atomicity (a crash mid-write could corrupt the file), no indexing, and required loading/reserializing the entire dataset for any single read or write. SQLite with WAL mode gives transactional writes and indexed date lookups, for effectively the same operational footprint (still a single file to back up).
