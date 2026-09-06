import { z } from "zod";
import { listRegistrations } from "../../db/memberRecordsRepository.js";
import { getCachedMembers } from "../../services/memberCache.js";
import { removeRegistration, completeRegistration } from "../../events/registerWatcher.js";
import { buildAvatarUrl } from "./memberAudit.js";
import { getSettings } from "../../db/settingsRepository.js";
import { REGISTRATIONS_LIST_LIMIT } from "../../constants.js";
import logger, { errorMessage } from "../../utils/logger.js";
import type { BotClient, Config } from "../../types.js";
import type { ZodFastifyInstance } from "../utils.js";
import type { RegistrationEntry } from "../../../contracts/registrations.js";

const RegistrationsQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(REGISTRATIONS_LIST_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const UserIdParamsSchema = z.object({ userId: z.string() });

/** Dashboard visibility/control over self-service registration-form submissions — see `registerWatcher.ts`. Shows full history (pending/registered/removed/left), not just what's currently pending. */
export function registerRegistrationRoutes(app: ZodFastifyInstance, client: BotClient, config: Config): void {
  app.get("/members/registrations", { schema: { querystring: RegistrationsQuerySchema } }, async (request) => {
    const { q, limit, offset } = request.query;
    const cache = getCachedMembers();

    // The search itself (username/display name/submitted form names) runs in
    // SQL now — see listRegistrations()'s doc comment for the tradeoffs vs.
    // the old in-JS matchesSearch()/scoreMatch(), including the one search
    // field this drops: a member's current *nickname* (a live Discord field,
    // never persisted on member_records, so it can't be pushed into the SQL
    // WHERE/ORDER BY without re-introducing an unbounded per-row JS pass).
    return listRegistrations({ query: q, limit: limit ?? REGISTRATIONS_LIST_LIMIT, offset }).map(
      (record): RegistrationEntry => {
        const cached = cache.get(record.userId);
        // registerStatus is guaranteed non-null here — listRegistrations()
        // only returns rows where it's set.
        const status = record.registerStatus!;
        return {
          userId: record.userId,
          username: cached?.user.username ?? record.username,
          displayName: cached?.displayName ?? record.displayName,
          nickname: cached?.nickname ?? null,
          avatarUrl: cached?.displayAvatarURL({ size: 64 }) ?? buildAvatarUrl(record.userId, record.avatar),
          status,
          submittedAt: record.registerSubmittedAt,
          threadUrl:
            status === "pending" && record.registerThreadId
              ? `https://discord.com/channels/${config.guildId}/${record.registerThreadId}`
              : null,
          submittedName: record.registerSubmittedName,
          submittedSsoName: record.registerSubmittedSsoName,
          submittedAge: record.registerSubmittedAge,
        };
      },
    );
  });

  app.delete("/members/registrations/:userId", { schema: { params: UserIdParamsSchema } }, async (request, reply) => {
    const { userId } = request.params;
    await removeRegistration(client, userId);
    return reply.code(204).send();
  });

  // Grants the configured tier role directly from the dashboard — the same
  // action staff previously had to perform by hand in Discord. Granting the
  // role also fires the bot's own `guildMemberUpdate` handling
  // (stripRegisterGateRoleIfJustRegistered in memberEvents.ts), but that
  // gateway event is async and can be delayed/missed — so this route calls
  // completeRegistration() itself right after the role grant succeeds,
  // rather than relying solely on the gateway event to flip the DB status
  // and clean up the thread. completeRegistration() is idempotent (its DB
  // update is a no-op once status is no longer 'pending', and it only
  // attempts to delete the thread while status is still 'pending'), so it's
  // safe if the gateway handler's own call also fires for this same
  // registration afterward.
  app.post(
    "/members/registrations/:userId/approve",
    { schema: { params: UserIdParamsSchema } },
    async (request, reply) => {
      const { userId } = request.params;
      const { registrationTierRoleId } = getSettings();
      if (!registrationTierRoleId) {
        return reply
          .code(400)
          .send({ error: "Registrierungsrolle ist nicht konfiguriert — siehe Einstellungen." });
      }

      const guild = client.guilds.cache.get(config.guildId);
      if (!guild) {
        return reply.code(503).send({ error: "Server noch nicht im Cache — versuche es gleich noch einmal." });
      }

      try {
        const member = await guild.members.fetch(userId);
        await member.roles.add(registrationTierRoleId, "Manuell über Dashboard genehmigt");
      } catch (err) {
        logger.warn(`Registrierung für ${userId} konnte nicht über das Dashboard genehmigt werden: ${errorMessage(err)}`);
        return reply.code(502).send({ error: "Die Rolle konnte nicht vergeben werden. Ist der Bot berechtigt?" });
      }

      try {
        await completeRegistration(client, userId);
      } catch (err) {
        // The role was already granted — don't fail the request over this.
        // The guildMemberUpdate gateway handler in memberEvents.ts still runs
        // as a fallback and will complete the registration if this failed.
        logger.warn(`Registrierung für ${userId} konnte nach Rollenvergabe nicht sofort abgeschlossen werden: ${errorMessage(err)}`);
      }

      return reply.code(204).send();
    },
  );
}
