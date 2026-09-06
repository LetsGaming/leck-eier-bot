import type { FastifyInstance, FastifyRequest } from "fastify";
import { listPanels } from "../../db/reactionRolesRepository.js";
import { getCachedMembers, isCacheReady } from "../../services/memberCache.js";
import { countPendingRegistrations, listRecentMemberActivity } from "../../db/memberRecordsRepository.js";
import { countUnmatchedSignups, listEventsInRange, summarizeSignupsForEvents } from "../../db/eventAttendanceRepository.js";
import { listBirthdaysInNextDays } from "../../db/birthdaysRepository.js";
import {
  COMMUNITY_SNAPSHOT_BIRTHDAY_WINDOW_DAYS,
  COMMUNITY_SNAPSHOT_RECENT_ACTIVITY_LIMIT,
  COMMUNITY_SNAPSHOT_UPCOMING_EVENTS_LIMIT,
  COMMUNITY_SNAPSHOT_UPCOMING_EVENTS_WINDOW_DAYS,
} from "../../constants.js";
import type { BotClient, Config } from "../../types.js";
import type { CommunitySnapshot, Status } from "../../../contracts/status.js";

/**
 * Every logged-in role gets `communitySnapshot` (cheap: existing repository
 * calls plus two new bounded lookups, no per-role branching in the queries
 * themselves); `botOwnerStats` — the bot-health fields that were previously
 * flat on this response — is only populated for a 'bot-owner' session (see
 * `requireRole`/`request.session` in `../session.ts`), `null` otherwise.
 * `pendingRegistrationCount`/`unmatchedSignupCount` stay top-level and
 * unconditional — every existing consumer of those two fields keeps working
 * unchanged.
 */
function buildCommunitySnapshot(client: BotClient, config: Config): CommunitySnapshot {
  const guild = client.guilds.cache.get(config.guildId);

  const now = new Date();
  const toIso = new Date(now.getTime() + COMMUNITY_SNAPSHOT_UPCOMING_EVENTS_WINDOW_DAYS * 86_400_000).toISOString();
  const eventsDesc = listEventsInRange({ fromIso: now.toISOString(), toIso, query: "" }).filter(
    (event) => event.status !== "cancelled",
  );
  // listEventsInRange() orders newest-first (see its doc comment) — reverse
  // for "upcoming, soonest first" instead of duplicating that query.
  const upcomingEvents = [...eventsDesc].reverse().slice(0, COMMUNITY_SNAPSHOT_UPCOMING_EVENTS_LIMIT);
  const counts = summarizeSignupsForEvents(upcomingEvents.map((event) => event.id));

  return {
    memberCount: guild?.memberCount ?? null,
    birthdaysThisWeek: listBirthdaysInNextDays(COMMUNITY_SNAPSHOT_BIRTHDAY_WINDOW_DAYS),
    upcomingEvents: upcomingEvents.map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      signupCount: counts.get(event.id)?.total ?? 0,
    })),
    recentAuditActivity: listRecentMemberActivity(COMMUNITY_SNAPSHOT_RECENT_ACTIVITY_LIMIT),
  };
}

export function registerStatusRoutes(app: FastifyInstance, client: BotClient, config: Config): void {
  app.get("/status", async (request: FastifyRequest) => {
    const isBotOwner = request.session!.role === "bot-owner";

    const response: Status = {
      pendingRegistrationCount: countPendingRegistrations(),
      unmatchedSignupCount: countUnmatchedSignups(),
      communitySnapshot: buildCommunitySnapshot(client, config),
      botOwnerStats: isBotOwner
        ? {
            botTag: client.user?.tag ?? null,
            uptimeMs: client.uptime ?? 0,
            cachedMemberCount: isCacheReady() ? getCachedMembers().size : 0,
            reactionRolePanelCount: listPanels().length,
          }
        : null,
    };
    return response;
  });
}
