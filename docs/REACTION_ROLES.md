# Reaction Roles

Lets members self-assign roles — by reacting to a message, clicking a button, or picking from a dropdown menu. Configured almost entirely from the [dashboard](DASHBOARD.md#reaction-roles); `/reactionroles` in Discord is a read-only fallback (`list`) plus a manual re-sync (`sync`).

## Concepts

A **panel** is one message (`reaction_role_panels`) in a chosen channel that members interact with to pick roles. Each **mapping** (`reaction_role_mappings`) attaches one option (an emoji, a button, or a dropdown entry) to one role on that panel, in a display order.

Every panel has, set once at creation and fixed afterward:

- A **selection type** — how members interact with it. See [Selection types](#selection-types).
- A **message source** — the bot posts and owns the message itself, or it [attaches to one that already exists](#attaching-to-an-existing-message).

And two independent toggles, editable at any time:

- **Allow multiple** (default off) — off, only one of the panel's roles may be held at a time; picking a new one revokes the previous. On, members can hold as many as they like.
- **Removable** (default on) — off, a granted role can never be given up through the panel again (rules-acceptance style). On, members can un-pick it later.

Panels also start as **drafts** and don't touch Discord at all until explicitly sent — see [Draft, then send](#draft-then-send).

## Selection types

| Type | How it works | Requires |
| --- | --- | --- |
| **Reactions** | Members react to the message with a configured emoji. | Nothing extra — works on any message, including [an existing one](#attaching-to-an-existing-message). |
| **Buttons** | Up to 25 buttons (5 per row) under the message, one per role. | A bot-owned message — Discord has no way to attach a component to a message it didn't send. |
| **Dropdown** | A single select menu with up to 25 options under the message. | Same as buttons. |

Buttons and dropdowns are click/submit-based rather than persistent marks on the message, so `removeReaction` (below) doesn't apply to them — every click or menu submission is already a single, self-contained action.

For a **dropdown**, "allow multiple" controls how many options the menu lets you pick in one go (`maxValues`) — picking a new set replaces your previous selection from that panel in a single submission, rather than needing a separate un-pick step. Discord's select menus don't support showing a different "currently selected" state per viewer, so the menu always starts blank regardless of what you already hold; submitting it still applies correctly against your real roles.

## `removeReaction` (reactions only)

When on, the bot strips the user's own reaction immediately after acting, so the visible count never goes above 1 (the bot's own seed reaction). Since un-reacting can then never be observed as a distinct event, reacting again **flips** the role on/off instead of granting it a second time. When off (the default), reacting only grants — revoking happens by un-reacting instead, same as with the persistent reaction left in place.

Turning this on requires the bot to have **Manage Messages** in the panel's channel (needed to remove *other users'* reactions — a bot can always remove its own). If it doesn't, the role change still happens but the reaction is left in place and a warning is logged.

## Restricting who can use a panel

A panel can optionally be limited to members holding at least one of a chosen set of roles ("Allowed roles" on the dashboard) — e.g. only letting existing members assign color roles, or gating a panel behind a verification role. Leave it empty for everyone. Anyone else's interaction is rejected: for reactions, their reaction is silently removed; for buttons/dropdowns, they get an ephemeral "you don't have permission" reply.

## Draft, then send

A new panel starts as a **draft**: saving it, and every edit to its settings or roles, only ever touches the database — nothing is posted to or changed on Discord. This lets you fully configure a panel (message type, roles, permissions) before anyone can see or interact with it. Click **Send** when it's ready; that's the one action that actually posts the message (or, for an attached-existing-message panel, adds the seed reactions to it) and flips the panel to **sent**.

After that first send, editing behaves like you'd expect: every change re-syncs the live message automatically, same as `/reactionroles sync` does manually. The `/reactionroles sync` command and the dashboard's manual re-sync only work on already-sent panels — a draft has nothing on Discord yet to re-sync.

This is the `sent` column on `reaction_role_panels`. Reaction/button/dropdown events are also ignored for an unsent panel, which matters specifically for [an attached existing message](#attaching-to-an-existing-message): that message may already have real reactions on it (e.g. years of history on an old rules post) that shouldn't start granting roles the moment you attach a panel to it, before you've finished configuring mappings and permissions.

## Attaching to an existing message

Instead of the bot posting its own message, a **reactions** panel can attach to one that already exists — the classic case being rules-acceptance: an admin writes the rules as a normal message, and reacting to it (e.g. with ✅) grants a "Member" role, typically with **removable off** so un-reacting doesn't revoke it.

Pick "Attach to an existing message" when creating a panel on the dashboard (only offered for the Reactions selection type — see [Selection types](#selection-types) for why) and give it the message's ID (right-click the message in Discord → Copy Message ID, with Developer Mode enabled under User Settings → Advanced). The channel field is set from wherever that message is and can't be changed afterward — the message doesn't move, so neither does the panel that's watching it.

This is the `managed` column on `reaction_role_panels` (`false` for an attached message, `true` for the default bot-posted kind — see [DATABASE.md](DATABASE.md#reaction_role_panels--reaction_role_mappings)) and it's fixed for the panel's lifetime: there's no "convert" path, only "create it this way from the start." Concretely, `managed: false` changes three things:

- **The message content is never touched.** No embed or text body is built or posted; `syncPanelMessage()` only fetches the message to confirm it still exists and reconciles reactions on it. Title/description aren't stored for this kind of panel — there's nothing to render them into.
- **Only reactions are managed, not the message itself.** The bot still adds/removes its own seed reactions to match the configured mappings (same as a managed panel), so `removeReaction`, allow-multiple/removable, allowed roles, and role-manageability checks all work identically either way.
- **Deleting the panel never deletes the message.** It's not the bot's to delete — only the DB row (and the panel's own reactions, best-effort) go away; the admin's original message is untouched.

## Requirements

- **Manage Roles**, and the bot's highest role positioned **above** every role a panel assigns. This is re-checked on every interaction and by the dashboard (roles you can't currently assign are marked "not assignable" in the role picker) — see `canManageRole()` in `src/services/reactionRoles.ts`.
- **Manage Messages** in the panel's channel, only if any reactions panel on it uses `removeReaction` or has allow-multiple off (both remove other users' reactions).
- The `GuildMessageReactions` gateway intent and `Message`/`Channel`/`Reaction`/`User` partials, both already enabled in `src/index.ts` — required so reactions on messages older than the bot's cache (e.g. added while the bot was offline) still fire events instead of being silently dropped.

## Dashboard workflow

On `/reaction-roles`: pick **+ New panel**, choose the selection type, choose whether the bot posts a new message or [attaches to an existing one](#attaching-to-an-existing-message) (reactions only), set the rest of the panel's settings, and create it — this saves a **draft**, nothing posted yet. Add roles one at a time (emoji and/or role and/or label, depending on selection type); each add/remove/reorder immediately saves to the DB and, once the panel has been sent, also re-syncs the live Discord message. When you're happy with it, click **Send**.

Deleting a panel also deletes its Discord message — but only for a bot-posted (`managed`) panel; deleting one attached to an existing message leaves that message alone (best-effort either way — a manually-deleted message doesn't block the DB delete).

## `/reactionroles`

| Subcommand | What it does |
| --- | --- |
| `list` | Ephemeral embed listing every panel — id, selection type, flags (multiple roles / not removable / clears reactions / **DRAFT**), channel, a jump link (once sent), and its options→role mappings. |
| `sync` | Re-runs `syncPanelMessage()` for every **sent** panel: re-posts if the message is missing, edits the message if present, and reconciles seed reactions for reactions-type panels. Draft panels are skipped — use the dashboard's Send button for those. Useful after someone manually deletes a reaction or the panel message. |

Both require Admin permission, same as the birthday commands.

## How it works (for developers)

- **Storage**: `src/db/reactionRolesRepository.ts`, following the same prepared-statement/row-mapper pattern as `birthdaysRepository.ts`. Every write emits `SettingsEvent.ReactionRoles` on the shared `settingsBus` (`src/services/settingsBus.ts`).
- **In-memory cache**: `src/services/reactionRoles.ts` keeps a `Map<messageId, panel+mappings>`, rebuilt lazily and invalidated on that same event — so handling an interaction never hits SQLite on the hot path.
- **Event flow**: `src/events/reactionRoleEvents.ts` wires `messageReactionAdd`/`Remove` and, via a second `interactionCreate` listener alongside the slash-command dispatcher in `index.ts`, button/select-menu interactions (`customId` prefixed `rr:`) to handlers in the service. All resolve partials/fetch what they need first, look up the panel by message id, and no-op immediately for bot reactors, unrelated messages, or a panel that isn't `sent` yet.
- **Shared role logic**: `applyMappingSelection()` is the single place the allow-multiple/removable rules live, used by reactions (both the flip case, when `removeReaction` is on, and the grant-only case) and by button clicks (always a flip). Dropdown submissions go through the separate `applyDropdownSelection()` instead, since a select menu submits the member's *complete* new choice every time rather than one option at a time — it reconciles that target set against current role membership in one pass, honoring `removable` per-role rather than needing a flip flag at all.
- **Self-echo suppression** (reactions only): a single-role swap or a `removeReaction` panel both make the bot remove a *user's* reaction, which fires a real `messageReactionRemove` for that user. A short-lived `Map` of `messageId:userId:emojiKey` (10s TTL, `REACTION_SELF_ECHO_TTL_MS` in `constants.ts`) marks removals the bot itself initiated so the resulting event is treated as already-handled instead of triggering a second revoke.
- **Per-user serialization**: a promise-chain keyed by `messageId:userId` (`runSerialized()`) so rapid clicking/reacting can't interleave two concurrent grant/revoke operations for the same person.
- **Building the message**: `buildPanelContent()` returns plain text or an embed depending on `messageType`, always specifying *both* `content` and `embeds` explicitly (even when one is empty/null) so switching type on an edit fully replaces the old content instead of Discord leaving a stale field in place. `buildComponents()` builds the button rows or the select-menu row for `selectionType: buttons | dropdown`; reactions get no components. `reconcilePanelReactions()` (reactions only) diffs the bot's own reactions against the current mapping list and adds/removes to match, in `position` order.
- **Posting/syncing**: `syncPanelMessage()` branches on `panel.managed` (post/edit vs. just fetch-and-verify an attached message), then reconciles reactions if the selection type calls for it. Called on every panel/mapping write *once the panel is `sent`* (draft panels are skipped — see `trySync()` in `src/web/routes/reactionRolePanels.ts`), by the explicit `POST .../send` route (which also flips `sent`), by `/reactionroles sync`, and once for every sent panel on `clientReady` (so a restart self-heals any reactions someone removed while the bot was offline).
