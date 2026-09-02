import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listEventsWithSignups,
  getSignup,
  linkSignupToUser,
  deleteEvent,
  listVoiceLogForUser,
  getEventById,
} from "../../db/eventAttendanceRepository.js";
import { getCachedMembers } from "../../services/memberCache.js";
import { deriveAttendance, recomputeAttendanceForEvent } from "../../services/eventAttendance.js";
import { buildAvatarUrl } from "./memberAudit.js";
import type { ApolloEventStatus, ApolloRsvpChoice, AttendanceStatus, Config, SignupMatchSource } from "../../types.js";

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

const LinkSignupBodySchema = z.object({ userId: z.string().nullable() });

/** Dashboard visibility/control over Apollo event attendance tracking — see `apolloEventWatcher.ts`/`services/eventAttendance.ts`. */
export function registerEventAttendanceRoutes(app: FastifyInstance, config: Config): void {
  function serializeEvent(event: ReturnType<typeof listEventsWithSignups>[number]): EventAttendanceEntry {
    const cache = getCachedMembers();
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
      signups: event.signups.map((signup) => {
        const cached = signup.userId ? cache.get(signup.userId) : undefined;

        // The DB only has attendance_status settled at completion; while the
        // event is still 'active', compute it live from the voice log so
        // the dashboard reflects what's happening right now.
        let attendanceStatus = signup.attendanceStatus;
        let firstJoinedAt = signup.firstJoinedAt;
        let lastLeftAt = signup.lastLeftAt;
        if (event.status === "active" && signup.choice !== "declined" && signup.userId) {
          const derived = deriveAttendance(listVoiceLogForUser(event.id, signup.userId), event.startsAt, event.endsAt);
          attendanceStatus = derived.status;
          firstJoinedAt = derived.firstJoinedAt;
          lastLeftAt = derived.lastLeftAt;
        }

        return {
          id: signup.id,
          rawName: signup.rawName,
          choice: signup.choice,
          userId: signup.userId,
          displayName: cached?.displayName ?? null,
          nickname: cached?.nickname ?? null,
          avatarUrl: cached
            ? cached.displayAvatarURL({ size: 64 })
            : signup.userId
              ? buildAvatarUrl(signup.userId, null)
              : null,
          matchSource: signup.matchSource,
          attendanceStatus,
          firstJoinedAt,
          lastLeftAt,
          withdrawnAt: signup.withdrawnAt,
        };
      }),
    };
  }

  app.get("/events/attendance", async () => listEventsWithSignups().map(serializeEvent));

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
      const otherSignups = listEventsWithSignups().find((e) => e.id === signup.eventId)?.signups ?? [];
      if (otherSignups.some((s) => s.id !== id && s.userId === userId)) {
        return reply.code(409).send({ error: "Dieses Mitglied ist bereits einer anderen Anmeldung dieses Events zugeordnet." });
      }
    }

    linkSignupToUser(id, userId);
    // A link made before the event has ever activated has nothing to
    // recompute yet — attendance only starts existing once tracking does.
    if (getEventById(signup.eventId)?.status !== "scheduled") {
      recomputeAttendanceForEvent(signup.eventId);
    }

    const updated = listEventsWithSignups().find((e) => e.id === signup.eventId);
    if (!updated) return reply.code(404).send({ error: "Event nicht gefunden." });
    return serializeEvent(updated);
  });

  /** Mainly a test-cleanup/mistake-recovery affordance — destroys the event's full attendance history, cascading via the FK. */
  app.delete("/events/attendance/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    deleteEvent(Number(id));
    return reply.code(204).send();
  });
}
