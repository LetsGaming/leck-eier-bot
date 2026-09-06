import { z } from "zod";
import type { ZodFastifyInstance } from "../utils.js";
import {
  listSignups,
  getSignup,
  linkSignupToUser,
  deleteEvent,
  listVoiceLogForUser,
  getEventById,
  listEventsInRange,
  listEventsAllMonths,
  listEventsWithUnresolvedSignups,
  listEventStartTimes,
  summarizeSignupsForEvents,
  type EventSignupCounts,
} from "../../db/eventAttendanceRepository.js";
import { getCachedMembers } from "../../services/memberCache.js";
import { deriveAttendance, recomputeAttendanceForEvent } from "../../services/eventAttendance.js";
import { buildAvatarUrl } from "./memberAudit.js";
import { monthRangeUtc, currentMonthKey, monthKeyInTimezone } from "../../utils/timezone.js";
import type { ApolloEvent, ApolloEventSignup, Config } from "../../types.js";
import type {
  EventAttendanceMonthsResponse,
  EventSignupEntry,
  EventAttendanceEntry,
  EventAttendanceSummary,
  EventAttendanceListResponse,
} from "../../../contracts/eventAttendance.js";

/** Cap on results for the unbounded "all months" / "problems" list modes — see `ListQuerySchema`'s mode precedence. */
const PROBLEMS_MODE_LIMIT = 200;

/** `summarizeSignupsForEvents()` omits events with zero signups (its GROUP BY produces no row) — this backfills those. */
const ZERO_SIGNUP_COUNTS: EventSignupCounts = {
  total: 0,
  accepted: 0,
  tentative: 0,
  declined: 0,
  unresolved: 0,
  onTime: 0,
  late: 0,
  noShow: 0,
  leftEarly: 0,
  notTracked: 0,
  lateWithinGrace: 0,
  earlyWithinGrace: 0,
  lateMinutesTotal: 0,
};

/** Shared `:id` param validation for the event-attendance detail/delete routes — 400 on a non-numeric id, `null` on success so the caller can proceed. */
function parseEventIdParam(id: string): number | null {
  const numericId = Number(id);
  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
}

const LinkSignupBodySchema = z.object({ userId: z.string().nullable() });
const ListQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  q: z.string().optional().default(""),
  scope: z.enum(["month", "all"]).optional().default("month"),
  problems: z.enum(["0", "1"]).optional().default("0"),
});

const EventIdParamsSchema = z.object({ id: z.string() });
const SignupIdParamsSchema = z.object({ signupId: z.string() });

/** Dashboard visibility/control over Apollo event attendance tracking — see `apolloEventWatcher.ts`/`services/eventAttendance.ts`. */
export function registerEventAttendanceRoutes(app: ZodFastifyInstance, config: Config): void {
  function serializeSignup(event: ApolloEvent, signup: ApolloEventSignup): EventSignupEntry {
    const cache = getCachedMembers();
    const cached = signup.userId ? cache.get(signup.userId) : undefined;

    // The DB only has attendance fields settled at completion; while the
    // event is still 'active', compute them live from the voice log so the
    // dashboard reflects what's happening right now.
    let attendanceStatus = signup.attendanceStatus;
    let firstJoinedAt = signup.firstJoinedAt;
    let lastLeftAt = signup.lastLeftAt;
    let lateMinutes = signup.lateMinutes;
    let earlyMinutes = signup.earlyMinutes;
    if (event.status === "active" && signup.choice !== "declined" && signup.userId) {
      const derived = deriveAttendance(listVoiceLogForUser(event.id, signup.userId), event.startsAt, event.endsAt);
      attendanceStatus = derived.status;
      firstJoinedAt = derived.firstJoinedAt;
      lastLeftAt = derived.lastLeftAt;
      lateMinutes = derived.lateMinutes;
      earlyMinutes = derived.earlyMinutes;
    }

    return {
      id: signup.id,
      rawName: signup.rawName,
      choice: signup.choice,
      userId: signup.userId,
      displayName: cached?.displayName ?? null,
      nickname: cached?.nickname ?? null,
      avatarUrl: cached ? cached.displayAvatarURL({ size: 64 }) : signup.userId ? buildAvatarUrl(signup.userId, null) : null,
      matchSource: signup.matchSource,
      attendanceStatus,
      firstJoinedAt,
      lastLeftAt,
      lateMinutes,
      earlyMinutes,
      withdrawnAt: signup.withdrawnAt,
    };
  }

  function serializeEvent(event: ApolloEvent & { signups: ApolloEventSignup[] }): EventAttendanceEntry {
    return {
      id: event.id,
      apolloEventId: event.apolloEventId,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: event.status,
      trackingIncomplete: event.trackingIncomplete,
      messageUrl: `https://discord.com/channels/${config.guildId}/${event.channelId}/${event.messageId}`,
      voiceChannelId: event.voiceChannelId,
      signups: event.signups.map((signup) => serializeSignup(event, signup)),
    };
  }

  function serializeEventSummary(event: ApolloEvent, counts: EventSignupCounts): EventAttendanceSummary {
    return {
      id: event.id,
      apolloEventId: event.apolloEventId,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: event.status,
      trackingIncomplete: event.trackingIncomplete,
      messageUrl: `https://discord.com/channels/${config.guildId}/${event.channelId}/${event.messageId}`,
      voiceChannelId: event.voiceChannelId,
      counts,
    };
  }

  /**
   * `summarizeSignupsForEvents()` reads persisted DB columns directly, which
   * are NOT settled for an event with status 'active' — that event's
   * attendance is still being computed live via
   * deriveAttendance()/serializeSignup(). At most one event is ever active at
   * a time, so for that single event (if present in `events`) we tally
   * counts in JS from `serializeSignup()`'s live-derived per-signup values
   * instead of trusting the SQL aggregate.
   */
  function summarizeEvents(events: ApolloEvent[]): Map<number, EventSignupCounts> {
    const activeEvent = events.find((event) => event.status === "active");
    const staticIds = events.filter((event) => event.id !== activeEvent?.id).map((event) => event.id);
    const result = summarizeSignupsForEvents(staticIds);

    if (activeEvent) {
      const signups = listSignups(activeEvent.id).map((signup) => serializeSignup(activeEvent, signup));
      const counts: EventSignupCounts = { ...ZERO_SIGNUP_COUNTS, total: signups.length };
      for (const signup of signups) {
        if (signup.choice === "accepted") counts.accepted++;
        else if (signup.choice === "tentative") counts.tentative++;
        else if (signup.choice === "declined") counts.declined++;

        if ((signup.matchSource === "unmatched" || signup.matchSource === "ambiguous") && !signup.withdrawnAt) {
          counts.unresolved++;
        }

        switch (signup.attendanceStatus) {
          case "on_time":
            counts.onTime++;
            if ((signup.lateMinutes ?? 0) > 0) counts.lateWithinGrace++;
            break;
          case "late":
            counts.late++;
            break;
          case "no_show":
            counts.noShow++;
            break;
          case "left_early":
            counts.leftEarly++;
            break;
          case "not_tracked":
            counts.notTracked++;
            break;
        }
        if ((signup.earlyMinutes ?? 0) > 0 && signup.attendanceStatus !== "left_early") counts.earlyWithinGrace++;
        counts.lateMinutesTotal += signup.lateMinutes ?? 0;
      }
      result.set(activeEvent.id, counts);
    }

    return result;
  }

  app.get("/events/attendance", { schema: { querystring: ListQuerySchema } }, async (request) => {
    const { q, scope, problems, month } = request.query;

    let mode: "month" | "all" | "problems";
    let events: ApolloEvent[];
    let resolvedMonth: string | null;

    if (problems === "1") {
      mode = "problems";
      events = listEventsWithUnresolvedSignups({ query: q, limit: PROBLEMS_MODE_LIMIT });
      resolvedMonth = null;
    } else if (scope === "all") {
      mode = "all";
      events = listEventsAllMonths({ query: q, limit: PROBLEMS_MODE_LIMIT });
      resolvedMonth = null;
    } else {
      mode = "month";
      resolvedMonth = month ?? currentMonthKey(config.timezone);
      const { fromIso, toIso } = monthRangeUtc(resolvedMonth, config.timezone);
      events = listEventsInRange({ fromIso, toIso, query: q });
    }

    const counts = summarizeEvents(events);
    const truncated = mode !== "month" && events.length === PROBLEMS_MODE_LIMIT;
    const summaries = events.map((event) => serializeEventSummary(event, counts.get(event.id) ?? ZERO_SIGNUP_COUNTS));

    const response: EventAttendanceListResponse = {
      mode,
      month: resolvedMonth,
      timezone: config.timezone,
      events: summaries,
      total: summaries.length,
      truncated,
    };
    return response;
  });

  app.get("/events/attendance/months", async () => {
    const counts: Record<string, number> = {};
    for (const startsAt of listEventStartTimes()) {
      const key = monthKeyInTimezone(startsAt, config.timezone);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const response: EventAttendanceMonthsResponse = {
      months: Object.keys(counts).sort().reverse(),
      counts,
      current: currentMonthKey(config.timezone),
      timezone: config.timezone,
    };
    return response;
  });

  app.get("/events/attendance/:id", { schema: { params: EventIdParamsSchema } }, async (request, reply) => {
    const { id } = request.params;
    const eventId = parseEventIdParam(id);
    if (eventId === null) return reply.code(400).send({ error: "Ungültige Event-ID" });

    const event = getEventById(eventId);
    if (!event) return reply.code(404).send({ error: "Event nicht gefunden." });

    return serializeEvent({ ...event, signups: listSignups(eventId) });
  });

  app.patch(
    "/events/attendance/signups/:signupId",
    { schema: { params: SignupIdParamsSchema, body: LinkSignupBodySchema } },
    async (request, reply) => {
      const { signupId } = request.params;
      const id = Number(signupId);

      const signup = getSignup(id);
      if (!signup) return reply.code(404).send({ error: "Anmeldung nicht gefunden." });

      const { userId } = request.body;
      if (userId !== null) {
        if (!getCachedMembers().has(userId)) {
          return reply.code(400).send({ error: "Mitglied nicht gefunden." });
        }
        const otherSignups = listSignups(signup.eventId);
        if (otherSignups.some((s) => s.id !== id && s.userId === userId)) {
          return reply.code(409).send({ error: "Dieses Mitglied ist bereits einer anderen Anmeldung dieses Events zugeordnet." });
        }
      }

      linkSignupToUser(id, userId);
      const event = getEventById(signup.eventId);
      if (!event) return reply.code(404).send({ error: "Event nicht gefunden." });
      // A link made before the event has ever activated has nothing to
      // recompute yet — attendance only starts existing once tracking does.
      if (event.status !== "scheduled") {
        recomputeAttendanceForEvent(signup.eventId);
      }

      return serializeEvent({ ...getEventById(signup.eventId)!, signups: listSignups(signup.eventId) });
    },
  );

  /** Mainly a test-cleanup/mistake-recovery affordance — destroys the event's full attendance history, cascading via the FK. */
  app.delete("/events/attendance/:id", { schema: { params: EventIdParamsSchema } }, async (request, reply) => {
    const { id } = request.params;
    const eventId = parseEventIdParam(id);
    if (eventId === null) return reply.code(400).send({ error: "Ungültige Event-ID" });

    deleteEvent(eventId);
    return reply.code(204).send();
  });
}
