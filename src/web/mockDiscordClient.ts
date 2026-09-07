import { ChannelType, Collection, PermissionsBitField } from "discord.js";
import type { Config, BotClient } from "../types.js";
import type { GuildMember } from "discord.js";

/** One synthetic guild member — enough surface for every dashboard route that reads a cached `GuildMember` (username/avatar/joinedAt/roles/displayName). */
interface MockMemberSpec {
  id: string;
  username: string;
  globalName: string | null;
  nickname: string | null;
  daysAgoJoined: number;
  roleIds: string[];
  avatarIndex: number;
}

const MOCK_MEMBER_SPECS: MockMemberSpec[] = [
  { id: "100000000000000001", username: "arasaka_yuki", globalName: "Yuki", nickname: null, daysAgoJoined: 420, roleIds: ["mock-role-admin", "mock-role-member"], avatarIndex: 0 },
  { id: "100000000000000002", username: "moon.lark", globalName: "Lark", nickname: "🌙Lark", daysAgoJoined: 210, roleIds: ["mock-role-mod", "mock-role-member"], avatarIndex: 1 },
  { id: "100000000000000003", username: "ghostwire", globalName: "Ghost", nickname: null, daysAgoJoined: 95, roleIds: ["mock-role-member"], avatarIndex: 2 },
  { id: "100000000000000004", username: "sable_fox", globalName: "Sable", nickname: null, daysAgoJoined: 30, roleIds: ["mock-role-member"], avatarIndex: 3 },
  { id: "100000000000000005", username: "night.owl99", globalName: null, nickname: null, daysAgoJoined: 3, roleIds: [], avatarIndex: 4 },
];

function makeMockMember(spec: MockMemberSpec, roles: Collection<string, unknown>): GuildMember {
  const roleCache = new Collection<string, unknown>();
  for (const roleId of spec.roleIds) {
    const role = roles.get(roleId);
    if (role) roleCache.set(roleId, role);
  }

  const joinedAt = new Date(Date.now() - spec.daysAgoJoined * 24 * 60 * 60 * 1000);
  const avatarUrl = `https://cdn.discordapp.com/embed/avatars/${spec.avatarIndex % 6}.png`;

  const member = {
    id: spec.id,
    user: {
      id: spec.id,
      username: spec.username,
      globalName: spec.globalName,
      avatar: null,
      discriminator: "0",
      bot: false,
    },
    nickname: spec.nickname,
    displayName: spec.nickname ?? spec.globalName ?? spec.username,
    joinedAt,
    roles: { cache: roleCache },
    displayAvatarURL: () => avatarUrl,
  };

  return member as unknown as GuildMember;
}

/**
 * A synthetic stand-in for the real discord.js `Client`, used only when
 * `DEV_MOCK_DISCORD=true` (see docs/CONFIGURATION.md). It never touches the
 * network — no gateway connection, no Discord REST calls — and only
 * implements the specific surface the web dashboard reads: the configured
 * guild's roles/channels/emojis, the bot's own member (`guild.members.me`),
 * and a `channels.fetch` that resolves to a harmless fake text channel
 * instead of a real one. Nothing outside `src/web/` should ever receive
 * this client — the real bot/event/command code paths are skipped entirely
 * in mock mode (see `src/index.ts`).
 */
export function createMockClient(config: Config): BotClient {
  const guildId = config.guildId;
  const everyoneRole = {
    id: guildId,
    name: "@everyone",
    hexColor: "#000000",
    position: 0,
    managed: false,
    permissions: new PermissionsBitField([]),
  };

  const roles = new Collection<string, typeof everyoneRole>();
  roles.set(guildId, everyoneRole);
  roles.set("mock-role-admin", {
    id: "mock-role-admin",
    name: "Admin",
    hexColor: "#e74c3c",
    position: 10,
    managed: false,
    permissions: new PermissionsBitField([PermissionsBitField.Flags.Administrator]),
  });
  roles.set("mock-role-mod", {
    id: "mock-role-mod",
    name: "Moderator",
    hexColor: "#3498db",
    position: 5,
    managed: false,
    permissions: new PermissionsBitField([PermissionsBitField.Flags.ManageMessages]),
  });
  roles.set("mock-role-member", {
    id: "mock-role-member",
    name: "Mitglied",
    hexColor: "#95a5a6",
    position: 1,
    managed: false,
    permissions: new PermissionsBitField([]),
  });

  const channels = new Collection<string, { id: string; name: string; type: ChannelType; position: number }>();
  channels.set("mock-channel-general", {
    id: "mock-channel-general",
    name: "allgemein",
    type: ChannelType.GuildText,
    position: 0,
  });
  channels.set("mock-channel-mod", {
    id: "mock-channel-mod",
    name: "mod-only",
    type: ChannelType.GuildText,
    position: 1,
  });
  channels.set("mock-channel-voice", {
    id: "mock-channel-voice",
    name: "Voice Lounge",
    type: ChannelType.GuildVoice,
    position: 0,
  });

  const botMember = {
    permissions: new PermissionsBitField([
      PermissionsBitField.Flags.ManageRoles,
      PermissionsBitField.Flags.ManageMessages,
    ]),
    permissionsIn: () => new PermissionsBitField([PermissionsBitField.Flags.ManageMessages]),
    roles: { highest: { position: 99 } },
  };

  const membersCache = new Collection<string, GuildMember>();
  for (const spec of MOCK_MEMBER_SPECS) {
    membersCache.set(spec.id, makeMockMember(spec, roles));
  }

  const guild = {
    id: guildId,
    name: "Mock-Server (DEV_MOCK_DISCORD)",
    ownerId: config.botOwnerId,
    memberCount: membersCache.size,
    roles: { cache: roles, everyone: everyoneRole },
    channels: { cache: channels },
    emojis: { cache: new Collection() },
    members: {
      me: botMember,
      cache: membersCache,
      // Mirrors real discord.js: fetch() with no args resolves the (already-populated) cache; with a userId, resolves that one member or rejects like a real 404.
      fetch: async (userId?: string) => {
        if (userId === undefined) return membersCache;
        const member = membersCache.get(userId);
        if (!member) throw new Error(`Unknown Member: ${userId}`);
        return member;
      },
    },
  };

  const guilds = new Collection();
  guilds.set(guildId, guild);

  const mockTextChannel = {
    id: "mock-channel-fetched",
    name: "mock-channel",
    isTextBased: () => true,
    isDMBased: () => false,
    send: async () => ({ id: "mock-message-id" }),
    messages: { fetch: async () => null },
  };

  return {
    user: { id: "mock-bot-id", tag: "MockBot#0000" },
    uptime: 0,
    commands: new Collection(),
    guilds: { cache: guilds },
    channels: {
      cache: new Collection(),
      fetch: async () => mockTextChannel,
    },
    // Double-cast through unknown is necessary here: a full mock implementing
    // every BotClient member isn't practical for dev-only test infrastructure.
  } as unknown as BotClient;
}
