import { test } from "node:test";
import assert from "node:assert/strict";
import { Collection, PermissionsBitField, type ChatInputCommandInteraction } from "discord.js";
import { checkCommandPermission, resolveCommandGate, TIER_RANK } from "../../src/utils/commandPermissions.js";
import { CommandPermission } from "../../src/constants.js";
import type { BotClient, Config, PermissionGate } from "../../src/types.js";

// --- resolveCommandGate --------------------------------------------------

test("resolveCommandGate: an explicit dashboard override takes priority over the code-declared permission", () => {
  const override: PermissionGate = { mode: "role", roleId: "some-role" };
  const gate = resolveCommandGate({ permission: CommandPermission.Owner, permissionGate: override });
  assert.deepEqual(gate, override);
});

test("resolveCommandGate: falls back to defaultGateFor(permission) when no override is set", () => {
  assert.deepEqual(resolveCommandGate({ permission: undefined, permissionGate: null }), { mode: "everyone" });
  assert.deepEqual(resolveCommandGate({ permission: CommandPermission.None, permissionGate: null }), {
    mode: "everyone",
  });
  assert.deepEqual(resolveCommandGate({ permission: CommandPermission.Admin, permissionGate: null }), {
    mode: "tier",
    tier: "admin",
  });
  assert.deepEqual(resolveCommandGate({ permission: CommandPermission.Owner, permissionGate: null }), {
    mode: "tier",
    tier: "bot-owner",
  });
});

test("resolveCommandGate: falls back to defaultGateFor(permission) when permissionGate is undefined", () => {
  const gate = resolveCommandGate({ permission: CommandPermission.Admin, permissionGate: undefined });
  assert.deepEqual(gate, { mode: "tier", tier: "admin" });
});

// --- TIER_RANK -------------------------------------------------------------

test("TIER_RANK: strictly increasing bot-owner > guild-owner > admin", () => {
  assert.ok(TIER_RANK["bot-owner"] > TIER_RANK["guild-owner"]);
  assert.ok(TIER_RANK["guild-owner"] > TIER_RANK.admin);
});

// --- checkCommandPermission -------------------------------------------------
// Minimal discord.js-shaped mocks — only the surface checkCommandPermission()
// and resolveDashboardRole() (web/auth.ts) actually read.

const GUILD_ID = "guild-1";
const BOT_OWNER_ID = "owner-1";
const ADMIN_ROLE_ID = "role-admin";
const OTHER_ROLE_ID = "role-other";

function makeConfig(): Config {
  return {
    token: "x",
    clientId: "x",
    botOwnerId: BOT_OWNER_ID,
    guildId: GUILD_ID,
    timezone: "Europe/Berlin",
    devMockDiscord: false,
  };
}

/**
 * Builds a minimal mock BotClient with one guild, an "admin" role carrying
 * the Administrator permission, and an optional guild owner id — just enough
 * for resolveDashboardRole()'s guild.ownerId / guild.roles.cache reads.
 */
function makeClient(guildOwnerId: string): BotClient {
  const everyoneRole = {
    id: GUILD_ID,
    permissions: new PermissionsBitField([]),
  };
  const adminRole = {
    id: ADMIN_ROLE_ID,
    permissions: new PermissionsBitField([PermissionsBitField.Flags.Administrator]),
  };
  const otherRole = {
    id: OTHER_ROLE_ID,
    permissions: new PermissionsBitField([]),
  };
  const roles = new Collection<string, { id: string; permissions: PermissionsBitField }>();
  roles.set(GUILD_ID, everyoneRole);
  roles.set(ADMIN_ROLE_ID, adminRole);
  roles.set(OTHER_ROLE_ID, otherRole);

  const guild = {
    id: GUILD_ID,
    ownerId: guildOwnerId,
    roles: { cache: roles, everyone: everyoneRole },
  };
  const guilds = new Collection();
  guilds.set(GUILD_ID, guild);

  return { guilds: { cache: guilds } } as unknown as BotClient;
}

/** A minimal mock ChatInputCommandInteraction carrying just a user id and a guild member's role ids. */
function makeInteraction(userId: string, memberRoleIds: string[] | null): ChatInputCommandInteraction {
  const rolesCache = new Collection<string, unknown>();
  for (const id of memberRoleIds ?? []) rolesCache.set(id, {});

  return {
    user: { id: userId },
    member: memberRoleIds === null ? null : { roles: { cache: rolesCache } },
  } as unknown as ChatInputCommandInteraction;
}

test("checkCommandPermission: 'everyone' mode always passes", async () => {
  const client = makeClient("someone-else");
  const config = makeConfig();
  const interaction = makeInteraction("random-user", []);
  assert.equal(await checkCommandPermission(interaction, client, config, { mode: "everyone" }), true);
});

test("checkCommandPermission: 'role' mode passes only when the member holds that exact role", async () => {
  const client = makeClient("someone-else");
  const config = makeConfig();
  const gate: PermissionGate = { mode: "role", roleId: ADMIN_ROLE_ID };

  const withRole = makeInteraction("user-1", [ADMIN_ROLE_ID]);
  assert.equal(await checkCommandPermission(withRole, client, config, gate), true);

  const withoutRole = makeInteraction("user-2", [OTHER_ROLE_ID]);
  assert.equal(await checkCommandPermission(withoutRole, client, config, gate), false);
});

test("checkCommandPermission: 'role' mode fails when interaction.member is null (DM)", async () => {
  const client = makeClient("someone-else");
  const config = makeConfig();
  const interaction = makeInteraction("user-1", null);
  assert.equal(
    await checkCommandPermission(interaction, client, config, { mode: "role", roleId: ADMIN_ROLE_ID }),
    false,
  );
});

test("checkCommandPermission: 'tier' mode — bot owner passes both admin and bot-owner gates", async () => {
  const client = makeClient("someone-else");
  const config = makeConfig();
  const interaction = makeInteraction(BOT_OWNER_ID, []);
  assert.equal(await checkCommandPermission(interaction, client, config, { mode: "tier", tier: "admin" }), true);
  assert.equal(await checkCommandPermission(interaction, client, config, { mode: "tier", tier: "bot-owner" }), true);
});

test("checkCommandPermission: 'tier' mode — a plain member with no role/ownership fails an admin-tier gate", async () => {
  const client = makeClient("someone-else");
  const config = makeConfig();
  const interaction = makeInteraction("plain-member", [OTHER_ROLE_ID]);
  assert.equal(await checkCommandPermission(interaction, client, config, { mode: "tier", tier: "admin" }), false);
});

// The scenario isAdmin()/isOwner() could never express: a guild owner who
// does NOT hold the Administrator permission bit. resolveDashboardRole()
// resolves them to 'guild-owner' purely from guild.ownerId, independent of
// any role/permission — see web/auth.ts.
test("checkCommandPermission: guild owner without the Administrator bit still passes an admin-tier gate", async () => {
  const GUILD_OWNER_ID = "guild-owner-1";
  const client = makeClient(GUILD_OWNER_ID);
  const config = makeConfig();
  // No roles at all — in particular, not ADMIN_ROLE_ID — so this can only
  // pass via the guild.ownerId check, not a permission-bit check.
  const interaction = makeInteraction(GUILD_OWNER_ID, []);

  assert.equal(await checkCommandPermission(interaction, client, config, { mode: "tier", tier: "admin" }), true);
});

test("checkCommandPermission: guild owner without the Administrator bit fails a bot-owner-tier gate", async () => {
  const GUILD_OWNER_ID = "guild-owner-1";
  const client = makeClient(GUILD_OWNER_ID);
  const config = makeConfig();
  const interaction = makeInteraction(GUILD_OWNER_ID, []);

  assert.equal(await checkCommandPermission(interaction, client, config, { mode: "tier", tier: "bot-owner" }), false);
});
