import { ChannelType, type Guild } from "discord.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { canManageRole } from "../../services/reactionRoles.js";
import { listTemporaryVoiceChannelIds } from "../../db/temporaryVoiceChannelsRepository.js";
import type { BotClient, Config } from "../../types.js";

const TEXT_CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const VOICE_CHANNEL_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);

/** Dropdown data for the dashboard — channels/roles/emojis of the single configured guild, straight from the gateway cache. */
export function registerDiscordDataRoutes(app: FastifyInstance, client: BotClient, config: Config): void {
  function requireGuild(reply: FastifyReply): Guild | null {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
      reply.code(503).send({ error: "Server noch nicht im Cache — versuche es gleich noch einmal." });
      return null;
    }
    return guild;
  }

  app.get("/discord/channels", async (_request, reply) => {
    const guild = requireGuild(reply);
    if (!guild) return;
    return guild.channels.cache
      .filter((c) => TEXT_CHANNEL_TYPES.has(c.type))
      .map((c) => ({ id: c.id, name: c.name, position: "position" in c ? c.position : 0 }))
      .sort((a, b) => a.position - b.position);
  });

  app.get("/discord/voice-channels", async (_request, reply) => {
    const guild = requireGuild(reply);
    if (!guild) return;
    // Bot-managed temporary group voice channels are throwaway event
    // infrastructure, not a channel an admin should ever be offered as an
    // attendance-tracking or template default — see `services/events.ts`'s
    // and `generalSettings.ts`'s matching write-side rejection.
    const tempIds = new Set(listTemporaryVoiceChannelIds());
    return guild.channels.cache
      .filter((c) => VOICE_CHANNEL_TYPES.has(c.type) && !tempIds.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, position: "position" in c ? c.position : 0 }))
      .sort((a, b) => a.position - b.position);
  });

  app.get("/discord/categories", async (_request, reply) => {
    const guild = requireGuild(reply);
    if (!guild) return;
    return guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildCategory)
      .map((c) => ({ id: c.id, name: c.name, position: "position" in c ? c.position : 0 }))
      .sort((a, b) => a.position - b.position);
  });

  app.get("/discord/roles", async (_request, reply) => {
    const guild = requireGuild(reply);
    if (!guild) return;
    return [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        position: r.position,
        managed: r.managed,
        manageable: canManageRole(guild, r.id).ok,
      }))
      .sort((a, b) => b.position - a.position);
  });

  app.get("/discord/emojis", async (_request, reply) => {
    const guild = requireGuild(reply);
    if (!guild) return;
    return guild.emojis.cache.map((e) => ({ id: e.id, name: e.name, animated: e.animated }));
  });
}
