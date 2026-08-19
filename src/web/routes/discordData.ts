import { ChannelType, type Guild } from "discord.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { canManageRole } from "../../services/reactionRoles.js";
import type { BotClient, Config } from "../../types.js";

const TEXT_CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

/** Dropdown data for the dashboard — channels/roles/emojis of the single configured guild, straight from the gateway cache. */
export function registerDiscordDataRoutes(app: FastifyInstance, client: BotClient, config: Config): void {
  function requireGuild(reply: FastifyReply): Guild | null {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
      reply.code(503).send({ error: "Guild not cached yet — try again shortly." });
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
