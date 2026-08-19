import type { FastifyInstance } from "fastify";
import { listPanels } from "../../db/reactionRolesRepository.js";
import { getCachedMembers, isCacheReady } from "../../services/memberCache.js";
import type { BotClient, Config } from "../../types.js";

export function registerStatusRoutes(app: FastifyInstance, client: BotClient, config: Config): void {
  app.get("/status", async () => {
    const guild = client.guilds.cache.get(config.guildId);
    return {
      botTag: client.user?.tag ?? null,
      uptimeMs: client.uptime ?? 0,
      guildName: guild?.name ?? null,
      guildMemberCount: guild?.memberCount ?? null,
      cachedMemberCount: isCacheReady() ? getCachedMembers().size : 0,
      reactionRolePanelCount: listPanels().length,
    };
  });
}
