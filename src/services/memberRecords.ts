import type { Collection, GuildMember } from "discord.js";
import { recordLeave, recordRulesAccepted, updateProfile, upsertJoin } from "../db/memberRecordsRepository.js";
import { getSettings } from "../db/settingsRepository.js";

function displayNameOf(member: GuildMember): string {
  return member.displayName || member.user.globalName || member.user.username;
}

/** Backfills `joined_at` for everyone currently in the guild — called once at every startup, right after the member cache is populated. Discord still exposes a current member's join date regardless of when the bot started tracking, so this is safe to re-run on every boot. */
export function seedMemberRecordsFromCache(members: Collection<string, GuildMember>): void {
  for (const member of members.values()) {
    upsertJoin({
      userId: member.id,
      username: member.user.username,
      displayName: displayNameOf(member),
      avatar: member.user.avatar,
      joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
    });
  }
}

export function recordMemberJoin(member: GuildMember): void {
  upsertJoin({
    userId: member.id,
    username: member.user.username,
    displayName: displayNameOf(member),
    avatar: member.user.avatar,
    joinedAt: (member.joinedAt ?? new Date()).toISOString(),
  });
}

export function recordMemberProfileUpdate(member: GuildMember): void {
  updateProfile({
    userId: member.id,
    username: member.user.username,
    displayName: displayNameOf(member),
    avatar: member.user.avatar,
  });
}

/**
 * "Rules accepted" has two possible signals, picked via
 * `settings.rulesAcceptedUseDiscordScreening`:
 *
 * - **Role-based** (default, off): this guild's actual rules gate is a
 *   reaction-role panel on the rules message that grants
 *   `registerGateRoleId` (see `stripRegisterGateRoleIfJustRegistered()` in
 *   `events/memberEvents.ts`, which strips that same role once registration
 *   completes) — so the signal is that role being newly granted. Works even
 *   for a guild that never uses Discord's own membership screening.
 * - **Discord-based** (on): Discord's native membership-screening `pending`
 *   flag flipping from `true` to `false`, for a guild that uses that
 *   feature instead of a reaction-role gate.
 *
 * Either way, `recordRulesAccepted()` only ever sets the column once (its
 * `UPDATE` is a no-op if already non-null), so e.g. a later
 * strip-then-regrant of the gate role (re-registering) doesn't overwrite
 * the original timestamp. No-ops if the relevant signal isn't
 * available (role-based with no `registerGateRoleId` configured), and no
 * historical record exists for anyone who triggered it before this shipped
 * or before the setting was switched.
 */
export function recordRulesAcceptedIfJustVerified(oldMember: GuildMember, newMember: GuildMember): void {
  const { rulesAcceptedUseDiscordScreening, registerGateRoleId } = getSettings();

  const justAccepted = rulesAcceptedUseDiscordScreening
    ? oldMember.pending && !newMember.pending
    : !!registerGateRoleId &&
      !oldMember.roles.cache.has(registerGateRoleId) &&
      newMember.roles.cache.has(registerGateRoleId);

  if (!justAccepted) return;
  recordRulesAccepted(newMember.id, new Date().toISOString());
}

export function recordMemberLeave(userId: string, username: string, displayName: string, avatar: string | null): void {
  recordLeave({ userId, username, displayName, avatar, timestamp: new Date().toISOString() });
}
