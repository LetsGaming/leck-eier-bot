# Multi-role Reaction Mappings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single reaction-role mapping on a **Reactions** panel grant more than one role at once (e.g. one ✅ granting both "Rules accepted" and "Unregistered"), while Buttons and Dropdown mappings stay exactly one role per option, same as today.

**Architecture:** `reaction_role_mappings.role_id` (single string) becomes `role_ids` (JSON array), following the same JSON-array-in-a-TEXT-column convention `reaction_role_panels.allowed_role_ids` already uses. Every consumer — the repository, the API's create/edit routes, the reaction/button/dropdown selection handlers, the embed/button/dropdown renderers, and the dashboard's mapping form — is updated to work over an array instead of a scalar. Buttons/Dropdown are restricted to exactly one entry in that array by validation, not by a separate schema.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, discord.js v14, React + Vite (dashboard). No test framework in this repo — every task's verification is `tsc --noEmit` / a production `vite build` / a short `npx tsx` script exercising the pure logic / a manual dashboard-or-Discord check, matching how this repo has been verified earlier this session (see the birthday-anchor and rules-acceptance work).

**Spec:** `docs/superpowers/specs/2026-08-31-multi-role-reactions-design.md`

## Global Constraints

- Multi-role mappings are **Reactions-only**. Buttons and Dropdown mappings must have exactly one role id — enforced in `validateMappingForPanel()` (`src/web/routes/reactionRolePanels.ts`), not by a different schema.
- **Partial application, never all-or-nothing**: when a mapping's configured roles include some the bot can't currently manage, grant/revoke whichever it can and skip the rest with a logged warning — confirmed during design (see spec's "Selection logic" section).
- A role may still only ever appear in **one** mapping per panel — the uniqueness check extends from single-id equality to array-overlap.
- SQLite has no `ALTER COLUMN`; changing `role_id`'s type requires the rebuild-and-swap pattern already used by migration v14 in `src/db/index.ts` (`web_sessions`), not a plain `ALTER TABLE ADD COLUMN`.
- Every step that touches `.ts`/`.tsx` files must leave `npx tsc --noEmit` (backend, run from repo root) and `npx tsc --noEmit -p .` (frontend, run from `web/`) clean — both are checked at the end of every task below.

---

### Task 1: Database migration — `role_id` → `role_ids`

**Files:**
- Modify: `src/db/index.ts` (append migration v21 to the `MIGRATIONS` array, after the existing v20 entry)

**Interfaces:**
- Produces: `reaction_role_mappings.role_ids TEXT NOT NULL` (JSON array string), replacing `role_id TEXT NOT NULL`. `idx_rr_map_emoji` unique index on `(panel_id, emoji_id, emoji_name)` is recreated identically.

- [ ] **Step 1: Write the migration**

Open `src/db/index.ts`. Find the end of the `MIGRATIONS` array — it currently ends with the v20 entry:

```ts
  (d) => {
    d.exec(`ALTER TABLE settings ADD COLUMN rules_accepted_use_discord_screening INTEGER NOT NULL DEFAULT 0;`);
  },
];
```

Insert a new entry **before** the closing `];`, so it becomes v21:

```ts
  (d) => {
    d.exec(`ALTER TABLE settings ADD COLUMN rules_accepted_use_discord_screening INTEGER NOT NULL DEFAULT 0;`);
  },
  // v21: a reaction-role mapping can now grant more than one role at once
  // (Reactions panels only — enforced in web/routes/reactionRolePanels.ts,
  // not here) — e.g. one checkmark granting both a permanent "rules
  // accepted" role and a separate "unregistered" gate role that a different,
  // unrelated mechanism removes later. `role_id` (one role) becomes
  // `role_ids` (a JSON array of roles), the same JSON-array-in-a-TEXT-column
  // convention `allowed_role_ids` already uses on reaction_role_panels.
  // SQLite has no ALTER COLUMN, so this is the standard rebuild-and-swap
  // (see v14's web_sessions migration for the same pattern) rather than a
  // plain ADD COLUMN — every existing row's single role_id is preserved as
  // a one-element array.
  (d) => {
    d.exec(`
      CREATE TABLE reaction_role_mappings_v21 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        panel_id INTEGER NOT NULL REFERENCES reaction_role_panels(id) ON DELETE CASCADE,
        emoji_name TEXT,
        emoji_id TEXT,
        role_ids TEXT NOT NULL,
        label TEXT,
        position INTEGER NOT NULL DEFAULT 0
      );
    `);
    const rows = d.prepare("SELECT id, role_id FROM reaction_role_mappings").all() as Array<{
      id: number;
      role_id: string;
    }>;
    const insertStmt = d.prepare(
      "INSERT INTO reaction_role_mappings_v21 (id, panel_id, emoji_name, emoji_id, role_ids, label, position) SELECT id, panel_id, emoji_name, emoji_id, ?, label, position FROM reaction_role_mappings WHERE id = ?",
    );
    for (const row of rows) {
      insertStmt.run(JSON.stringify([row.role_id]), row.id);
    }
    d.exec(`
      DROP TABLE reaction_role_mappings;
      ALTER TABLE reaction_role_mappings_v21 RENAME TO reaction_role_mappings;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_map_emoji
        ON reaction_role_mappings(panel_id, emoji_id, emoji_name);
    `);
  },
];
```

Using `JSON.stringify` per-row (via a prepared statement + JS loop) instead of raw SQL string concatenation avoids any edge case with characters that would need escaping in a role id, even though Discord snowflakes are always plain digits in practice.

- [ ] **Step 2: Verify the migration runs clean**

```bash
cp data/bot.sqlite /tmp/bot-pre-v21.sqlite 2>/dev/null || true   # optional backup if the file exists
npx tsx -e "import './src/db/index.js'; console.log('migrated OK');"
```

Expected: prints `migrated OK` with no errors. If `data/bot.sqlite` doesn't exist yet, this creates a fresh one at the latest version — that's fine, there's nothing to migrate.

- [ ] **Step 3: Confirm the schema and data**

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/bot.sqlite');
console.log('user_version:', db.pragma('user_version', {simple:true}));
console.log(db.prepare(\"SELECT sql FROM sqlite_master WHERE name='reaction_role_mappings'\").get());
console.log(db.prepare('SELECT id, role_ids FROM reaction_role_mappings LIMIT 5').all());
"
```

Expected: `user_version` is `21`; the table's `sql` shows `role_ids TEXT NOT NULL` (no `role_id` column); any existing rows show `role_ids` as a JSON array string like `["123456789012345678"]`.

- [ ] **Step 4: Run the backend typecheck (expected to fail — later tasks fix it)**

```bash
npx tsc --noEmit
```

Expected: errors from `src/db/reactionRolesRepository.ts` and `src/services/reactionRoles.ts` referencing `role_id`/`roleId` against the now-changed schema. This is expected at this point in the plan — Task 2 fixes the repository, Task 3/4/5 fix the rest. Do not attempt to fix them in this task.

- [ ] **Step 5: Commit**

```bash
git add src/db/index.ts
git commit -m "feat(db): migrate reaction_role_mappings.role_id to a role_ids array"
```

---

### Task 2: Backend types + repository

**Files:**
- Modify: `src/types.ts:76-87` (`ReactionRoleMapping` interface)
- Modify: `src/db/reactionRolesRepository.ts`

**Interfaces:**
- Consumes: `reaction_role_mappings.role_ids TEXT NOT NULL` (JSON array) from Task 1.
- Produces: `ReactionRoleMapping.roleIds: string[]`; `UpsertMappingInput.roleIds: string[]` on `upsertMapping()`.

- [ ] **Step 1: Update the `ReactionRoleMapping` type**

In `src/types.ts`, find:

```ts
export interface ReactionRoleMapping {
  id: number;
  panelId: number;
  /** Unicode emoji character, or a custom emoji's name. Null for a buttons/dropdown mapping with no emoji — a reaction always has one. */
  emojiName: string | null;
  /** Set only for custom (guild) emoji; null for unicode emoji or no emoji at all. */
  emojiId: string | null;
  roleId: string;
  label: string | null;
  position: number;
}
```

Replace the `roleId` line:

```ts
  /** One or more roles this option grants. Multiple roles are only ever possible on a Reactions panel — Buttons/Dropdown mappings are restricted to exactly one, enforced in web/routes/reactionRolePanels.ts, not here. Always non-empty. */
  roleIds: string[];
```

- [ ] **Step 2: Update the repository's row type and mapper**

In `src/db/reactionRolesRepository.ts`, find:

```ts
interface MappingRow {
  id: number;
  panel_id: number;
  /** Null for a buttons/dropdown mapping with no emoji — reactions always have one (there's no reacting without an emoji). */
  emoji_name: string | null;
  emoji_id: string | null;
  role_id: string;
  label: string | null;
  position: number;
}
```

Replace `role_id: string;` with `role_ids: string;` (still a raw string column — it holds a JSON array, parsed below).

Find:

```ts
function rowToMapping(row: MappingRow): ReactionRoleMapping {
  return {
    id: row.id,
    panelId: row.panel_id,
    emojiName: row.emoji_name,
    emojiId: row.emoji_id,
    roleId: row.role_id,
    label: row.label,
    position: row.position,
  };
}
```

Replace with:

```ts
function rowToMapping(row: MappingRow): ReactionRoleMapping {
  return {
    id: row.id,
    panelId: row.panel_id,
    emojiName: row.emoji_name,
    emojiId: row.emoji_id,
    roleIds: JSON.parse(row.role_ids) as string[],
    label: row.label,
    position: row.position,
  };
}
```

- [ ] **Step 3: Update the mapping SQL and prepared statements**

Find:

```ts
const MAPPING_COLUMNS = "id, panel_id, emoji_name, emoji_id, role_id, label, position";
```

Replace with:

```ts
const MAPPING_COLUMNS = "id, panel_id, emoji_name, emoji_id, role_ids, label, position";
```

Find:

```ts
const insertMappingStmt = db.prepare<{
  panelId: number;
  emojiName: string | null;
  emojiId: string | null;
  roleId: string;
  label: string | null;
  position: number;
}>(
  `INSERT INTO reaction_role_mappings (panel_id, emoji_name, emoji_id, role_id, label, position)
   VALUES (@panelId, @emojiName, @emojiId, @roleId, @label, @position)`,
);
const updateMappingStmt = db.prepare<{
  id: number;
  emojiName: string | null;
  emojiId: string | null;
  roleId: string;
  label: string | null;
  position: number;
}>(
  `UPDATE reaction_role_mappings SET
     emoji_name = @emojiName, emoji_id = @emojiId, role_id = @roleId, label = @label, position = @position
   WHERE id = @id`,
);
```

Replace both `roleId: string;` fields with `roleIds: string;` (JSON-stringified before being passed in — same convention as `allowedRoleIds: string | null` on `insertPanelStmt`), and both SQL bodies' `role_id` → `role_ids` / `@roleId` → `@roleIds`:

```ts
const insertMappingStmt = db.prepare<{
  panelId: number;
  emojiName: string | null;
  emojiId: string | null;
  roleIds: string;
  label: string | null;
  position: number;
}>(
  `INSERT INTO reaction_role_mappings (panel_id, emoji_name, emoji_id, role_ids, label, position)
   VALUES (@panelId, @emojiName, @emojiId, @roleIds, @label, @position)`,
);
const updateMappingStmt = db.prepare<{
  id: number;
  emojiName: string | null;
  emojiId: string | null;
  roleIds: string;
  label: string | null;
  position: number;
}>(
  `UPDATE reaction_role_mappings SET
     emoji_name = @emojiName, emoji_id = @emojiId, role_ids = @roleIds, label = @label, position = @position
   WHERE id = @id`,
);
```

- [ ] **Step 4: Update `UpsertMappingInput` and `upsertMapping()`**

Find:

```ts
export interface UpsertMappingInput {
  id?: number;
  panelId: number;
  emojiName: string | null;
  emojiId: string | null;
  roleId: string;
  label: string | null;
  position: number;
}

export function upsertMapping(input: UpsertMappingInput): ReactionRoleMapping {
  let mapping: ReactionRoleMapping;
  if (input.id !== undefined) {
    updateMappingStmt.run({
      id: input.id,
      emojiName: input.emojiName,
      emojiId: input.emojiId,
      roleId: input.roleId,
      label: input.label,
      position: input.position,
    });
    mapping = rowToMapping(selectMappingByIdStmt.get(input.id)!);
  } else {
    const info = insertMappingStmt.run({
      panelId: input.panelId,
      emojiName: input.emojiName,
      emojiId: input.emojiId,
      roleId: input.roleId,
      label: input.label,
      position: input.position,
    });
    mapping = rowToMapping(selectMappingByIdStmt.get(Number(info.lastInsertRowid))!);
  }
  settingsBus.emit(SettingsEvent.ReactionRoles);
  return mapping;
}
```

Replace with:

```ts
export interface UpsertMappingInput {
  id?: number;
  panelId: number;
  emojiName: string | null;
  emojiId: string | null;
  roleIds: string[];
  label: string | null;
  position: number;
}

export function upsertMapping(input: UpsertMappingInput): ReactionRoleMapping {
  const roleIds = JSON.stringify(input.roleIds);
  let mapping: ReactionRoleMapping;
  if (input.id !== undefined) {
    updateMappingStmt.run({
      id: input.id,
      emojiName: input.emojiName,
      emojiId: input.emojiId,
      roleIds,
      label: input.label,
      position: input.position,
    });
    mapping = rowToMapping(selectMappingByIdStmt.get(input.id)!);
  } else {
    const info = insertMappingStmt.run({
      panelId: input.panelId,
      emojiName: input.emojiName,
      emojiId: input.emojiId,
      roleIds,
      label: input.label,
      position: input.position,
    });
    mapping = rowToMapping(selectMappingByIdStmt.get(Number(info.lastInsertRowid))!);
  }
  settingsBus.emit(SettingsEvent.ReactionRoles);
  return mapping;
}
```

- [ ] **Step 5: Run the backend typecheck**

```bash
npx tsc --noEmit
```

Expected: remaining errors are only in `src/web/routes/reactionRolePanels.ts` and `src/services/reactionRoles.ts` (fixed in Tasks 3–5) — no more errors in `src/types.ts` or `src/db/reactionRolesRepository.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/db/reactionRolesRepository.ts
git commit -m "feat: repository/types support multi-role reaction mappings"
```

---

### Task 3: API validation and routes

**Files:**
- Modify: `src/web/routes/reactionRolePanels.ts`

**Interfaces:**
- Consumes: `UpsertMappingInput.roleIds: string[]` (Task 2).
- Produces: `MappingBodySchema` accepting `roleIds: string[]`; `validateMappingForPanel()` rejecting more than one role for Buttons/Dropdown; both mapping routes rejecting role-set overlap with any other mapping on the panel.

- [ ] **Step 1: Update the mapping request schema**

Find:

```ts
const MappingBodySchema = z.object({
  // Required for reactions (there's no reacting without an emoji);
  // optional for buttons/dropdown, checked against the panel's
  // selectionType in the route handler since zod alone doesn't have that
  // context.
  emojiName: z.string().min(1).nullable(),
  emojiId: z.string().min(1).nullable(),
  roleId: z.string().min(1),
  label: z.string().max(100).nullable(),
});
```

Replace with:

```ts
const MappingBodySchema = z.object({
  // Required for reactions (there's no reacting without an emoji);
  // optional for buttons/dropdown, checked against the panel's
  // selectionType in the route handler since zod alone doesn't have that
  // context.
  emojiName: z.string().min(1).nullable(),
  emojiId: z.string().min(1).nullable(),
  // Length is further restricted to exactly 1 for Buttons/Dropdown by
  // validateMappingForPanel() below — only a Reactions panel may have more.
  roleIds: z.array(z.string().min(1)).min(1),
  label: z.string().max(100).nullable(),
});
```

- [ ] **Step 2: Update `validateMappingForPanel()`**

Find:

```ts
function validateMappingForPanel(
  selectionType: SelectionType,
  data: { emojiName: string | null; label: string | null },
): string | null {
  if (selectionType === SelectionType.Reactions) {
    return data.emojiName ? null : "An emoji is required for a reactions panel.";
  }
  return data.label?.trim() ? null : "A label is required for buttons/dropdown options.";
}
```

Replace with:

```ts
function validateMappingForPanel(
  selectionType: SelectionType,
  data: { emojiName: string | null; label: string | null; roleIds: string[] },
): string | null {
  if (selectionType !== SelectionType.Reactions && data.roleIds.length > 1) {
    return "Only a reactions panel can grant more than one role per option.";
  }
  if (selectionType === SelectionType.Reactions) {
    return data.emojiName ? null : "An emoji is required for a reactions panel.";
  }
  return data.label?.trim() ? null : "A label is required for buttons/dropdown options.";
}
```

(`roleIds.length === 0` is already rejected by the zod schema's `.min(1)` before this function runs, so it doesn't need to be checked again here.)

- [ ] **Step 3: Update the create-mapping route's uniqueness check**

Find (inside `app.post("/reaction-roles/panels/:id/mappings", ...)`):

```ts
    if (panel.mappings.some((m) => m.roleId === body.data.roleId)) {
      return reply.code(400).send({ error: "That role is already used by another option on this panel." });
    }
```

Replace with:

```ts
    if (panel.mappings.some((m) => m.roleIds.some((r) => body.data.roleIds.includes(r)))) {
      return reply.code(400).send({ error: "One of those roles is already used by another option on this panel." });
    }
```

- [ ] **Step 4: Update the edit-mapping route's uniqueness check**

Find (inside `app.patch("/reaction-roles/panels/:id/mappings/:mappingId", ...)`):

```ts
    if (panel.mappings.some((m) => m.id !== mappingId && m.roleId === body.data.roleId)) {
      return reply.code(400).send({ error: "That role is already used by another option on this panel." });
    }
```

Replace with:

```ts
    if (panel.mappings.some((m) => m.id !== mappingId && m.roleIds.some((r) => body.data.roleIds.includes(r)))) {
      return reply.code(400).send({ error: "One of those roles is already used by another option on this panel." });
    }
```

- [ ] **Step 5: Run the backend typecheck**

```bash
npx tsc --noEmit
```

Expected: remaining errors are only in `src/services/reactionRoles.ts` (fixed in Tasks 4–5).

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/reactionRolePanels.ts
git commit -m "feat(api): validate and enforce multi-role reaction mappings"
```

---

### Task 4: Selection logic — reactions and buttons (grant/revoke)

**Files:**
- Modify: `src/services/reactionRoles.ts`

**Interfaces:**
- Consumes: `ReactionRoleMapping.roleIds: string[]` (Task 2); existing `canManageRole(guild, roleId): Manageability` (unchanged).
- Produces: `roleMentions(roleIds: string[]): string`; `partitionManageable(guild: Guild, roleIds: string[]): { manageable: string[]; unmanageable: string[] }` — both used by Task 5 too.

- [ ] **Step 1: Add the two new helpers**

In `src/services/reactionRoles.ts`, directly above `async function applyMappingSelection(`, add:

```ts
/** `<@&id>, <@&id>` — the mention list shown in a grant/revoke reply and in the panel's rendered options. */
function roleMentions(roleIds: string[]): string {
  return roleIds.map((id) => `<@&${id}>`).join(", ");
}

/**
 * Splits a mapping's configured roles into what the bot can currently
 * manage vs. can't (see `canManageRole()`). Every grant/revoke path applies
 * the change to `manageable` and reports `unmanageable` rather than
 * blocking the whole mapping over one role the bot can't currently touch —
 * confirmed during design (see the spec's "Selection logic" section).
 */
function partitionManageable(guild: Guild, roleIds: string[]): { manageable: string[]; unmanageable: string[] } {
  const manageable: string[] = [];
  const unmanageable: string[] = [];
  for (const roleId of roleIds) {
    (canManageRole(guild, roleId).ok ? manageable : unmanageable).push(roleId);
  }
  return { manageable, unmanageable };
}
```

- [ ] **Step 2: Verify the helpers with a standalone script**

Since there's no test framework, exercise the pure logic (`roleMentions`) directly. `partitionManageable` needs a real `Guild`, so it's covered by the live-Discord check in Step 5 instead.

```bash
npx tsx -e "
function roleMentions(roleIds) { return roleIds.map((id) => \`<@&\${id}>\`).join(', '); }
const a = roleMentions(['111', '222']);
const b = roleMentions(['111']);
if (a !== '<@&111>, <@&222>') throw new Error('FAIL multi: ' + a);
if (b !== '<@&111>') throw new Error('FAIL single: ' + b);
console.log('roleMentions OK');
"
```

Expected: prints `roleMentions OK`.

- [ ] **Step 3: Rewrite `applyMappingSelection()`**

Find the whole function:

```ts
async function applyMappingSelection(
  guild: Guild,
  member: GuildMember,
  panel: ReactionRolePanelWithMappings,
  mapping: ReactionRoleMapping,
  opts: ApplyOptions,
): Promise<SelectionResult> {
  const manageability = canManageRole(guild, mapping.roleId);
  if (!manageability.ok) {
    logger.warn(`Reaction role skipped (panel ${panel.id}, role ${mapping.roleId}): ${manageability.reason}`);
    return { ok: false, message: "Sorry, I can't currently assign that role — an admin needs to check my permissions." };
  }

  const hasRole = member.roles.cache.has(mapping.roleId);

  if (hasRole) {
    if (!opts.flip) return { ok: true, message: `You already have <@&${mapping.roleId}>.` };
    if (!panel.removable) return { ok: true, message: `<@&${mapping.roleId}> can't be removed.` };
    await member.roles.remove(mapping.roleId).catch((err) =>
      logger.warn(`Failed to revoke role ${mapping.roleId}: ${errorMessage(err)}`),
    );
    return { ok: true, message: `Removed <@&${mapping.roleId}>.` };
  }

  if (!panel.allowMultiple) {
    for (const other of panel.mappings) {
      if (other.id === mapping.id) continue;
      if (member.roles.cache.has(other.roleId) && canManageRole(guild, other.roleId).ok) {
        await member.roles.remove(other.roleId).catch((err) =>
          logger.warn(`Failed to revoke role ${other.roleId} while enforcing single-role selection: ${errorMessage(err)}`),
        );
        if (opts.message) await clearUserReactionForMapping(opts.message, other, member.id);
      }
    }
  }

  await member.roles.add(mapping.roleId).catch((err) =>
    logger.warn(`Failed to grant role ${mapping.roleId}: ${errorMessage(err)}`),
  );
  return { ok: true, message: `Gave you <@&${mapping.roleId}>.` };
}
```

Replace with:

```ts
async function applyMappingSelection(
  guild: Guild,
  member: GuildMember,
  panel: ReactionRolePanelWithMappings,
  mapping: ReactionRoleMapping,
  opts: ApplyOptions,
): Promise<SelectionResult> {
  const { manageable, unmanageable } = partitionManageable(guild, mapping.roleIds);
  if (manageable.length === 0) {
    logger.warn(`Reaction role skipped (panel ${panel.id}, mapping ${mapping.id}): no configured role is currently manageable.`);
    return { ok: false, message: "Sorry, I can't currently assign that role — an admin needs to check my permissions." };
  }
  const unmanageableSuffix =
    unmanageable.length > 0 ? ` (couldn't touch ${roleMentions(unmanageable)} — ask an admin)` : "";

  const hasAllRoles = manageable.every((id) => member.roles.cache.has(id));

  if (hasAllRoles) {
    if (!opts.flip) return { ok: true, message: `You already have ${roleMentions(manageable)}.${unmanageableSuffix}` };
    if (!panel.removable) return { ok: true, message: `${roleMentions(manageable)} can't be removed.${unmanageableSuffix}` };
    for (const roleId of manageable) {
      await member.roles.remove(roleId).catch((err) => logger.warn(`Failed to revoke role ${roleId}: ${errorMessage(err)}`));
    }
    return { ok: true, message: `Removed ${roleMentions(manageable)}.${unmanageableSuffix}` };
  }

  if (!panel.allowMultiple) {
    for (const other of panel.mappings) {
      if (other.id === mapping.id) continue;
      const { manageable: otherManageable } = partitionManageable(guild, other.roleIds);
      const heldOtherRoles = otherManageable.filter((id) => member.roles.cache.has(id));
      for (const roleId of heldOtherRoles) {
        await member.roles.remove(roleId).catch((err) =>
          logger.warn(`Failed to revoke role ${roleId} while enforcing single-role selection: ${errorMessage(err)}`),
        );
      }
      if (heldOtherRoles.length > 0 && opts.message) await clearUserReactionForMapping(opts.message, other, member.id);
    }
  }

  const toGrant = manageable.filter((id) => !member.roles.cache.has(id));
  for (const roleId of toGrant) {
    await member.roles.add(roleId).catch((err) => logger.warn(`Failed to grant role ${roleId}: ${errorMessage(err)}`));
  }
  return { ok: true, message: `Gave you ${roleMentions(manageable)}.${unmanageableSuffix}` };
}
```

- [ ] **Step 4: Rewrite `revokeMappingSelection()`**

Find:

```ts
async function revokeMappingSelection(
  guild: Guild,
  member: GuildMember,
  panel: ReactionRolePanelWithMappings,
  mapping: ReactionRoleMapping,
): Promise<void> {
  if (!panel.removable || !member.roles.cache.has(mapping.roleId)) return;
  const manageability = canManageRole(guild, mapping.roleId);
  if (!manageability.ok) {
    logger.warn(`Reaction role revoke skipped (panel ${panel.id}, role ${mapping.roleId}): ${manageability.reason}`);
    return;
  }
  await member.roles.remove(mapping.roleId).catch((err) =>
    logger.warn(`Failed to revoke role ${mapping.roleId}: ${errorMessage(err)}`),
  );
}
```

Replace with:

```ts
async function revokeMappingSelection(
  guild: Guild,
  member: GuildMember,
  panel: ReactionRolePanelWithMappings,
  mapping: ReactionRoleMapping,
): Promise<void> {
  if (!panel.removable) return;
  const { manageable, unmanageable } = partitionManageable(guild, mapping.roleIds);
  if (unmanageable.length > 0) {
    logger.warn(
      `Reaction role revoke skipped some roles (panel ${panel.id}, mapping ${mapping.id}): ${unmanageable.join(", ")} not manageable.`,
    );
  }
  const toRevoke = manageable.filter((id) => member.roles.cache.has(id));
  for (const roleId of toRevoke) {
    await member.roles.remove(roleId).catch((err) => logger.warn(`Failed to revoke role ${roleId}: ${errorMessage(err)}`));
  }
}
```

- [ ] **Step 5: Run the backend typecheck**

```bash
npx tsc --noEmit
```

Expected: remaining errors are only from the still-unmodified `applyDropdownSelection()`, `roleLabel()`, `buildPanelEmbed()`, `buildPanelText()` (fixed in Task 5).

- [ ] **Step 6: Commit**

```bash
git add src/services/reactionRoles.ts
git commit -m "feat: apply/revoke multi-role reaction mappings with partial-manageability handling"
```

---

### Task 5: Selection logic — dropdown, rendering, and backend build verification

**Files:**
- Modify: `src/services/reactionRoles.ts`

**Interfaces:**
- Consumes: `roleMentions()` (Task 4). `ReactionRoleMapping.roleIds` for Dropdown mappings is always exactly one element (enforced by Task 3's validation) — safe to read as `mapping.roleIds[0]!`.

- [ ] **Step 1: Update `applyDropdownSelection()`**

Find:

```ts
async function applyDropdownSelection(
  guild: Guild,
  member: GuildMember,
  panel: ReactionRolePanelWithMappings,
  selectedMappingIds: number[],
): Promise<SelectionResult> {
  const targetRoleIds = new Set(
    panel.mappings.filter((m) => selectedMappingIds.includes(m.id)).map((m) => m.roleId),
  );

  const granted: string[] = [];
  const revoked: string[] = [];
  const kept: string[] = [];

  for (const mapping of panel.mappings) {
    if (!canManageRole(guild, mapping.roleId).ok) continue;
    const hasRole = member.roles.cache.has(mapping.roleId);
    const wantsRole = targetRoleIds.has(mapping.roleId);

    if (wantsRole && !hasRole) {
      await member.roles.add(mapping.roleId).catch((err) =>
        logger.warn(`Failed to grant role ${mapping.roleId}: ${errorMessage(err)}`),
      );
      granted.push(mapping.roleId);
    } else if (!wantsRole && hasRole) {
      if (panel.removable) {
        await member.roles.remove(mapping.roleId).catch((err) =>
          logger.warn(`Failed to revoke role ${mapping.roleId}: ${errorMessage(err)}`),
        );
        revoked.push(mapping.roleId);
      } else {
        kept.push(mapping.roleId);
      }
    }
  }

  const parts: string[] = [];
  if (granted.length) parts.push(`Gave you: ${granted.map((id) => `<@&${id}>`).join(", ")}`);
  if (revoked.length) parts.push(`Removed: ${revoked.map((id) => `<@&${id}>`).join(", ")}`);
  if (kept.length) parts.push(`Kept (not removable): ${kept.map((id) => `<@&${id}>`).join(", ")}`);
  return { ok: true, message: parts.length ? parts.join("\n") : "No changes." };
}
```

Replace with (each `mapping.roleId` becomes `mapping.roleIds[0]!` — dropdown mappings are always single-role, enforced by `validateMappingForPanel()`):

```ts
async function applyDropdownSelection(
  guild: Guild,
  member: GuildMember,
  panel: ReactionRolePanelWithMappings,
  selectedMappingIds: number[],
): Promise<SelectionResult> {
  const targetRoleIds = new Set(
    panel.mappings.filter((m) => selectedMappingIds.includes(m.id)).map((m) => m.roleIds[0]!),
  );

  const granted: string[] = [];
  const revoked: string[] = [];
  const kept: string[] = [];

  for (const mapping of panel.mappings) {
    const roleId = mapping.roleIds[0]!;
    if (!canManageRole(guild, roleId).ok) continue;
    const hasRole = member.roles.cache.has(roleId);
    const wantsRole = targetRoleIds.has(roleId);

    if (wantsRole && !hasRole) {
      await member.roles.add(roleId).catch((err) => logger.warn(`Failed to grant role ${roleId}: ${errorMessage(err)}`));
      granted.push(roleId);
    } else if (!wantsRole && hasRole) {
      if (panel.removable) {
        await member.roles.remove(roleId).catch((err) => logger.warn(`Failed to revoke role ${roleId}: ${errorMessage(err)}`));
        revoked.push(roleId);
      } else {
        kept.push(roleId);
      }
    }
  }

  const parts: string[] = [];
  if (granted.length) parts.push(`Gave you: ${roleMentions(granted)}`);
  if (revoked.length) parts.push(`Removed: ${roleMentions(revoked)}`);
  if (kept.length) parts.push(`Kept (not removable): ${roleMentions(kept)}`);
  return { ok: true, message: parts.length ? parts.join("\n") : "No changes." };
}
```

- [ ] **Step 2: Update `roleLabel()`**

Find:

```ts
function roleLabel(mapping: ReactionRoleMapping, guild: Guild): string {
  if (mapping.label) return mapping.label;
  return guild.roles.cache.get(mapping.roleId)?.name ?? "Unknown role";
}
```

Replace with:

```ts
function roleLabel(mapping: ReactionRoleMapping, guild: Guild): string {
  if (mapping.label) return mapping.label;
  return mapping.roleIds.map((id) => guild.roles.cache.get(id)?.name ?? "Unknown role").join(", ");
}
```

- [ ] **Step 3: Update `buildPanelEmbed()` and `buildPanelText()`**

Find (in `buildPanelEmbed()`):

```ts
      return `${emoji ? `${emoji} — ` : ""}<@&${m.roleId}>${m.label ? ` — ${m.label}` : ""}`;
```

Replace with:

```ts
      return `${emoji ? `${emoji} — ` : ""}${roleMentions(m.roleIds)}${m.label ? ` — ${m.label}` : ""}`;
```

Find the identical line inside `buildPanelText()` (same replacement — there are two occurrences total in the file, one per function):

```ts
            return `${emoji ? `${emoji} — ` : ""}<@&${m.roleId}>${m.label ? ` — ${m.label}` : ""}`;
```

Replace with:

```ts
            return `${emoji ? `${emoji} — ` : ""}${roleMentions(m.roleIds)}${m.label ? ` — ${m.label}` : ""}`;
```

- [ ] **Step 4: Run the backend typecheck**

```bash
npx tsc --noEmit
```

Expected: clean, no errors anywhere in `src/`.

- [ ] **Step 5: Verify `roleLabel()`'s multi-role join with a standalone script**

```bash
npx tsx -e "
function roleLabelPure(label, roleNames) {
  if (label) return label;
  return roleNames.join(', ');
}
const a = roleLabelPure(null, ['Rules accepted', 'Unregistered']);
const b = roleLabelPure('Custom label', ['Rules accepted', 'Unregistered']);
if (a !== 'Rules accepted, Unregistered') throw new Error('FAIL fallback: ' + a);
if (b !== 'Custom label') throw new Error('FAIL custom: ' + b);
console.log('roleLabel join logic OK');
"
```

Expected: prints `roleLabel join logic OK`. (This re-derives just the join logic in isolation, since the real `roleLabel()` needs a live discord.js `Guild` to resolve role names.)

- [ ] **Step 6: Commit**

```bash
git add src/services/reactionRoles.ts
git commit -m "feat: render multi-role reaction mappings in dropdown selection and panel messages"
```

---

### Task 6: Dashboard types and shared `RoleCheckboxList` component

**Files:**
- Modify: `web/src/types.ts` (`Mapping`, `MappingInput` interfaces)
- Create: `web/src/components/RoleCheckboxList.tsx`

**Interfaces:**
- Produces: `RoleCheckboxList` component — `{ options: RoleCheckboxListOption[]; value: string[]; onChange: (ids: string[]) => void; placeholder: string }`, where `RoleCheckboxListOption` is `{ value: string; label: string; disabled?: boolean; hint?: string }` (same shape as `SearchableSelectOption`, for a consistent calling convention between the two pickers).

- [ ] **Step 1: Update `Mapping` and `MappingInput`**

In `web/src/types.ts`, find:

```ts
export interface Mapping {
  id: number;
  panelId: number;
  /** Null for a buttons/dropdown option with no emoji — reactions always have one. */
  emojiName: string | null;
  emojiId: string | null;
  roleId: string;
  label: string | null;
  position: number;
}
```

Replace the `roleId` line:

```ts
  /** One or more roles this option grants. Multiple only ever possible on a Reactions panel — Buttons/Dropdown are restricted to exactly one. */
  roleIds: string[];
```

Find:

```ts
export interface MappingInput {
  emojiName: string | null;
  emojiId: string | null;
  roleId: string;
  label: string | null;
}
```

Replace with:

```ts
export interface MappingInput {
  emojiName: string | null;
  emojiId: string | null;
  roleIds: string[];
  label: string | null;
}
```

- [ ] **Step 2: Create the shared component**

Create `web/src/components/RoleCheckboxList.tsx`:

```tsx
import { useMemo, useState } from "react";

export interface RoleCheckboxListOption {
  value: string;
  label: string;
  disabled?: boolean;
  hint?: string;
}

interface RoleCheckboxListProps {
  options: RoleCheckboxListOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
}

/**
 * A filtered multi-select over a checkbox grid — extracted from the
 * "Allowed roles" picker on a reaction-role panel (used there, and reused
 * by a Reactions mapping's role picker on ReactionRoles.tsx, which is the
 * only place a member can select more than one role for a single option).
 * Already-checked options stay visible even when they don't match the
 * current search text, so typing never hides your existing selection.
 */
export default function RoleCheckboxList({ options, value, onChange, placeholder }: RoleCheckboxListProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || value.includes(o.value));
  }, [options, search, value]);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div>
      {options.length > 8 && (
        <input
          type="text"
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 6 }}
        />
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          background: "var(--bg-inset)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: 8,
          maxHeight: 140,
          overflowY: "auto",
        }}
      >
        {options.length === 0 && <span className="muted">No roles found.</span>}
        {options.length > 0 && filtered.length === 0 && <span className="muted">No matches.</span>}
        {filtered.map((o) => (
          <label
            key={o.value}
            className="switch"
            style={{ fontSize: 13, background: "var(--bg-elevated)", padding: "2px 8px", borderRadius: 999 }}
          >
            <input
              type="checkbox"
              checked={value.includes(o.value)}
              disabled={o.disabled}
              onChange={() => toggle(o.value)}
            />
            {o.label}
            {o.hint && <span className="muted"> {o.hint}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the frontend typecheck**

```bash
cd web && npx tsc --noEmit -p .
```

Expected: new errors in `web/src/pages/ReactionRoles.tsx` and `web/src/components/MessagePreview.tsx` referencing `roleId`/`Mapping` (fixed in Task 7) — `RoleCheckboxList.tsx` itself and `types.ts` compile clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/types.ts web/src/components/RoleCheckboxList.tsx
git commit -m "feat(web): add multi-role mapping types and a shared role checkbox picker"
```

---

### Task 7: Dashboard — wire `ReactionRoles.tsx` to multi-role mappings

**Files:**
- Modify: `web/src/pages/ReactionRoles.tsx`

**Interfaces:**
- Consumes: `Mapping.roleIds: string[]`, `MappingInput.roleIds: string[]` (Task 6); `RoleCheckboxList` component (Task 6).

- [ ] **Step 1: Update `MappingDraft` and its constructor**

Find:

```ts
interface MappingDraft {
  emojiName: string;
  emojiId: string | null;
  roleId: string;
  label: string;
}

function emptyMappingDraft(): MappingDraft {
  return { emojiName: "", emojiId: null, roleId: "", label: "" };
}
```

Replace with:

```ts
interface MappingDraft {
  emojiName: string;
  emojiId: string | null;
  roleIds: string[];
  label: string;
}

function emptyMappingDraft(): MappingDraft {
  return { emojiName: "", emojiId: null, roleIds: [], label: "" };
}
```

- [ ] **Step 2: Add the `RoleCheckboxList` import and flatten `usedRoleIds`**

Find the import block at the top of the file:

```ts
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../api";
import EmojiPicker from "../components/EmojiPicker";
import MessagePreview from "../components/MessagePreview";
import SearchableSelect from "../components/SearchableSelect";
import { useToast } from "../components/ToastContext";
```

Add the new import after `EmojiPicker`:

```ts
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../api";
import EmojiPicker from "../components/EmojiPicker";
import RoleCheckboxList from "../components/RoleCheckboxList";
import MessagePreview from "../components/MessagePreview";
import SearchableSelect from "../components/SearchableSelect";
import { useToast } from "../components/ToastContext";
```

Find:

```ts
  // A role can only grant one outcome per panel — once it's mapped to an
  // option, picking it again for a second option would just be ambiguous.
  const usedRoleIds = useMemo(() => new Set(selected?.mappings.map((m) => m.roleId) ?? []), [selected]);
```

Replace with:

```ts
  // A role can only grant one outcome per panel — once it's mapped to an
  // option, picking it again for a second option (even as part of a
  // different multi-role Reactions option) would just be ambiguous.
  const usedRoleIds = useMemo(
    () => new Set(selected?.mappings.flatMap((m) => m.roleIds) ?? []),
    [selected],
  );
```

- [ ] **Step 3: Update `handleAddMapping()`'s validation and payload**

Find:

```ts
  async function handleAddMapping() {
    if (typeof selectedId !== "number") return;
    if (!mappingDraft.roleId) {
      showError("Pick a role.");
      return;
    }
    if (effectiveSelectionType === "reactions" && !mappingDraft.emojiName) {
      showError("Pick an emoji.");
      return;
    }
    if (effectiveSelectionType !== "reactions" && !mappingDraft.label.trim()) {
      showError(`A label is required for ${effectiveSelectionType === "buttons" ? "buttons" : "dropdown options"}.`);
      return;
    }
    if (atOptionCap) {
      showError(`Discord allows at most ${optionCap} options for this selection type.`);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.addMapping(selectedId, {
        emojiName: mappingDraft.emojiName || null,
        emojiId: mappingDraft.emojiId,
        roleId: mappingDraft.roleId,
        label: mappingDraft.label.trim() ? mappingDraft.label : null,
      });
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      setMappingDraft(emptyMappingDraft());
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
```

Replace with:

```ts
  async function handleAddMapping() {
    if (typeof selectedId !== "number") return;
    if (mappingDraft.roleIds.length === 0) {
      showError("Pick at least one role.");
      return;
    }
    if (effectiveSelectionType === "reactions" && !mappingDraft.emojiName) {
      showError("Pick an emoji.");
      return;
    }
    if (effectiveSelectionType !== "reactions" && !mappingDraft.label.trim()) {
      showError(`A label is required for ${effectiveSelectionType === "buttons" ? "buttons" : "dropdown options"}.`);
      return;
    }
    if (atOptionCap) {
      showError(`Discord allows at most ${optionCap} options for this selection type.`);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.addMapping(selectedId, {
        emojiName: mappingDraft.emojiName || null,
        emojiId: mappingDraft.emojiId,
        roleIds: mappingDraft.roleIds,
        label: mappingDraft.label.trim() ? mappingDraft.label : null,
      });
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      setMappingDraft(emptyMappingDraft());
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
```

- [ ] **Step 4: Update `handleStartEditMapping()` and `handleSaveEditMapping()`**

Find:

```ts
  function handleStartEditMapping(m: Mapping) {
    setEditingMappingId(m.id);
    setEditDraft({ emojiName: m.emojiName ?? "", emojiId: m.emojiId, roleId: m.roleId, label: m.label ?? "" });
  }
```

Replace with:

```ts
  function handleStartEditMapping(m: Mapping) {
    setEditingMappingId(m.id);
    setEditDraft({ emojiName: m.emojiName ?? "", emojiId: m.emojiId, roleIds: m.roleIds, label: m.label ?? "" });
  }
```

Find:

```ts
  async function handleSaveEditMapping() {
    if (typeof selectedId !== "number" || editingMappingId === null) return;
    if (!editDraft.roleId) {
      showError("Pick a role.");
      return;
    }
    if (effectiveSelectionType === "reactions" && !editDraft.emojiName) {
      showError("Pick an emoji.");
      return;
    }
    if (effectiveSelectionType !== "reactions" && !editDraft.label.trim()) {
      showError(`A label is required for ${effectiveSelectionType === "buttons" ? "buttons" : "dropdown options"}.`);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.updateMapping(selectedId, editingMappingId, {
        emojiName: editDraft.emojiName || null,
        emojiId: editDraft.emojiId,
        roleId: editDraft.roleId,
        label: editDraft.label.trim() ? editDraft.label : null,
      });
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      handleCancelEditMapping();
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
```

Replace with:

```ts
  async function handleSaveEditMapping() {
    if (typeof selectedId !== "number" || editingMappingId === null) return;
    if (editDraft.roleIds.length === 0) {
      showError("Pick at least one role.");
      return;
    }
    if (effectiveSelectionType === "reactions" && !editDraft.emojiName) {
      showError("Pick an emoji.");
      return;
    }
    if (effectiveSelectionType !== "reactions" && !editDraft.label.trim()) {
      showError(`A label is required for ${effectiveSelectionType === "buttons" ? "buttons" : "dropdown options"}.`);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.updateMapping(selectedId, editingMappingId, {
        emojiName: editDraft.emojiName || null,
        emojiId: editDraft.emojiId,
        roleIds: editDraft.roleIds,
        label: editDraft.label.trim() ? editDraft.label : null,
      });
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      handleCancelEditMapping();
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
```

- [ ] **Step 5: Add a `roleNamesLabel` helper next to `roleName`**

Find:

```ts
  function roleName(roleId: string): string {
    return roles.find((r) => r.id === roleId)?.name ?? roleId;
  }

  function roleIsManageable(roleId: string): boolean {
    return roles.find((r) => r.id === roleId)?.manageable ?? true;
  }
```

Replace with:

```ts
  function roleName(roleId: string): string {
    return roles.find((r) => r.id === roleId)?.name ?? roleId;
  }

  function roleNamesLabel(roleIds: string[]): string {
    return roleIds.map(roleName).join(", ");
  }

  function roleIsManageable(roleId: string): boolean {
    return roles.find((r) => r.id === roleId)?.manageable ?? true;
  }
```

- [ ] **Step 6: Update the `MessagePreview`'s `resolveRoleLabel`**

Find:

```tsx
                    resolveRoleLabel={(m) => m.label ?? roleName(m.roleId)}
```

Replace with:

```tsx
                    resolveRoleLabel={(m) => m.label ?? roleNamesLabel(m.roleIds)}
```

- [ ] **Step 7: Update the mapping edit row's role picker and display line**

Find (the edit-mode `SearchableSelect` inside the mapping list):

```tsx
                          <SearchableSelect
                            className="grow"
                            value={editDraft.roleId}
                            onChange={(v) => setEditDraft((d) => ({ ...d, roleId: v }))}
                            placeholder="Search roles…"
                            emptyLabel="— pick a role —"
                            options={roles
                              .filter((r) => !usedRoleIds.has(r.id) || r.id === m.roleId)
                              .map((r) => ({
                                value: r.id,
                                label: r.name,
                                disabled: !r.manageable,
                                hint: r.manageable ? undefined : "(not assignable)",
                              }))}
                          />
```

Replace with:

```tsx
                          {effectiveSelectionType === "reactions" ? (
                            <RoleCheckboxList
                              placeholder="Search roles…"
                              value={editDraft.roleIds}
                              onChange={(ids) => setEditDraft((d) => ({ ...d, roleIds: ids }))}
                              options={roles
                                .filter((r) => !usedRoleIds.has(r.id) || m.roleIds.includes(r.id))
                                .map((r) => ({
                                  value: r.id,
                                  label: r.name,
                                  disabled: !r.manageable,
                                  hint: r.manageable ? undefined : "(not assignable)",
                                }))}
                            />
                          ) : (
                            <SearchableSelect
                              className="grow"
                              value={editDraft.roleIds[0] ?? ""}
                              onChange={(v) => setEditDraft((d) => ({ ...d, roleIds: v ? [v] : [] }))}
                              placeholder="Search roles…"
                              emptyLabel="— pick a role —"
                              options={roles
                                .filter((r) => !usedRoleIds.has(r.id) || m.roleIds.includes(r.id))
                                .map((r) => ({
                                  value: r.id,
                                  label: r.name,
                                  disabled: !r.manageable,
                                  hint: r.manageable ? undefined : "(not assignable)",
                                }))}
                            />
                          )}
```

Find the read-only display line right below it:

```tsx
                        <div className="mapping-row" key={m.id}>
                          {effectiveSelectionType === "reactions" && <span>{emojiDisplay(m)}</span>}
                          <span className="grow">
                            {roleName(m.roleId)}
                            {!roleIsManageable(m.roleId) && (
                              <span className="badge warn" style={{ marginLeft: 8 }}>
                                bot can't assign this role
                              </span>
                            )}
                            {m.label && <span className="muted"> — {m.label}</span>}
                            {effectiveSelectionType !== "reactions" && (m.emojiId || m.emojiName) && (
                              <span className="muted"> {emojiDisplay(m)}</span>
                            )}
                          </span>
```

Replace with:

```tsx
                        <div className="mapping-row" key={m.id}>
                          {effectiveSelectionType === "reactions" && <span>{emojiDisplay(m)}</span>}
                          <span className="grow">
                            {roleNamesLabel(m.roleIds)}
                            {m.roleIds.some((id) => !roleIsManageable(id)) && (
                              <span className="badge warn" style={{ marginLeft: 8 }}>
                                bot can't assign: {roleNamesLabel(m.roleIds.filter((id) => !roleIsManageable(id)))}
                              </span>
                            )}
                            {m.label && <span className="muted"> — {m.label}</span>}
                            {effectiveSelectionType !== "reactions" && (m.emojiId || m.emojiName) && (
                              <span className="muted"> {emojiDisplay(m)}</span>
                            )}
                          </span>
```

- [ ] **Step 8: Update the "Add" form's role picker**

Find:

```tsx
                      <SearchableSelect
                        className="grow"
                        value={mappingDraft.roleId}
                        onChange={(v) => setMappingDraft((d) => ({ ...d, roleId: v }))}
                        placeholder="Search roles…"
                        emptyLabel="— pick a role —"
                        options={roles
                          .filter((r) => !usedRoleIds.has(r.id))
                          .map((r) => ({
                            value: r.id,
                            label: r.name,
                            disabled: !r.manageable,
                            hint: r.manageable ? undefined : "(not assignable)",
                          }))}
                      />
```

Replace with:

```tsx
                      {effectiveSelectionType === "reactions" ? (
                        <RoleCheckboxList
                          placeholder="Search roles…"
                          value={mappingDraft.roleIds}
                          onChange={(ids) => setMappingDraft((d) => ({ ...d, roleIds: ids }))}
                          options={roles
                            .filter((r) => !usedRoleIds.has(r.id))
                            .map((r) => ({
                              value: r.id,
                              label: r.name,
                              disabled: !r.manageable,
                              hint: r.manageable ? undefined : "(not assignable)",
                            }))}
                        />
                      ) : (
                        <SearchableSelect
                          className="grow"
                          value={mappingDraft.roleIds[0] ?? ""}
                          onChange={(v) => setMappingDraft((d) => ({ ...d, roleIds: v ? [v] : [] }))}
                          placeholder="Search roles…"
                          emptyLabel="— pick a role —"
                          options={roles
                            .filter((r) => !usedRoleIds.has(r.id))
                            .map((r) => ({
                              value: r.id,
                              label: r.name,
                              disabled: !r.manageable,
                              hint: r.manageable ? undefined : "(not assignable)",
                            }))}
                        />
                      )}
```

- [ ] **Step 9 (optional cleanup, do it): Reuse `RoleCheckboxList` for "Allowed roles" too**

This isn't strictly required for multi-role mappings to work, but the spec calls for extracting this exact block into the shared component rather than leaving three near-duplicate copies of the same picker in one file — do it now while touching this file.

Find the state/helpers that back the current hand-rolled "Allowed roles" picker:

```ts
  const [allowedRoleSearch, setAllowedRoleSearch] = useState("");
```

Delete that line (no longer needed — `RoleCheckboxList` owns its own search state).

Find:

```ts
  // Keeps already-checked roles visible even when they don't match the
  // current search, so typing never hides your existing selection.
  const filteredAllowedRoles = useMemo(() => {
    const q = allowedRoleSearch.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) => r.name.toLowerCase().includes(q) || form.allowedRoleIds.includes(r.id));
  }, [roles, allowedRoleSearch, form.allowedRoleIds]);
```

Delete this whole block (superseded by `RoleCheckboxList`'s internal filtering).

Find:

```ts
  function toggleAllowedRole(roleId: string) {
    setForm((f) => ({
      ...f,
      allowedRoleIds: f.allowedRoleIds.includes(roleId)
        ? f.allowedRoleIds.filter((id) => id !== roleId)
        : [...f.allowedRoleIds, roleId],
    }));
  }
```

Delete this too (superseded by `RoleCheckboxList`'s `onChange` giving back the full new array directly).

Find the "Allowed roles" field block:

```tsx
                    <div className="field">
                      <label>Allowed roles</label>
                      {roles.length > 8 && (
                        <input
                          type="text"
                          placeholder="Search roles…"
                          value={allowedRoleSearch}
                          onChange={(e) => setAllowedRoleSearch(e.target.value)}
                          style={{ marginBottom: 6 }}
                        />
                      )}
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          background: "var(--bg-inset)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          padding: 8,
                          maxHeight: 140,
                          overflowY: "auto",
                        }}
                      >
                        {roles.length === 0 && <span className="muted">No roles found.</span>}
                        {roles.length > 0 && filteredAllowedRoles.length === 0 && (
                          <span className="muted">No matches.</span>
                        )}
                        {filteredAllowedRoles.map((r) => (
                          <label
                            key={r.id}
                            className="switch"
                            style={{ fontSize: 13, background: "var(--bg-elevated)", padding: "2px 8px", borderRadius: 999 }}
                          >
                            <input
                              type="checkbox"
                              checked={form.allowedRoleIds.includes(r.id)}
                              onChange={() => toggleAllowedRole(r.id)}
                            />
                            {r.name}
                          </label>
                        ))}
                      </div>
                      <div className="hint">
                        Only members holding one of these roles may use the panel. None selected = everyone.
                      </div>
                    </div>
```

Replace with:

```tsx
                    <div className="field">
                      <label>Allowed roles</label>
                      <RoleCheckboxList
                        placeholder="Search roles…"
                        value={form.allowedRoleIds}
                        onChange={(ids) => setForm((f) => ({ ...f, allowedRoleIds: ids }))}
                        options={roles.map((r) => ({ value: r.id, label: r.name }))}
                      />
                      <div className="hint">
                        Only members holding one of these roles may use the panel. None selected = everyone.
                      </div>
                    </div>
```

- [ ] **Step 10: Run the frontend typecheck**

```bash
cd web && npx tsc --noEmit -p .
```

Expected: clean, no errors anywhere in `web/src/`.

- [ ] **Step 11: Run a production build**

```bash
cd web && npx vite build
```

Expected: builds successfully (mirrors what `npm run build` does at the repo root).

- [ ] **Step 12: Commit**

```bash
git add web/src/pages/ReactionRoles.tsx
git commit -m "feat(web): dashboard support for multi-role reaction mappings"
```

---

### Task 8: Docs and full-stack verification

**Files:**
- Modify: `docs/REACTION_ROLES.md`
- Modify: `docs/DATABASE.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update `docs/REACTION_ROLES.md`'s Concepts section**

Find:

```md
A **panel** is one message (`reaction_role_panels`) in a chosen channel that members interact with to pick roles. Each panel has a required **name** — purely for identifying it in the dashboard's panel list and `/reactionroles list`, never shown on the Discord message itself. Each **mapping** (`reaction_role_mappings`) attaches one option (an emoji, a button, or a dropdown entry) to one role on that panel, in a display order.
```

Replace with:

```md
A **panel** is one message (`reaction_role_panels`) in a chosen channel that members interact with to pick roles. Each panel has a required **name** — purely for identifying it in the dashboard's panel list and `/reactionroles list`, never shown on the Discord message itself. Each **mapping** (`reaction_role_mappings`) attaches one option (an emoji, a button, or a dropdown entry) to one or more roles on that panel, in a display order — **more than one role per option is only possible on a Reactions panel** (e.g. one ✅ granting both a permanent "rules accepted" role and a separate "unregistered" gate role some other mechanism removes later); Buttons and Dropdown options stay exactly one role each.
```

- [ ] **Step 2: Add a note to the Selection types table's Reactions row**

Find:

```md
| **Reactions** | Members react to the message with a configured emoji. | Nothing extra — works on any message, including [an existing one](#attaching-to-an-existing-message). |
```

Replace with:

```md
| **Reactions** | Members react to the message with a configured emoji. Can grant more than one role per emoji — see [Multi-role options](#multi-role-options-reactions-only). | Nothing extra — works on any message, including [an existing one](#attaching-to-an-existing-message). |
```

- [ ] **Step 3: Add a new section documenting the feature**

Find the `## `removeReaction` (reactions only)` heading and insert a new section immediately **before** it:

```md
## Multi-role options (reactions only)

A single reaction can be configured to grant more than one role at once — pick as many roles as you like in the dashboard's role picker for that option (a checkbox list instead of the usual single-role dropdown, shown only for a Reactions panel). All configured roles for that option are granted/revoked together, following the panel's normal `removable`/`allowMultiple` rules — there's no way to make one of a multi-role option's roles behave differently from the others through this feature.

If the bot can manage some but not all of an option's configured roles (e.g. one role sits above the bot's own in the role list), it grants/revokes whichever it can and reports which it couldn't — it never blocks the whole option over a single unmanageable role.

The motivating case is rules-acceptance granting two roles at once: a permanent "rules accepted" role that's never removed through this panel (`removable: off`), alongside a separate "unregistered"/gate role that a *different*, unrelated mechanism removes later (e.g. staff manually registering the member) — see [DATABASE.md](DATABASE.md#settings) for `register_gate_role_id`/`registration_tier_role_id`. That later removal isn't part of this feature; it already works the same way it did before.

Buttons and Dropdown options are still exactly one role each — a dropdown's own multi-*select* (picking several options in one submission, see [Emoji vs. label](#emoji-vs-label)) already covers "give me several outcomes" for that selection type.

```

- [ ] **Step 4: Update the "How it works" developer section**

Find:

```md
- **Shared role logic**: `applyMappingSelection()` is the single place the allow-multiple/removable rules live, used by reactions (both the flip case, when `removeReaction` is on, and the grant-only case) and by button clicks (always a flip). Dropdown submissions go through the separate `applyDropdownSelection()` instead, since a select menu submits the member's *complete* new choice every time rather than one option at a time — it reconciles that target set against current role membership in one pass, honoring `removable` per-role rather than needing a flip flag at all.
```

Replace with:

```md
- **Shared role logic**: `applyMappingSelection()` is the single place the allow-multiple/removable rules live, used by reactions (both the flip case, when `removeReaction` is on, and the grant-only case) and by button clicks (always a flip). It operates over a mapping's full `roleIds` array — partitioning them into currently-manageable vs. not (`partitionManageable()`) and applying the grant/revoke to whichever it can, per option, rather than failing the whole mapping over one unmanageable role. Dropdown submissions go through the separate `applyDropdownSelection()` instead, since a select menu submits the member's *complete* new choice every time rather than one option at a time — it reconciles that target set against current role membership in one pass, honoring `removable` per-role rather than needing a flip flag at all (dropdown mappings are always single-role, so this doesn't need the same partitioning).
```

- [ ] **Step 5: Update `docs/DATABASE.md`'s mapping table**

Find the `**reaction_role_mappings**` table's `role_id` row:

```md
| `role_id` | `TEXT NOT NULL` | |
```

Replace with:

```md
| `role_ids` | `TEXT NOT NULL` | JSON array of role id strings this option grants — more than one only ever possible on a Reactions panel (enforced in `web/routes/reactionRolePanels.ts`, not here); Buttons/Dropdown are restricted to exactly one. Same JSON-array-in-a-TEXT-column convention as `reaction_role_panels.allowed_role_ids`. Added in v21, replacing the single-role `role_id` column. |
```

- [ ] **Step 6: Add v21 to the migrations summary paragraph**

Find the end of the long migrations-summary sentence in `docs/DATABASE.md` (it currently ends at v20's `rules_accepted_use_discord_screening` addition):

```md
...v20 adds `rules_accepted_use_discord_screening`, defaulting to role-based detection.
```

Replace with:

```md
...v20 adds `rules_accepted_use_discord_screening`, defaulting to role-based detection; v21 replaces `reaction_role_mappings.role_id` with `role_ids` (a JSON array), so a Reactions-panel option can grant more than one role at once.
```

- [ ] **Step 7: Full-stack verification**

```bash
npx tsc --noEmit
cd web && npx tsc --noEmit -p . && npx vite build && cd ..
npm run build
```

Expected: every command exits clean; `npm run build`'s final Vite output shows the built `dist/` bundle sizes with no errors, matching the existing production build.

- [ ] **Step 8: Manual dashboard/Discord verification (do this against a real bot + test guild — not scriptable)**

1. On `/reaction-roles`, create a Reactions panel, add one option with 2 roles selected via the new checkbox picker — save, confirm both role names show in the mapping list and in the live preview joined by a comma.
2. Attempt the same on a Buttons panel and a Dropdown panel — confirm the role picker there is still the original single-select, and that trying to submit more than one role isn't even possible through that UI (there's no separate error-path check needed here since the UI itself only ever produces 0 or 1 ids for those two types).
3. Send the panel. React to the multi-role emoji as a test member — confirm both roles are granted.
4. Temporarily move one of the two roles above the bot's own highest role (Discord server settings), react again as a different member (or un-react/re-react as the same one, if `removeReaction` is off) — confirm the manageable role is still granted and a warning is logged for the other; move the role back afterward.
5. If the panel is `removable`, un-react — confirm both (manageable) roles are revoked.
6. Regression: confirm an existing single-role Reactions/Buttons/Dropdown panel from before this change still grants/revokes/renders exactly as before.

- [ ] **Step 9: Commit**

```bash
git add docs/REACTION_ROLES.md docs/DATABASE.md
git commit -m "docs: document multi-role reaction mappings"
```
