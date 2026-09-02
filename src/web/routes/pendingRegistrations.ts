import type { FastifyInstance } from "fastify";
import { listPendingRegistrations } from "../../db/memberRecordsRepository.js";
import { getCachedMembers } from "../../services/memberCache.js";
import { deleteRegisterThread } from "../../events/registerWatcher.js";
import { buildAvatarUrl } from "./memberAudit.js";
import type { BotClient, Config } from "../../types.js";

interface PendingRegistrationEntry {
  userId: string;
  username: string;
  displayName: string;
  nickname: string | null;
  avatarUrl: string;
  /** ISO UTC — when the private registration thread was created. */
  submittedAt: string | null;
  /** Jump link to the private thread. */
  threadUrl: string;
  /** Raw `name:` field value, as submitted. */
  submittedName: string | null;
  /** Raw `sso name:` field value, as submitted (the full value, not just the surname used for the nickname). */
  submittedSsoName: string | null;
  /** Raw `alter:` field value, as submitted. Null if the member left it out. */
  submittedAge: string | null;
}

/** Dashboard visibility/control over self-service registration-form submissions still awaiting staff review — see `registerWatcher.ts`. */
export function registerPendingRegistrationRoutes(app: FastifyInstance, client: BotClient, config: Config): void {
  app.get("/members/pending-registrations", async () => {
    const cache = getCachedMembers();

    return listPendingRegistrations().map((record): PendingRegistrationEntry => {
      const cached = cache.get(record.userId);
      return {
        userId: record.userId,
        username: cached?.user.username ?? record.username,
        displayName: cached?.displayName ?? record.displayName,
        nickname: cached?.nickname ?? null,
        avatarUrl: cached?.displayAvatarURL({ size: 64 }) ?? buildAvatarUrl(record.userId, record.avatar),
        submittedAt: record.registerSubmittedAt,
        threadUrl: `https://discord.com/channels/${config.guildId}/${record.registerThreadId}`,
        submittedName: record.registerSubmittedName,
        submittedSsoName: record.registerSubmittedSsoName,
        submittedAge: record.registerSubmittedAge,
      };
    });
  });

  app.delete("/members/pending-registrations/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    await deleteRegisterThread(client, userId);
    return reply.code(204).send();
  });
}
