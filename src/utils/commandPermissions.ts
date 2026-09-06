import type { ChatInputCommandInteraction } from "discord.js";
import { resolveDashboardRole } from "../web/auth.js";
import { defaultGateFor } from "../types.js";
import type { BotClient, Config, PermissionGate, WebRole } from "../types.js";
import type { CommandPermission } from "../constants.js";

/**
 * Strict dashboard RBAC hierarchy, highest first — mirrors
 * `resolveDashboardRole()`'s own "checked highest first" ordering
 * (web/auth.ts). A higher number outranks a lower one, so a "tier" gate
 * passes when the resolved role's rank is >= the gate's tier's rank.
 */
export const TIER_RANK: Record<WebRole, number> = {
  admin: 0,
  "guild-owner": 1,
  "bot-owner": 2,
};

/**
 * Resolves the effective `PermissionGate` for a command: its dashboard
 * override if one has been set, else the gate implied by its code-declared
 * `CommandPermission` (see `defaultGateFor()` in types.ts).
 */
export function resolveCommandGate(cmd: {
  permission?: CommandPermission;
  permissionGate: PermissionGate | null | undefined;
}): PermissionGate {
  return cmd.permissionGate ?? defaultGateFor(cmd.permission);
}

/**
 * Evaluates whether `interaction`'s invoking member satisfies `gate`. Never
 * replies or has other side effects — see `hasCommandPermission()` in
 * src/index.ts for the reply-on-denial wrapper around this.
 */
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
      // interaction.member is null in a DM; when present, roles is either a
      // real GuildMemberRoleManager (has .cache) or (for some API-shaped
      // interactions) a plain string array — only the former lets us check
      // role membership directly.
      return interaction.member !== null && "cache" in interaction.member.roles
        ? interaction.member.roles.cache.has(gate.roleId)
        : false;
    case "tier": {
      const roleIds =
        interaction.member && "cache" in interaction.member.roles
          ? [...interaction.member.roles.cache.keys()]
          : [];
      const resolved = resolveDashboardRole(client, config, interaction.user.id, roleIds);
      return resolved !== null && TIER_RANK[resolved] >= TIER_RANK[gate.tier];
    }
  }
}
