import { AuditLogEvent } from "discord.js";
import {
  updateCacheMember,
  removeCacheMember,
  getCachedMembers, // Added to retrieve the member before deletion
} from "../services/memberCache.js";
import logger from "../utils/logger.js";

// Author: { name: "LetsGamingDE", id: 272402865874534400n }

export default function registerMemberEvents(client) {
  // Add member to cache on join
  client.on("guildMemberAdd", (member) => {
    logger.info(`New member joined: ${member.user.tag} (${member.id})`);
    updateCacheMember(member);
  });

  // Update member in cache on nickname/role change
  client.on("guildMemberUpdate", (oldMember, newMember) => {
    updateCacheMember(newMember);
  });

  // Handle member leaving
  client.on("guildMemberRemove", async (member) => {
    const { guild, user } = member;
    const cache = getCachedMembers();

    // 1. Capture the nickname from cache BEFORE removing it
    const cachedMember = cache.get(user.id);
    const knownAs = cachedMember ? cachedMember.displayName : user.username;

    // 2. Now remove from local cache
    removeCacheMember(member.id);

    try {
      // 3. Wait for Audit Logs to sync
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const [kickLogs, banLogs] = await Promise.all([
        guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }),
        guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }),
      ]);

      const kickEntry = kickLogs.entries.first();
      const banEntry = banLogs.entries.first();
      const now = Date.now();

      const wasKicked =
        kickEntry &&
        kickEntry.target.id === user.id &&
        now - kickEntry.createdTimestamp < 10000;

      const wasBanned =
        banEntry &&
        banEntry.target.id === user.id &&
        now - banEntry.createdTimestamp < 10000;

      if (wasKicked || wasBanned) {
        return;
      }

      // 4. Notify owner with the Server Nickname
      const owner = await guild.fetchOwner();
      if (owner) {
        await owner
          .send(
            `👋 User **${knownAs}** (${user.displayName}) has **left** the server`,
          )
          .catch((err) => logger.error(`Failed to DM owner: ${err.message}`));
      }

      logger.info(
        `User ${knownAs} (${user.tag}) left voluntarily. Owner notified.`,
      );
    } catch (error) {
      logger.error("Error checking Audit Logs on member leave:", error);
    }
  });
}
