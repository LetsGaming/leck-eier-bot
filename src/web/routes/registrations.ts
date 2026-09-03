import type { FastifyInstance } from "fastify";
import { listRegistrations } from "../../db/memberRecordsRepository.js";
import { getCachedMembers } from "../../services/memberCache.js";
import { removeRegistration } from "../../events/registerWatcher.js";
import { buildAvatarUrl } from "./memberAudit.js";
import { getSettings } from "../../db/settingsRepository.js";
import { matchesSearch, scoreMatch } from "../../services/memberSearch.js";
import logger, { errorMessage } from "../../utils/logger.js";
import type { BotClient, Config, RegistrationStatus } from "../../types.js";

interface RegistrationEntry {
  userId: string;
  username: string;
  displayName: string;
  nickname: string | null;
  avatarUrl: string;
  status: RegistrationStatus;
  /** ISO UTC — when the registration was submitted. */
  submittedAt: string | null;
  /** Jump link to the private thread. Null once resolved (registered/removed/left) — the thread no longer exists. */
  threadUrl: string | null;
  /** Raw `name:` field value, as submitted. */
  submittedName: string | null;
  /** Raw `sso name:` field value, as submitted (the full value, not just the surname used for the nickname). */
  submittedSsoName: string | null;
  /** Raw `alter:` field value, as submitted. Null if the member left it out. */
  submittedAge: string | null;
}

/** Dashboard visibility/control over self-service registration-form submissions — see `registerWatcher.ts`. Shows full history (pending/registered/removed/left), not just what's currently pending. */
export function registerRegistrationRoutes(app: FastifyInstance, client: BotClient, config: Config): void {
  app.get("/members/registrations", async (request) => {
    const query = (request.query as { q?: string }).q?.trim() ?? "";
    const cache = getCachedMembers();

    const entries = listRegistrations().map((record): RegistrationEntry => {
      const cached = cache.get(record.userId);
      // registerStatus is guaranteed non-null here — listRegistrations() only
      // returns rows where it's set.
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
    });

    // Include the raw form-submitted names alongside the resolved Discord
    // identity — an admin searching for a registrant most likely knows the
    // name they typed into the form, not their Discord username.
    const names = (entry: RegistrationEntry) => [
      entry.username,
      entry.displayName,
      entry.nickname,
      entry.submittedName,
      entry.submittedSsoName,
    ];

    const filtered = entries.filter((entry) => matchesSearch(query, names(entry)));

    if (!query) {
      return filtered;
    }

    return filtered.sort((a, b) => {
      const scoreDiff = scoreMatch(query, names(b)) - scoreMatch(query, names(a));
      if (scoreDiff !== 0) return scoreDiff;
      return (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "");
    });
  });

  app.delete("/members/registrations/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    await removeRegistration(client, userId);
    return reply.code(204).send();
  });

  // Grants the configured tier role directly from the dashboard — the same
  // action staff previously had to perform by hand in Discord. Granting the
  // role fires the bot's own `guildMemberUpdate` handling
  // (stripRegisterGateRoleIfJustRegistered in memberEvents.ts), which
  // completes the registration (deletes the thread, flips DB status) as a
  // side effect — this route only needs to add the role, never touch the DB.
  app.post("/members/registrations/:userId/approve", async (request, reply) => {
    const { userId } = request.params as { userId: string };
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

    return reply.code(204).send();
  });
}
