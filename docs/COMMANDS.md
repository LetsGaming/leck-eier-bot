# Commands

All commands are slash commands, registered globally against `clientId` on startup (see [ARCHITECTURE.md](ARCHITECTURE.md#startup-sequence)). Whether a command is *registered at all*, and whether it's restricted to the configured guild, is controlled per-command in `config.json` — see [CONFIGURATION.md](CONFIGURATION.md#commands-overrides).

## Permission levels

Every command declares a permission level in code (`src/constants.ts`'s `CommandPermission` enum). This is enforced centrally in `src/index.ts` before the command's `execute()` ever runs — see [ARCHITECTURE.md](ARCHITECTURE.md#permission-model).

| Level | Who can run it |
| --- | --- |
| `None` | Anyone (not currently used by any command below). |
| `Admin` | The bot owner (`botOwnerId`), or a member with the Discord **Administrator** permission. |
| `Owner` | The bot owner only. |

## Reference

| Command | Permission | Guild-only by default | Summary |
| --- | --- | --- | --- |
| [`/checkbirthday`](#checkbirthday) | Admin | yes | Preview today's birthdays; optionally trigger the announcement immediately. |
| [`/clearbirthdaychannel`](#clearbirthdaychannel) | Admin | yes | Bulk-delete the bot's tracked messages in the birthday channel. |
| [`/refreshbirthdays`](#refreshbirthdays) | Admin | yes | Re-parse the birthday announcement message(s) into the database. |
| [`/setbirthdaymessage`](#setbirthdaymessage) | Admin | yes | Change the birthday announcement template. |
| [`/testbirthdaymessage`](#testbirthdaymessage) | Admin | yes | Preview the template rendered for yourself. |
| [`/cleardm`](#cleardm) | **Owner** | no | Delete the bot's own DM messages to you, optionally backing them up first. |
| [`/finduser`](#finduser) | Admin | yes | Search cached guild members by name (handles fancy/unicode names). |

"Guild-only by default" means the command only works inside `guildId` unless overridden via `commands.<name>.guildOnly` in `config.json`.

---

### `/checkbirthday`

Manually checks today's birthdays and optionally sends messages.

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `sendmessage` | boolean | no | If `true`, actually sends the birthday message(s) to the channel the command was run in. Defaults to `false` (preview only). |

With no birthdays today, replies with the date of the next upcoming birthday instead. The reply is always ephemeral.

### `/clearbirthdaychannel`

Deletes messages in the birthday announcements channel back to (and including) the first birthday message the bot ever posted, using the same walk-back logic as the nightly cleanup cron job. Reports how many messages were deleted.

### `/refreshbirthdays`

Re-scans the birthday announcement message (`birthdayListMessageId` and its same-author follow-ups) and re-resolves every entry against live Discord member data, replacing the stored birthday list entirely. Run this after editing the announcement message.

### `/setbirthdaymessage`

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `template` | string | yes | The new birthday message template. |

Must include at least `{userMention}` and `{userNick}`; `{everyoneMention}` is optional (expands to `@everyone` when present, causing the daily announcement to ping everyone). Rejected with an error embed if the required placeholders are missing.

### `/testbirthdaymessage`

Renders the current template using your own account as the birthday person, so you can sanity-check formatting without waiting for an actual birthday.

### `/cleardm`

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `save_history` | boolean | no | If `true`, attaches a `.txt` backup of the deleted messages (content + attachment links) before deleting them. |
| `amount` | integer (≥1) | no | Maximum number of messages to delete, oldest-first pagination but newest-first deletion order. Omit to delete all bot messages in the DM. |

Owner-only because it operates on the *command invoker's own DM channel* with the bot — there's no guild context to restrict it to.

### `/finduser`

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `servername` | string | yes | Name (or partial name) to search for. |

Searches username, global display name, server nickname, and server display name from the in-memory member cache (populated on startup — see [ARCHITECTURE.md](ARCHITECTURE.md#member-cache)). Normalizes fancy Unicode lookalike characters (e.g. mathematical bold/italic letters) and transliterates before comparing, so stylized names still match. Returns up to 15 results. If the cache hasn't finished populating yet, replies saying so instead of searching a partial cache.
