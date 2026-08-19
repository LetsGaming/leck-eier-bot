import type { Collection, GuildMember } from "discord.js";
import { recordLeave, recordRulesAccepted, updateProfile, upsertJoin } from "../db/memberRecordsRepository.js";

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

/** Membership screening ("rules acceptance") completing is the `pending` flag flipping from true to false — Discord has no other signal for it, and no historical record of *when* it happened for anyone already past it. */
export function recordRulesAcceptedIfJustVerified(oldMember: GuildMember, newMember: GuildMember): void {
  if (oldMember.pending && !newMember.pending) {
    recordRulesAccepted(newMember.id, new Date().toISOString());
  }
}

export function recordMemberLeave(userId: string, username: string, displayName: string, avatar: string | null): void {
  recordLeave({ userId, username, displayName, avatar, timestamp: new Date().toISOString() });
}
