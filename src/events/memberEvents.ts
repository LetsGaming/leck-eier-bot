import { AuditLogEvent } from "discord.js";
import {
  recordMemberJoin,
  recordMemberLeave,
  recordMemberProfileUpdate,
  recordRulesAcceptedIfJustVerified,
} from "../services/memberRecords.js";
import { removeBirthdayOnMemberLeave } from "../services/birthdays.js";
import { stripRegisterGateRoleIfJustRegistered } from "../services/registerGate.js";
import { clearRegistrationOnLeave } from "./registerWatcher.js";
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
  // discord.js's own `guild.members.cache` (see services/memberCache.ts) is
  // already updated by the client itself before either of these events
  // fires — nothing needs to be done here to keep a cache in sync.
  client.on("guildMemberAdd", (member) => {
    logger.info(`New member joined: ${member.user.tag} (${member.id})`);
    recordMemberJoin(member);
  });

  client.on("guildMemberUpdate", (oldMember, newMember) => {
    recordMemberProfileUpdate(oldMember, newMember);
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

    // `member` here is discord.js's own record of who this was — by the
    // time this event fires, the client has ALREADY deleted it from
    // `guild.members.cache` (that's why a fresh `guild.members.cache.get()`
    // lookup would come back empty), but `member` itself still carries every
    // field it had a moment ago (nickname, avatar, etc.), so no separate
    // cache lookup is needed to capture that pre-removal state.
    const knownAs = member.displayName;
    recordMemberLeave(user.id, user.username, knownAs, member.user.avatar ?? user.avatar ?? null);

    // A departed member's birthday entry (list or self-registered) has to
    // go too, from both the DB and the rendered anchor message — same
    // handling regardless of whether they left voluntarily, were kicked, or
    // were banned, so this runs unconditionally rather than inside the
    // audit-log-dependent branch below.
    removeBirthdayOnMemberLeave(client, user.id).catch((err) =>
      logger.error(`Failed to remove departed member ${user.id}'s birthday entry: ${errorMessage(err)}`),
    );

    // Same reasoning: a *pending* registration-form submission
    // (registerWatcher.ts) is meaningless once the member is gone, regardless
    // of whether they left voluntarily, were kicked, or were banned — this
    // deletes the thread and marks the entry "left" (a no-op if they'd
    // already completed registration, so that status isn't overwritten) so
    // they start fresh if they ever rejoin.
    clearRegistrationOnLeave(client, user.id).catch((err) =>
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
          .catch((err) => logger.error(`Failed to DM owner: ${errorMessage(err)}`));
      }

      logger.info(
        `User ${knownAs} (${user.tag}) left voluntarily. Owner notified.`,
      );
    } catch (error) {
      logger.error(`Error checking Audit Logs on member leave: ${errorMessage(error)}`);
    }
  });
}
