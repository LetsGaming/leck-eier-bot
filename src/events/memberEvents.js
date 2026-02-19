import { AuditLogEvent } from "discord.js";
import {
  updateCacheMember,
  removeCacheMember,
} from "../services/memberCache.js";
import logger from "../utils/logger.js";

export default function registerMemberEvents(client) {
  // Add member to cache on join
  client.on("guildMemberAdd", (member) => {
    updateCacheMember(member);
  });

  // Update member in cache on nickname/role change
  client.on("guildMemberUpdate", (oldMember, newMember) => {
    updateCacheMember(newMember);
  });

  // Handle member leaving
  client.on("guildMemberRemove", async (member) => {
    const { guild, user } = member;

    // 1. Always update the local cache
    removeCacheMember(member.id);

    try {
      // 2. Wait for Audit Logs to sync (Discord is often slower than the event)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 3. Check for Kicks or Bans
      const [kickLogs, banLogs] = await Promise.all([
        guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }),
        guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }),
      ]);

      const kickEntry = kickLogs.entries.first();
      const banEntry = banLogs.entries.first();

      const now = Date.now();

      // Check if user was kicked recently
      const wasKicked =
        kickEntry &&
        kickEntry.target.id === user.id &&
        now - kickEntry.createdTimestamp < 10000;

      // Check if user was banned recently
      const wasBanned =
        banEntry &&
        banEntry.target.id === user.id &&
        now - banEntry.createdTimestamp < 10000;

      // CRITICAL: If they were kicked or banned, stop here.
      if (wasKicked || wasBanned) {
        return;
      }

      // 4. If we reached here, they left voluntarily
      const owner = await guild.fetchOwner();
      if (owner) {
        await owner
          .send(
            `👋 User **${user.tag}** (ID: ${user.id}) has **left** the server: **${guild.name}**`,
          )
          .catch((err) => logger.error(`Failed to DM owner: ${err.message}`));
      }

      logger.info(`User ${user.tag} left voluntarily. Owner notified.`);
    } catch (error) {
      logger.error("Error checking Audit Logs on member leave:", error);
    }
  });
}
