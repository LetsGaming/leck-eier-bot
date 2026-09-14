import type { FastifyInstance } from "fastify";
import { createRequireDashboardUser } from "../accessControl.js";
import { insertAuditEntry } from "../../db/auditLogRepository.js";
import { registerStatusRoutes } from "./status.js";
import { registerDiscordDataRoutes } from "./discordData.js";
import { registerMemberAuditRoutes } from "./memberAudit.js";
import { registerRegistrationRoutes } from "./registrations.js";
import { registerEventAttendanceRoutes } from "./eventAttendance.js";
import { registerEventRoutes } from "./events.js";
import { registerEventTemplateRoutes } from "./eventTemplates.js";
import { registerReactionRolePanelRoutes } from "./reactionRolePanels.js";
import { registerBirthdaySettingsRoutes } from "./birthdaySettings.js";
import { registerBirthdaysRoutes } from "./birthdays.js";
import { registerCommandRoutes } from "./commands.js";
import { registerGeneralSettingsRoutes } from "./generalSettings.js";
import { registerAccessControlRoutes } from "./accessControl.js";
import { registerAuditLogRoutes } from "./auditLog.js";
import type { BotClient, Config } from "../../types.js";

const NON_MUTATING_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Everything under /api except /api/me (which lives in web/auth.ts, since
 * it must be reachable — and answer 401, not fall through this guard — for
 * a logged-out client to discover that it's logged out).
 */
// Each route group is registered as its own child plugin so it gets a real,
// independent Fastify encapsulation context: a hook or decorator a route
// group adds to its own instance in the future can't leak to its siblings
// (or vice versa). The `createRequireDashboardUser` preHandler hook is added
// on the shared `api` parent below, BEFORE any child plugin is registered —
// Fastify inherits hooks/decorators from a parent into children declared
// after them, so every group below still gets it despite the extra
// encapsulation boundary. It resolves the session and live-re-resolves its
// WebRole tier (bot-owner/guild-owner/admin/moderator) on every request —
// see web/accessControl.ts — rejecting outright if that tier can no longer
// be substantiated; a route that needs to gate further than "any resolved
// tier" narrows on top of it, either via `requireRole(...)` (a fixed tier
// floor — see commands.ts/accessControl.ts) or `requireFeature(key)` (a
// dashboard-admin-configurable gate — see web/accessControl.ts's FEATURES).
// Same reasoning covers the cross-cutting concerns registered even further
// up, directly on the root `app` in server.ts (the same-origin check, the
// central error handler, rate limiting, cookie/formbody): those run before
// `registerApiRoutes` is ever called, so they're ancestors of every context
// created here and remain in effect unchanged.
export function registerApiRoutes(app: FastifyInstance, client: BotClient, config: Config): void {
  app.register(
    async (api) => {
      api.addHook("preHandler", createRequireDashboardUser(client, config));

      // Lightweight accountability log for every dashboard mutation — who
      // did what, not what changed (see docs/DASHBOARD.md's RBAC section).
      // Skips read-only requests and anything rejected before a session
      // existed (nothing meaningful to attribute a 401 to).
      api.addHook("onResponse", async (request, reply) => {
        if (NON_MUTATING_METHODS.has(request.method) || !request.session) return;
        insertAuditEntry({
          at: new Date().toISOString(),
          userId: request.session.userId,
          username: request.session.username,
          role: request.session.role,
          method: request.method,
          path: request.routeOptions.url ?? request.url,
          statusCode: reply.statusCode,
        });
      });

      api.register(async (instance) => registerStatusRoutes(instance, client, config));
      api.register(async (instance) => registerDiscordDataRoutes(instance, client, config));
      api.register(async (instance) => registerMemberAuditRoutes(instance));
      api.register(async (instance) => registerRegistrationRoutes(instance, client, config));
      api.register(async (instance) => registerEventAttendanceRoutes(instance, config));
      api.register(async (instance) => registerEventRoutes(instance, client));
      api.register(async (instance) => registerEventTemplateRoutes(instance));
      api.register(async (instance) => registerReactionRolePanelRoutes(instance, client));
      api.register(async (instance) => registerBirthdaySettingsRoutes(instance, client));
      api.register(async (instance) => registerBirthdaysRoutes(instance, client));
      api.register(async (instance) => registerCommandRoutes(instance));
      api.register(async (instance) => registerGeneralSettingsRoutes(instance));
      api.register(async (instance) => registerAccessControlRoutes(instance));
      api.register(async (instance) => registerAuditLogRoutes(instance));
    },
    { prefix: "/api" },
  );
}
