import { ChannelType, Collection, PermissionsBitField } from "discord.js";
import type { Config, BotClient } from "../types.js";

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

  const guild = {
    id: guildId,
    name: "Mock-Server (DEV_MOCK_DISCORD)",
    ownerId: config.botOwnerId,
    memberCount: 3,
    roles: { cache: roles, everyone: everyoneRole },
    channels: { cache: channels },
    emojis: { cache: new Collection() },
    members: { me: botMember, cache: new Collection(), fetch: async () => new Collection() },
  };

  const guilds = new Collection();
  guilds.set(guildId, guild);

  const mockTextChannel = {
    id: "mock-channel-fetched",
    name: "mock-channel",
    isTextBased: () => true,
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
  } as unknown as BotClient;
}
