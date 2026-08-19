# Reaction Roles

Lets members self-assign roles by reacting to a message the bot posts and maintains. Configured almost entirely from the [dashboard](DASHBOARD.md#reaction-roles); `/reactionroles` in Discord is a read-only fallback (`list`) plus a manual re-sync (`sync`).

## Concepts

A **panel** is one message the bot owns (`reaction_role_panels`), posted in a chosen channel, with an embed listing its options. Each **mapping** (`reaction_role_mappings`) attaches one emoji to one role on that panel, in a display order.

### Modes

| Mode | Reacting | Un-reacting |
| --- | --- | --- |
| **Toggle** | Grants the role | Revokes the role |
| **Unique** | Grants the role *and* revokes every other role/reaction the member holds on that panel | Revokes the role |
| **Verify** | Grants the role | Does nothing — add-only, for rules-acceptance/one-way opt-ins |

### `removeReaction`

An independent checkbox, combinable with any mode. When on, the bot strips the user's reaction immediately after acting, so the visible count never goes above 1 (the bot's own seed reaction). Since un-reacting can then never be observed as a distinct event, it changes what "reacting again" means:

| Mode | `removeReaction: false` (default) | `removeReaction: true` |
| --- | --- | --- |
| Toggle | React grants, un-react revokes | Each react **flips** the role on/off |
| Unique | React grants + revokes the panel's other roles/reactions; un-react revokes | React grants + revokes others; re-reacting the currently-held option revokes it |
| Verify | React grants; un-react ignored | React grants; nothing else — re-reacting does not toggle it off |

Turning this on requires the bot to have **Manage Messages** in the panel's channel (needed to remove *other users'* reactions — a bot can always remove its own). If it doesn't, the role change still happens but the reaction is left in place and a warning is logged.

## Requirements

- **Manage Roles**, and the bot's highest role positioned **above** every role a panel assigns. This is re-checked both when a reaction comes in and by the dashboard (roles you can't currently assign are marked "not assignable" in the role picker) — see `canManageRole()` in `src/services/reactionRoles.ts`.
- **Manage Messages** in the panel's channel, only if any panel on it uses `removeReaction` or **Unique** mode (both remove other users' reactions).
- The `GuildMessageReactions` gateway intent and `Message`/`Channel`/`Reaction`/`User` partials, both already enabled in `src/index.ts` — required so reactions on messages older than the bot's cache (e.g. added while the bot was offline) still fire events instead of being silently dropped.

## Dashboard workflow

On `/reaction-roles`: pick **+ New panel**, choose a channel/mode/`removeReaction`, save — this posts the panel message. Then add roles one at a time (emoji + role + optional label); each add/remove/reorder immediately calls the API, updates the DB, and re-syncs the live Discord message and its seed reactions. There's no separate "publish" step.

Deleting a panel also deletes its Discord message (best-effort — a manually-deleted message doesn't block the DB delete).

## `/reactionroles`

| Subcommand | What it does |
| --- | --- |
| `list` | Ephemeral embed listing every panel — id, mode, channel, a jump link (once posted), and its emoji→role mappings. |
| `sync` | Re-runs `syncPanelMessage()` for every panel: re-posts if the message is missing, edits the embed if present, and reconciles seed reactions (adds missing ones, removes stale ones). Useful after someone manually deletes a reaction or the panel message. |

Both require Admin permission, same as the birthday commands.

## How it works (for developers)

- **Storage**: `src/db/reactionRolesRepository.ts`, following the same prepared-statement/row-mapper pattern as `birthdaysRepository.ts`. Every write emits `SettingsEvent.ReactionRoles` on the shared `settingsBus` (`src/services/settingsBus.ts`).
- **In-memory cache**: `src/services/reactionRoles.ts` keeps a `Map<messageId, panel+mappings>`, rebuilt lazily and invalidated on that same event — so handling a reaction never hits SQLite on the hot path.
- **Event flow**: `src/events/reactionRoleEvents.ts` wires `messageReactionAdd`/`Remove` to `handleReactionAdd`/`handleReactionRemove` in the service. Both resolve partials first (`reaction.fetch()`, `user.fetch()`, `message.fetch()` as needed), look up the panel by message id, and no-op immediately for bot reactors or unrelated messages.
- **Self-echo suppression**: Unique-mode swaps and `removeReaction` both make the bot remove a *user's* reaction, which fires a real `messageReactionRemove` for that user. A short-lived `Map` of `messageId:userId:emojiKey` (10s TTL, `REACTION_SELF_ECHO_TTL_MS` in `constants.ts`) marks removals the bot itself initiated so the resulting event is treated as already-handled instead of triggering a second revoke.
- **Per-user serialization**: a promise-chain keyed by `messageId:userId` (`runSerialized()`) so rapid clicking can't interleave two concurrent grant/revoke operations for the same person.
- **Posting/syncing**: `syncPanelMessage()` builds the embed (`buildPanelEmbed()`, reusing `utils/embedUtils.ts`'s `createEmbed`), posts or edits the message, then `reconcilePanelReactions()` diffs the bot's own reactions against the current mapping list and adds/removes to match, in `position` order. Called on every panel write, by `/reactionroles sync`, and once for every panel on `clientReady` (so a restart self-heals any reactions someone removed while the bot was offline).
