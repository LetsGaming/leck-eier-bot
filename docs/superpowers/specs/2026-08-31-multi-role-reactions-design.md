# Multi-role reaction mappings

## Context

Reaction-role panels currently let one mapping (one emoji, button, or dropdown option) grant exactly one role. The motivating case: a single "rules accepted" ✅ reaction should be able to grant *two* roles at once — a permanent "Rules accepted" role (kept forever, `removable: off`) and an "Unregistered" gate role that a completely separate, already-existing mechanism (`stripRegisterGateRoleIfJustRegistered()` in `events/memberEvents.ts`) removes later when staff manually register the member. That second role's later removal is out of scope here — it already works today for a single gate role and needs no changes; this feature is only about letting *one reaction* grant *more than one role* at once.

Scope, as narrowed during design: multi-role mappings are **Reactions-only**. Buttons and Dropdown options stay exactly one role per option, same as today, for both interaction-shape reasons (a dropdown option's multi-select model already covers "give me several outcomes" by letting a member submit several options) and to keep the change minimal where it isn't asked for.

## Data model

`reaction_role_mappings.role_id TEXT NOT NULL` becomes `role_ids TEXT NOT NULL` — a JSON array of role id strings, following the same convention `reaction_role_panels.allowed_role_ids` already uses. No join table: a mapping's role list is always replaced wholesale on save (create/edit), never diffed row-by-row, so a normalized many-to-many table buys nothing here.

**Migration (v21)**: rename `role_id` → add `role_ids`, backfilling every existing row's single `role_id` as a one-element JSON array (`["<value>"]`), then drop the old column. SQLite has no `ALTER COLUMN`, so this is the standard rebuild-and-swap already used elsewhere in `src/db/index.ts` (see v14's `web_sessions` migration for the pattern).

```sql
CREATE TABLE reaction_role_mappings_v21 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  panel_id INTEGER NOT NULL REFERENCES reaction_role_panels(id) ON DELETE CASCADE,
  emoji_name TEXT,
  emoji_id TEXT,
  role_ids TEXT NOT NULL,
  label TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO reaction_role_mappings_v21 (id, panel_id, emoji_name, emoji_id, role_ids, label, position)
  SELECT id, panel_id, emoji_name, emoji_id, '["' || role_id || '"]', label, position FROM reaction_role_mappings;
DROP TABLE reaction_role_mappings;
ALTER TABLE reaction_role_mappings_v21 RENAME TO reaction_role_mappings;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_map_emoji ON reaction_role_mappings(panel_id, emoji_id, emoji_name);
```

(Role ids are Discord snowflakes — plain digit strings, no embedded quotes — so the naive string-concat JSON build above is safe; still worth a sanity check in the implementation plan rather than taking it on faith.)

## Types

`src/types.ts` and `web/src/types.ts`:

```ts
export interface ReactionRoleMapping {
  // ...unchanged fields...
  roleIds: string[]; // was: roleId: string
}
```

`src/db/reactionRolesRepository.ts`: `MappingRow.role_ids: string`, parsed/serialized with `JSON.parse`/`JSON.stringify` exactly like `allowed_role_ids` already is on `PanelRow`. `UpsertMappingInput.roleIds: string[]`.

## Validation

`validateMappingForPanel()` in `src/web/routes/reactionRolePanels.ts` gains a role-count check:

```ts
function validateMappingForPanel(
  selectionType: SelectionType,
  data: { emojiName: string | null; label: string | null; roleIds: string[] },
): string | null {
  if (data.roleIds.length === 0) return "Pick at least one role.";
  if (selectionType !== SelectionType.Reactions && data.roleIds.length > 1) {
    return "Only a reactions panel can grant more than one role per option.";
  }
  if (selectionType === SelectionType.Reactions) {
    return data.emojiName ? null : "An emoji is required for a reactions panel.";
  }
  return data.label?.trim() ? null : "A label is required for buttons/dropdown options.";
}
```

**Uniqueness ("a role can only ever grant one outcome per panel")** extends from single-id equality to *set overlap*: creating/editing a mapping is rejected if any of its `roleIds` already appears in another mapping on the same panel —

```ts
const overlap = panel.mappings.some(
  (m) => m.id !== mappingId && m.roleIds.some((r) => body.data.roleIds.includes(r)),
);
if (overlap) return reply.code(400).send({ error: "One of those roles is already used by another option on this panel." });
```

`MappingBodySchema.roleId: z.string().min(1)` → `roleIds: z.array(z.string().min(1)).min(1)`.

## Selection logic (`src/services/reactionRoles.ts`)

**Per-role partial application**, confirmed during design: if the bot can manage some but not all of a mapping's configured roles, it applies the change to whichever it can and skips the rest with a logged warning — never an all-or-nothing block. This already matches how `applyDropdownSelection()` treats each *mapping* in a panel independently; here it's applied within a single mapping's role list instead.

`applyMappingSelection()` (shared by reactions and buttons — dropdown continues to use its own `applyDropdownSelection()`):

- "Does the member already have this mapping" (used to decide grant vs. flip-to-revoke) becomes "holds **every** configured role" — if they hold some but not all, treat it as not-yet-granted so the missing ones still get applied on this trigger, rather than treating a partial hold as "fully granted, nothing to do."
- Grant path: loop `mapping.roleIds`, `canManageRole()` per id, `member.roles.add()` for each manageable one, collecting `granted: string[]` and `unmanageable: string[]`.
- Revoke path (flip / `revokeMappingSelection()`): loop `mapping.roleIds`, remove whichever the member currently holds and the bot can manage.
- Reply message construction: `"Gave you: <@&a>, <@&b>."` plus, only if non-empty, `" Couldn't give you: <@&c> (ask an admin)."` — mirrors the shape already used by `applyDropdownSelection()`'s granted/revoked/kept summary.
- The `!panel.allowMultiple` single-role-swap-out logic (revoking *other* mappings' roles before granting this one) is unaffected in shape — it already iterates `panel.mappings` and now just needs to check/revoke each `other.roleIds` instead of a single `other.roleId`.

`revokeMappingSelection()` (un-react path, only reachable when `panel.removable`): same per-role loop, manageability check, and skip-with-warning.

## Rendering (`buildPanelEmbed`, `buildPanelText`, `roleLabel`, `buildButtonRows`, `buildDropdownRow`)

- The role-mention portion of a mapping's line (`<@&${roleId}>`) becomes a comma-joined list: `mapping.roleIds.map(id => `<@&${id}>`).join(", ")`. Buttons/Dropdown still only ever have one id here (enforced above), so this is a no-op for them in practice — it's just no longer special-cased.
- `roleLabel()` (the button/dropdown-label and reactions-line fallback when no custom `label` is set) joins role *names* the same way when there's more than one. Since a custom label is still required for Buttons/Dropdown (unchanged), this fallback path is only ever exercised by Reactions in the multi-role case.

## Dashboard (`web/src/pages/ReactionRoles.tsx`)

- New small shared component (extracted from the existing "Allowed roles" checkbox-list block, which already implements a filtered multi-select over `roles`) — reused for both "Allowed roles" (panel-level) and a mapping's role picker (Reactions panels only).
- The add/edit-mapping form conditionally renders: the new multi-select checkbox list when `panel.selectionType === Reactions`, the existing single `SearchableSelect` (unchanged) for Buttons/Dropdown, backed by the same `roleIds: string[]` state either way (`[picked]` vs. the full checked set).
- `usedRoleIds` (roles already claimed by another mapping, filtered out of the picker) flattens across every mapping's `roleIds` instead of reading a single `roleId` each.
- Panel list / mapping display (`resolveRoleLabel`) and the live message preview (`web/src/components/MessagePreview.tsx`) both join multiple role names the same way the backend's `roleLabel()`/embed builder do (see the "keep in sync by hand" note already in `docs/REACTION_ROLES.md` for why these two implementations aren't shared code).

## Non-goals

- No change to how the *second* role (e.g. "Unregistered") gets removed later — that's the existing, unrelated `stripRegisterGateRoleIfJustRegistered()` mechanism and needs no changes for this feature.
- No per-role `removable`/lifecycle distinction within one mapping — every role in a mapping is granted/revoked together, governed by the panel's existing single `removable`/`allowMultiple`/`removeReaction` settings.
- Dropdown's existing multi-*select* (picking several options in one submission) is unrelated and unchanged — this feature is about one *option* granting several roles, not about selecting several options.

## Testing

No test framework in this repo (confirmed in the birthday-anchor work earlier this session) — verification is manual, plus any pure-function checks scriptable via `npx tsx`:

1. `npm run typecheck` (backend) and `web`'s `tsc --noEmit` clean.
2. Migration v21 runs clean against a copy of the current dev database; existing mappings' `role_ids` come out as `["<original role_id>"]` and still render/function identically to before the migration.
3. Dashboard: create a Reactions panel, add a mapping with 2+ roles via the new picker — saves, sends, and the live message shows both role mentions. Attempt the same on a Buttons/Dropdown panel — rejected with the "only a reactions panel" error.
4. Live Discord: react to a multi-role mapping as a member missing the bot's-manageable-role for one of the two roles (e.g. temporarily reorder roles) — confirm the manageable role is granted, the other is skipped with a warning logged, and the ephemeral/DM-equivalent (for buttons) or no-reply (reactions have no reply channel) behavior matches the "Reply message construction" section above for buttons; for reactions, confirm via role state directly since reactions don't get a reply.
5. Un-react (removable panel) — confirm all held, manageable roles from that mapping are revoked.
6. Existing single-role panels (Buttons, Dropdown, and single-role Reactions) continue to work exactly as before — regression check.
