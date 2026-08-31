# Commands

All commands are slash commands, registered globally against `clientId` on startup (see [ARCHITECTURE.md](ARCHITECTURE.md#startup-sequence)). Whether a command is *registered at all*, and whether it's restricted to the configured guild, is controlled per-command from the [dashboard's Commands page](DASHBOARD.md#pages) (`command_settings` table — see [DATABASE.md](DATABASE.md#command_settings)).

## Permission levels

Every command declares a permission level in code (`src/constants.ts`'s `CommandPermission` enum). This is enforced centrally in `src/index.ts` before the command's `execute()` ever runs — see [ARCHITECTURE.md](ARCHITECTURE.md#permission-model).

| Level | Who can run it |
| --- | --- |
| `None` | Anyone. |
| `Admin` | The bot owner (`botOwnerId`), or a member with the Discord **Administrator** permission. |
| `Owner` | The bot owner only. |

## Reference

| Command | Permission | Guild-only by default | Summary |
| --- | --- | --- | --- |
| [`/checkbirthday`](#checkbirthday) | Admin | yes | Preview today's birthdays; optionally trigger the announcement immediately. |
| [`/clearbirthdaychannel`](#clearbirthdaychannel) | Admin | yes | Bulk-delete the bot's tracked messages in the birthday channel (never touches the anchor message chain). |
| [`/setbirthdaymessage`](#setbirthdaymessage) | Admin | yes | Change the birthday announcement template. |
| [`/testbirthdaymessage`](#testbirthdaymessage) | Admin | yes | Preview the template rendered for yourself. |
| [`/setmybirthday`](#setmybirthday) | None | yes | Register your own birthday. |
| [`/cleardm`](#cleardm) | **Owner** | no | Delete the bot's own DM messages to you, optionally backing them up first. |
| [`/clear`](#clear) | Admin | yes | Bulk-delete a given number of messages in the current channel, batching past Discord's 100-per-request limit. |
| [`/finduser`](#finduser) | Admin | yes | Search cached guild members by name (handles fancy/unicode names). |
| [`/reactionroles`](#reactionroles) | Admin | yes | List reaction-role panels, or re-sync them with Discord. Full editing lives on the [dashboard](DASHBOARD.md). |

"Guild-only by default" means the command only works inside `guildId` unless overridden from the dashboard's Commands page.

---

### `/checkbirthday`

Manually checks today's birthdays and optionally sends messages.

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `sendmessage` | boolean | no | If `true`, actually sends the birthday message(s) to the channel the command was run in. Defaults to `false` (preview only). |

With no birthdays today, replies with the date of the next upcoming birthday instead. The reply is always ephemeral.

### `/clearbirthdaychannel`

Deletes messages in the birthday announcements channel back to (and including) the first birthday message the bot ever posted, using the same walk-back logic as the nightly cleanup cron job — every message currently in the bot-managed anchor chain is skipped regardless of where it falls in that range. Reports how many messages were deleted.

### `/setbirthdaymessage`

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `template` | string | yes | The new birthday message template. |

Must include at least `{userMention}` and `{userNick}`; `{everyoneMention}` is optional (expands to `@everyone` when present, causing the daily announcement to ping everyone). Rejected with an error embed if the required placeholders are missing.

### `/testbirthdaymessage`

Renders the current template using your own account as the birthday person, so you can sanity-check formatting without waiting for an actual birthday.

### `/setmybirthday`

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `day` | integer (1–31) | yes | Day of month. |
| `month` | integer (1–12) | yes | Month. |

Registers (or updates) your own birthday, stored separately from admin-managed entries (`source: 'self'` vs `'list'` — see [DATABASE.md](DATABASE.md#birthdays)) so editing the list from the dashboard never overwrites it. Posting a bare date (e.g. `15.03`) directly as a message in the configured birthday channel does the same thing: the bot parses it, saves it, and deletes the message. Either way, if a notifications channel is configured on the dashboard's Birthdays page, the bot posts a heads-up there, and the anchor message is re-rendered immediately — see [DASHBOARD.md](DASHBOARD.md#self-registration--the-bot-managed-anchor-message).

### `/cleardm`

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `save_history` | boolean | no | If `true`, attaches a `.txt` backup of the deleted messages (content + attachment links) before deleting them. |
| `amount` | integer (≥1) | no | Maximum number of messages to delete, oldest-first pagination but newest-first deletion order. Omit to delete all bot messages in the DM. |

Owner-only because it operates on the *command invoker's own DM channel* with the bot — there's no guild context to restrict it to.

### `/clear`

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `amount` | integer (1–1000) | yes | How many messages to delete in the channel the command was run in. |

Discord's own bulk-delete endpoint caps out at 100 messages per call and refuses to touch anything older than 14 days. `/clear` works around both: it fetches and bulk-deletes in batches of up to 100 until `amount` is reached, and falls back to deleting messages older than 14 days one at a time (rate-limited) since those can't be bulk-deleted at all. Requires the bot to have **Manage Messages** in that channel — checked upfront with a clear error if missing, rather than failing partway through.

### `/finduser`

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `servername` | string | yes | Name (or partial name) to search for. |

Searches username, global display name, server nickname, and server display name from the in-memory member cache (populated on startup — see [ARCHITECTURE.md](ARCHITECTURE.md#member-cache)). Normalizes fancy Unicode lookalike characters (e.g. mathematical bold/italic letters) and transliterates before comparing, so stylized names still match. Returns up to 15 results. If the cache hasn't finished populating yet, replies saying so instead of searching a partial cache.

### `/reactionroles`

| Subcommand | Description |
| --- | --- |
| `list` | Ephemeral embed of every panel — mode, channel, jump link, and its emoji→role mappings. |
| `sync` | Re-posts/edits every panel's message and reconciles its seed reactions with Discord. |

Panels themselves (selection type, channel, allow-multiple/removable, `removeReaction`, allowed roles, and their mappings) are created and edited on the [dashboard](DASHBOARD.md#reaction-roles) — see [REACTION_ROLES.md](REACTION_ROLES.md) for the feature itself.
