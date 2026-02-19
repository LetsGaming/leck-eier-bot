import { Collection } from "discord.js";
import logger from "../utils/logger.js";

// Internal storage
const cache = new Collection();
let isInitialized = false;

export async function initMemberCache(guild) {
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
    logger.error("Failed to populate member cache:", err);
  }
}

export function updateCacheMember(member) {
  cache.set(member.id, member);
}

export function removeCacheMember(memberId) {
  cache.delete(memberId);
}

export function getCachedMembers() {
  return cache;
}

export function isCacheReady() {
  return isInitialized;
}
