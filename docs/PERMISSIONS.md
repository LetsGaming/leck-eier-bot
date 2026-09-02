# Bot permissions & intents

Everything the bot's Discord application needs enabled, in one place — both the **Privileged Gateway Intents** toggled in the [Developer Portal](https://discord.com/developers/applications) and the **bot permissions** granted when it's invited to (or re-authorized on) a server. Out of date after adding a feature that needs a new one of either — see [DEVELOPMENT.md](DEVELOPMENT.md) for where those live in code.

## Privileged Gateway Intents

Portal → your application → **Bot** page → **Privileged Gateway Intents**. These aren't part of the invite link — they're a separate switch the application owner has to flip once. If either is off, the bot fails to connect at all (Discord rejects the gateway session outright, since `src/index.ts` always requests both).

| Intent | Why |
| --- | --- |
| **Server Members Intent** | `GatewayIntentBits.GuildMembers` — the member cache, join/leave tracking, Member Audit. |
| **Message Content Intent** | `GatewayIntentBits.MessageContent` — reading the *text* of messages in the birthday channel (self-registration) and the register channel (registration-form parsing). Without it, message events still fire but `message.content` arrives empty. |

`GatewayIntentBits.GuildVoiceStates` is also requested (event attendance tracking — `events/apolloEventWatcher.ts`) but is **not** privileged, so it needs no Developer Portal toggle and isn't in the table above.

## Bot permissions (invite / re-authorize)

| Permission | Why | Where |
| --- | --- | --- |
| **View Channels** | Baseline — see any channel it needs to act in. Includes the configured event voice channel — without this on it, the bot can't see who's inside it at all, and event attendance silently never tracks. | everywhere |
| **Send Messages** | Replies, embeds, the birthday anchor message, reaction-role panels. | everywhere |
| **Embed Links** | Every embed the bot posts (errors/success replies, birthday anchor, reaction-role panels). | `utils/embedUtils.ts`, `services/reactionRoles.ts` |
| **Add Reactions** | Seeding a reactions-panel's emoji on its message. | `services/reactionRoles.ts` |
| **Read Message History** | `/clear`'s bulk-delete fetch, birthday self-registration/anchor message lookups. | `commands/general/clear.ts`, `services/birthdays.ts` |
| **Manage Messages** | Deleting messages (`/clear`, `/cleardm`, birthday self-registration cleanup) and stripping *other users'* reactions on a `removeReaction`/single-choice panel. | `commands/general/clear.ts`, `services/birthdays.ts`, `services/reactionRoles.ts` |
| **Manage Roles** | Granting/revoking reaction-role mappings and the register-gate role swap. Also needs the bot's highest role positioned **above** every role it's asked to assign — see [REACTION_ROLES.md § Requirements](REACTION_ROLES.md#requirements). | `services/reactionRoles.ts`, `events/memberEvents.ts` |
| **Manage Nicknames** | Setting a member's nickname from their register-form submission. Also needs the bot's highest role **above** the member's — Discord silently can't nickname someone with an equal/higher role, including the server owner. | `events/registerWatcher.ts` |
| **Create Private Threads** | The private per-member thread the register-form flow posts its confirmation note in. **Requires the server to be at Boost Level 2** — without it, Discord rejects thread creation regardless of this permission being granted. | `events/registerWatcher.ts` |
| **Send Messages in Threads** | Posting the confirmation note into that private thread. | `events/registerWatcher.ts` |

**Newly required as of the self-service registration feature:** Manage Nicknames, Create Private Threads, Send Messages in Threads. If the bot was invited before that feature shipped, it won't have these yet — see below.

## Updating an already-invited bot

Two ways to grant the new permissions to a bot already sitting in your server — either works, nothing needs re-inviting/kicking:

- **Fastest:** Server Settings → Roles → the bot's own role → toggle on **Manage Nicknames**, **Create Private Threads**, **Send Messages in Threads** (and anything else missing from the table above).
- **Via a fresh invite link:** generate a new URL below and open it — Discord recognizes the bot is already in the server and just prompts to update its permissions, it doesn't add a duplicate or reset any configuration.

## Invite link

Generate one in the Developer Portal (**OAuth2 → URL Generator**, scopes `bot` + `applications.commands`, then check the permissions from the table above), or use this pre-built one — replace `YOUR_CLIENT_ID` with `DISCORD_CLIENT_ID` from `.env`:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=344000130112
```

`permissions=344000130112` is the full table above as a single Discord permissions integer.
