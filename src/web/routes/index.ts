import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../session.js";
import { registerStatusRoutes } from "./status.js";
import { registerDiscordDataRoutes } from "./discordData.js";
import { registerMemberAuditRoutes } from "./memberAudit.js";
import { registerRegistrationRoutes } from "./registrations.js";
import { registerEventAttendanceRoutes } from "./eventAttendance.js";
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
// Each route group is registered as its own child plugin so it gets a real,
// independent Fastify encapsulation context: a hook or decorator a route
// group adds to its own instance in the future can't leak to its siblings
// (or vice versa). The `requireAdmin` preHandler hook is added on the
// shared `api` parent below, BEFORE any child plugin is registered — Fastify
// inherits hooks/decorators from a parent into children declared after them,
// so every group below still gets it despite the extra encapsulation
// boundary. Same reasoning covers the cross-cutting concerns registered even
// further up, directly on the root `app` in server.ts (the same-origin
// check, the central error handler, rate limiting, cookie/formbody): those
// run before `registerApiRoutes` is ever called, so they're ancestors of
// every context created here and remain in effect unchanged.
export function registerApiRoutes(app: FastifyInstance, client: BotClient, config: Config): void {
  app.register(
    async (api) => {
      api.addHook("preHandler", requireAdmin);

      api.register(async (instance) => registerStatusRoutes(instance, client, config));
      api.register(async (instance) => registerDiscordDataRoutes(instance, client, config));
      api.register(async (instance) => registerMemberAuditRoutes(instance));
      api.register(async (instance) => registerRegistrationRoutes(instance, client, config));
      api.register(async (instance) => registerEventAttendanceRoutes(instance, config));
      api.register(async (instance) => registerReactionRolePanelRoutes(instance, client));
      api.register(async (instance) => registerBirthdaySettingsRoutes(instance, client));
      api.register(async (instance) => registerBirthdaysRoutes(instance, client));
      api.register(async (instance) => registerCommandRoutes(instance));
      api.register(async (instance) => registerGeneralSettingsRoutes(instance));
    },
    { prefix: "/api" },
  );
}
