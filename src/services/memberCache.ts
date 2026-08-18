import { Collection, type Guild, type GuildMember } from "discord.js";
import logger, { errorMessage } from "../utils/logger.js";

// Internal storage
const cache = new Collection<string, GuildMember>();
let isInitialized = false;

export async function initMemberCache(guild: Guild): Promise<void> {
  if (isInitialized) return;

  logger.info(`Initializing member cache for guild: ${guild.name}...`);
  try {
    const members = await guild.members.fetch();
    for (const [id, member] of members) {
      cache.set(id, member);
    }
    isInitialized = true;
    logger.info(`✔ Cache populated with ${cache.size} members.`);
  } catch (err) {
    logger.error(`Failed to populate member cache: ${errorMessage(err)}`);
  }
}

export function updateCacheMember(member: GuildMember): void {
  cache.set(member.id, member);
}

export function removeCacheMember(memberId: string): void {
  cache.delete(memberId);
}

export function getCachedMembers(): Collection<string, GuildMember> {
  return cache;
}

export function isCacheReady(): boolean {
  return isInitialized;
}
