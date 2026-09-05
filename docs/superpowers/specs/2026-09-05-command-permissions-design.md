# Editable command permissions + clearer command-tab toggles

## Context

`web/src/pages/Commands.tsx` lists every command with two editable toggles ("Aktiviert"/"Nur auf Server") and a read-only "Berechtigung" column showing `c.permission` (`CommandPermission.None`/`Admin`/`Owner`, `src/constants.ts`) — a value hardcoded per command in source (`Command.permission?: CommandPermission`, `src/types.ts`) and never persisted as an override. `src/db/settingsRepository.ts`'s `CommandOverride` and the `command_settings` table only carry `enabled`/`guild_only`; `src/web/routes/commands.ts`'s `PatchBodySchema` doesn't accept a permission field at all. Enforcement (`hasCommandPermission()` in `src/index.ts`) switches on the hardcoded `CommandPermission` via `isOwner()`/`isAdmin()` (`src/utils/utils.ts`) — bot-owner-id check and Discord Administrator-permission check respectively; there's no "guild-owner" concept in command enforcement at all, unlike the dashboard's own `WebRole` hierarchy (`bot-owner` > `guild-owner` > `admin`, resolved for login by `resolveDashboardRole()` in `src/web/auth.ts`).

The two existing toggles also have no explanation of what they actually do beyond their labels — "Nur auf Server" in particular doesn't say what turning it off does (allows the command in DMs).

## Scope

In scope:
- Making a command's permission requirement editable per-command from the dashboard, as either an arbitrary Discord role or a minimum ownership tier (bot-owner / bot-owner-or-guild-owner / bot-owner-or-guild-owner-or-admin) — resolved via the same hierarchy the dashboard's own login already uses.
- Reusing `resolveDashboardRole()` for tier-mode enforcement instead of duplicating owner/admin-tier logic, since accurately supporting a "guild-owner" tier requires it.
- Brief inline help text clarifying what "Aktiviert" and "Nur auf Server" do.

Out of scope (explicitly deferred, per discussion):
- Any broader restructuring of the Commands tab beyond the above (no categories, search, usage stats, or other additions) — nothing further was identified as missing once these two fixes are made; revisit only if the page still feels incomplete after they ship.
- The wider cross-feature DRY/refactor pass (tracked separately) — reusing `resolveDashboardRole()` here is narrowly justified by correctness (tier-mode needs real guild-owner detection), not treated as a stand-in for that broader effort.

## Data model

New type in `src/types.ts`:

```ts
export type PermissionGate =
  | { mode: "everyone" }
  | { mode: "tier"; tier: WebRole } // this tier or higher, per resolveDashboardRole's hierarchy
  | { mode: "role"; roleId: string };
```

`CommandOverride` (`src/db/settingsRepository.ts`) gains `permissionGate: PermissionGate | null`. `null` (the default — no row, or a row predating this column) means "use the command's code-declared `CommandPermission` default," mapped as: `None` → `{mode: "everyone"}`, `Admin` → `{mode: "tier", tier: "admin"}`, `Owner` → `{mode: "tier", tier: "bot-owner"}`. This mapping function (`defaultGateFor(permission?: CommandPermission): PermissionGate`) lives alongside the type, used both by enforcement and by the dashboard's "Standard: …" hint. No existing command file's declared `permission` needs to change — the override, once set, simply takes priority.

**Migration (v31)**, additive column, no rebuild needed (nullable, SQLite `ADD COLUMN` works directly — unlike the rename case v21 needed):

```sql
ALTER TABLE command_settings ADD COLUMN permission_gate TEXT;
```

`getCommandOverride`/`getAllCommandOverrides`/`setCommandOverride` (`src/db/settingsRepository.ts`) parse/serialize `permission_gate` as JSON, `null` passed through as SQL `NULL`, matching the existing `allowed_role_ids` JSON-column convention.

## Enforcement

`resolveDashboardRole()` in `src/web/auth.ts` becomes exported (it's already guild-and-config-driven, not web-request-specific — takes `(client, config, userId, roleIds)`). New `src/utils/commandPermissions.ts`:

```ts
export function resolveCommandGate(cmd: { permission?: CommandPermission; permissionGate: PermissionGate | null }): PermissionGate {
  return cmd.permissionGate ?? defaultGateFor(cmd.permission);
}

export async function checkCommandPermission(
  interaction: ChatInputCommandInteraction,
  client: BotClient,
  config: Config,
  gate: PermissionGate,
): Promise<boolean> {
  switch (gate.mode) {
    case "everyone":
      return true;
    case "role":
      return interaction.member !== null && "cache" in interaction.member.roles
        ? interaction.member.roles.cache.has(gate.roleId)
        : false;
    case "tier": {
      const roleIds = interaction.member && "cache" in interaction.member.roles
        ? [...interaction.member.roles.cache.keys()]
        : [];
      const resolved = resolveDashboardRole(client, config, interaction.user.id, roleIds);
      return resolved !== null && TIER_RANK[resolved] >= TIER_RANK[gate.tier];
    }
  }
}
```

(`TIER_RANK`: `{ "admin": 0, "guild-owner": 1, "bot-owner": 2 }` — higher number outranks lower, matching `resolveDashboardRole`'s own "checked highest first" comment.) `src/index.ts`'s `hasCommandPermission()` becomes a thin wrapper: resolve the gate via `resolveCommandGate(cmd)`, call `checkCommandPermission`, keep its existing ephemeral-reply-on-denial behavior (reusing `createNoAdminEmbed()`/plain rejection message depending on gate mode, mirroring today's owner-vs-admin message split).

`src/loaders/commandLoader.ts`'s `loadCommands()` and `listCommandDefinitions()` carry `permissionGate` through from `getCommandOverride()` alongside the existing `enabled`/`guildOnly` (both already spread the override object — `permissionGate` rides along once added to `CommandOverride`, no structural change to those functions needed beyond the type gaining the field).

## Dashboard

`web/src/types.ts`'s `CommandDef` gains `permissionGate: PermissionGate | null` (keeping `permission: CommandPermission | undefined` as-is, for computing the "Standard: …" fallback label). `src/web/routes/commands.ts`'s `PatchBodySchema` gains:

```ts
permissionGate: z.union([
  z.object({ mode: z.literal("everyone") }),
  z.object({ mode: z.literal("tier"), tier: z.enum(["bot-owner", "guild-owner", "admin"]) }),
  z.object({ mode: z.literal("role"), roleId: z.string() }),
]).nullable().optional(),
```

`Commands.tsx`'s "Berechtigung" cell becomes: a mode `<select>` (Jeder / Rolle / Mindest-Stufe), and conditionally either a tier `<select>` (Bot-Besitzer / Bot- oder Server-Besitzer / Bot-Besitzer, Server-Besitzer oder Admin) or a role picker (`SearchableSelect` fed by the already-existing `api.roles()`, same pattern `ReactionRoles.tsx` uses for `RoleOption[]`). A muted hint line under the cell reads "Standard: {label for defaultGateFor(c.permission)}" so the fallback stays visible even once a mode is selected. `toggle()`'s generic `field`/`value` pattern doesn't fit a structured object cleanly, so a separate `updatePermissionGate(name, gate)` handler calls `api.updateCommand(name, { permissionGate: gate })`.

"Aktiviert" and "Nur auf Server" each get a `<p className="muted small">` beneath their column header (or a `title` attribute on the switch, consistent with whichever pattern reads better once implemented) — "Aktiviert" clarifies the existing top-of-page note already covers it (no new text needed there); "Nur auf Server" gets new text along the lines of "Wenn deaktiviert, kann der Befehl auch per Direktnachricht an den Bot verwendet werden."

## Testing

- Backend: unit tests for `resolveCommandGate` (override present vs. falling back to `defaultGateFor`), `checkCommandPermission` for all three modes (everyone/role/tier), and tier-mode specifically verifying a guild-owner who lacks the Administrator permission bit still passes an `admin`-tier gate (the scenario `isAdmin()` today cannot handle) while failing a `bot-owner`-tier gate.
- Backend: migration test confirming v31's `ALTER TABLE ADD COLUMN` leaves existing rows with `permission_gate = NULL`, correctly falling back to the code-declared default.
- Frontend: manual verification of the mode selector switching between role-picker and tier-picker, the "Standard: …" hint updating correctly, and round-tripping a saved `permissionGate` through reload.
- End-to-end (manual, via the dev mock-Discord path): set a role-mode gate on a test command, confirm a member with that role can invoke it and one without cannot; set a tier-mode gate at `guild-owner` and confirm the mock guild-owner account passes while a plain admin-permission account does not.
