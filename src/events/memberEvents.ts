import { AuditLogEvent, type GuildMember } from "discord.js";
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
import { removeBirthdayOnMemberLeave } from "../services/birthdays.js";
import { deleteRegisterThread } from "./registerWatcher.js";
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

/**
 * A member only sees #register while holding the register-gate role
 * (granted via reaction to the rules message). Once staff manually grant
 * the lowest membership tier role at registration, the gate role no longer
 * serves any purpose and is stripped so the channel disappears for them.
 * `registrationTierRoleId` must be the lowest tier specifically — later
 * promotions swap between higher tiers and must never re-trigger this.
 */
async function stripRegisterGateRoleIfJustRegistered(
  client: BotClient,
  oldMember: GuildMember,
  newMember: GuildMember,
): Promise<void> {
  const { registerGateRoleId, registrationTierRoleId } = getSettings();
  if (!registerGateRoleId || !registrationTierRoleId) return;

  const justGotRegistrationTier =
    !oldMember.roles.cache.has(registrationTierRoleId) && newMember.roles.cache.has(registrationTierRoleId);
  if (!justGotRegistrationTier) return;

  // The pending-registration thread's job (see registerWatcher.ts) is done
  // the moment staff grant the tier role, regardless of whether this member
  // ever held the gate role in the first place.
  await deleteRegisterThread(client, newMember.id);

  if (!newMember.roles.cache.has(registerGateRoleId)) return;

  await newMember.roles.remove(registerGateRoleId, "Registriert — benötigt #register-Sichtbarkeit nicht mehr");
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
      stripRegisterGateRoleIfJustRegistered(client, oldMember, newMember).catch((err) =>
        logger.error(`Failed to strip register-gate role from ${newMember.id}: ${errorMessage(err)}`),
      );
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

    // A departed member's birthday entry (list or self-registered) has to
    // go too, from both the DB and the rendered anchor message — same
    // handling regardless of whether they left voluntarily, were kicked, or
    // were banned, so this runs unconditionally rather than inside the
    // audit-log-dependent branch below.
    removeBirthdayOnMemberLeave(client, user.id).catch((err) =>
      logger.error(`Failed to remove departed member ${user.id}'s birthday entry: ${errorMessage(err)}`),
    );

    // Same reasoning: a pending registration-form submission (registerWatcher.ts)
    // is meaningless once the member is gone, regardless of whether they left
    // voluntarily, were kicked, or were banned — clearing it here (rather than
    // only on manual dashboard removal or staff completing registration) lets
    // them start fresh if they ever rejoin.
    deleteRegisterThread(client, user.id).catch((err) =>
      logger.error(`Failed to clear departed member ${user.id}'s pending registration: ${errorMessage(err)}`),
    );

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
            `👋 Benutzer **${knownAs}** (${user.displayName}) hat den Server **verlassen**`,
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
