import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listEventsPage,
  listSignups,
  getSignup,
  linkSignupToUser,
  deleteEvent,
  listVoiceLogForUser,
  getEventById,
} from "../../db/eventAttendanceRepository.js";
import { getCachedMembers } from "../../services/memberCache.js";
import { deriveAttendance, recomputeAttendanceForEvent } from "../../services/eventAttendance.js";
import { buildAvatarUrl } from "./memberAudit.js";
import type {
  ApolloEvent,
  ApolloEventSignup,
  ApolloEventStatus,
  ApolloRsvpChoice,
  AttendanceStatus,
  Config,
  SignupMatchSource,
} from "../../types.js";

const EVENTS_PAGE_SIZE = 10;

interface EventSignupEntry {
  id: number;
  rawName: string;
  choice: ApolloRsvpChoice;
  userId: string | null;
  displayName: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  matchSource: SignupMatchSource;
  /** Null while the event is 'scheduled' and always for a 'declined' choice. Computed live (not read from the DB cache) while the event is 'active'. */
  attendanceStatus: AttendanceStatus | null;
  firstJoinedAt: string | null;
  lastLeftAt: string | null;
  /** Minutes late arriving — independent of `earlyMinutes` (both can be set at once). Computed live for an 'active' event, same as `attendanceStatus`. */
  lateMinutes: number | null;
  /** Minutes their final departure was before the event ended, only when they never returned. Independent of `lateMinutes`. */
  earlyMinutes: number | null;
  withdrawnAt: string | null;
}

interface EventAttendanceEntry {
  id: number;
  apolloEventId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  status: ApolloEventStatus;
  trackingIncomplete: boolean;
  /** Jump link to the original Apollo message. */
  messageUrl: string;
  voiceChannelId: string | null;
  signups: EventSignupEntry[];
}

interface EventAttendancePageResponse {
  events: EventAttendanceEntry[];
  total: number;
  page: number;
  pageSize: number;
}

const LinkSignupBodySchema = z.object({ userId: z.string().nullable() });
const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  q: z.string().optional().default(""),
});

/** Dashboard visibility/control over Apollo event attendance tracking — see `apolloEventWatcher.ts`/`services/eventAttendance.ts`. */
export function registerEventAttendanceRoutes(app: FastifyInstance, config: Config): void {
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

  app.get("/events/attendance", async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });

    const { events, total, page, pageSize } = listEventsPage({
      page: parsed.data.page,
      pageSize: EVENTS_PAGE_SIZE,
      query: parsed.data.q,
    });
    const response: EventAttendancePageResponse = { events: events.map(serializeEvent), total, page, pageSize };
    return response;
  });

  app.patch("/events/attendance/signups/:signupId", async (request, reply) => {
    const { signupId } = request.params as { signupId: string };
    const id = Number(signupId);
    const body = LinkSignupBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const signup = getSignup(id);
    if (!signup) return reply.code(404).send({ error: "Anmeldung nicht gefunden." });

    const { userId } = body.data;
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
  });

  /** Mainly a test-cleanup/mistake-recovery affordance — destroys the event's full attendance history, cascading via the FK. */
  app.delete("/events/attendance/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    deleteEvent(Number(id));
    return reply.code(204).send();
  });
}
