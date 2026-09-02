import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../session.js";
import { registerStatusRoutes } from "./status.js";
import { registerDiscordDataRoutes } from "./discordData.js";
import { registerMemberAuditRoutes } from "./memberAudit.js";
import { registerPendingRegistrationRoutes } from "./pendingRegistrations.js";
import { registerReactionRolePanelRoutes } from "./reactionRolePanels.js";
import { registerBirthdaySettingsRoutes } from "./birthdaySettings.js";
import { registerBirthdaysRoutes } from "./birthdays.js";
import { registerCommandRoutes } from "./commands.js";
import { registerGeneralSettingsRoutes } from "./generalSettings.js";
import type { BotClient, Config } from "../../types.js";

/**
 * Everything under /api except /api/me (which lives in web/auth.ts, since
 * it must be reachable — and answer 401, not fall through this guard — for
 * a logged-out client to discover that it's logged out).
 */
export function registerApiRoutes(app: FastifyInstance, client: BotClient, config: Config): void {
  app.register(
    async (api) => {
      api.addHook("preHandler", requireAdmin);
      registerStatusRoutes(api, client, config);
      registerDiscordDataRoutes(api, client, config);
      registerMemberAuditRoutes(api);
      registerPendingRegistrationRoutes(api, client, config);
      registerReactionRolePanelRoutes(api, client);
      registerBirthdaySettingsRoutes(api, client);
      registerBirthdaysRoutes(api, client);
      registerCommandRoutes(api, client, config);
      registerGeneralSettingsRoutes(api);
    },
    { prefix: "/api" },
  );
}
