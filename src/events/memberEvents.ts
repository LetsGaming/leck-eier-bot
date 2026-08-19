import { AuditLogEvent } from "discord.js";
import {
  updateCacheMember,
  removeCacheMember,
  getCachedMembers, // Added to retrieve the member before deletion
} from "../services/memberCache.js";
import {
  recordMemberJoin,
  recordMemberLeave,
  recordMemberProfileUpdate,
  recordRulesAcceptedIfJustVerified,
} from "../services/memberRecords.js";
import { getSettings } from "../db/settingsRepository.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { BotClient } from "../types.js";
import { AUDIT_LOG_RECENT_WINDOW_MS, AUDIT_LOG_SYNC_DELAY_MS } from "../constants.js";

// Author: { name: "LetsGamingDE", id: 272402865874534400n }

/** Whether `entry` is a recent-enough audit log action targeting `userId`. */
function isRecentActionAgainst(
  entry: { target?: { id: string } | null; createdTimestamp: number } | undefined,
  userId: string,
  now: number,
): boolean {
  return (
    !!entry &&
    entry.target?.id === userId &&
    now - entry.createdTimestamp < AUDIT_LOG_RECENT_WINDOW_MS
  );
}

export default function registerMemberEvents(client: BotClient): void {
  // Add member to cache on join
  client.on("guildMemberAdd", (member) => {
    logger.info(`New member joined: ${member.user.tag} (${member.id})`);
    updateCacheMember(member);
    recordMemberJoin(member);
  });

  // Update member in cache on nickname/role change
  client.on("guildMemberUpdate", (oldMember, newMember) => {
    updateCacheMember(newMember);
    recordMemberProfileUpdate(newMember);
    // A partial oldMember (missing most fields, `pending` included) means
    // Discord didn't send enough to diff against — nothing to compare.
    if (!oldMember.partial) {
      recordRulesAcceptedIfJustVerified(oldMember, newMember);
    }
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
    recordMemberLeave(user.id, user.username, knownAs, cachedMember?.user.avatar ?? user.avatar ?? null);

    try {
      // 3. Wait for Audit Logs to sync
      await new Promise((resolve) => setTimeout(resolve, AUDIT_LOG_SYNC_DELAY_MS));

      const [kickLogs, banLogs] = await Promise.all([
        guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }),
        guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }),
      ]);

      const now = Date.now();
      const wasKicked = isRecentActionAgainst(kickLogs.entries.first(), user.id, now);
      const wasBanned = isRecentActionAgainst(banLogs.entries.first(), user.id, now);

      if (wasKicked || wasBanned) {
        return;
      }

      if (!getSettings().leaveNotificationsEnabled) {
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
      logger.error(`Error checking Audit Logs on member leave: ${errorMessage(error)}`);
    }
  });
}
