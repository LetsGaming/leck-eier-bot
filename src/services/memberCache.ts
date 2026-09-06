import { Collection, type Guild, type GuildMember } from "discord.js";
import logger, { errorMessage } from "../utils/logger.js";

// This module used to maintain its own `Collection<string, GuildMember>`,
// manually kept in sync via `updateCacheMember()`/`removeCacheMember()` calls
// from `events/memberEvents.ts`. That was fully redundant: discord.js's own
// `guild.members.cache` is already kept in sync automatically by the
// client's gateway handling for guildMemberAdd/Update/Remove (the
// `GuildMembers` intent is enabled — see `src/index.ts`), and it isn't
// subject to any sweeper/eviction here (no `GuildMemberManager` limit is
// configured in `Options.cacheWithLimits(...)` in `src/index.ts`, and the
// default sweepers only touch archived threads). The only thing this module
// still needs to own is the one-time full fetch at boot (discord.js's cache
// only has whatever's trickled in from gateway events otherwise) and a
// "has that fetch completed" flag, since discord.js doesn't expose that.
let cachedGuild: Guild | undefined;

/**
 * One-time full member fetch at boot, so discord.js's own `guild.members.cache`
 * is actually populated with every member instead of just whatever the
 * gateway happened to send unprompted. After this resolves, `guild.members.cache`
 * stays in sync on its own — nothing further needs to be fetched or copied.
 */
export async function initMemberCache(guild: Guild): Promise<void> {
  if (cachedGuild) return;

  logger.info(`Initializing member cache for guild: ${guild.name}...`);
  try {
    await guild.members.fetch();
    cachedGuild = guild;
    logger.info(`✔ Cache populated with ${guild.members.cache.size} members.`);
  } catch (err) {
    logger.error(`Failed to populate member cache: ${errorMessage(err)}`);
  }
}

/**
 * discord.js's own live member cache for the guild `initMemberCache()` was
 * called with — not a separate copy. Returns an empty `Collection` if the
 * initial boot fetch hasn't completed (or hasn't been called) yet.
 */
export function getCachedMembers(): Collection<string, GuildMember> {
  return cachedGuild?.members.cache ?? new Collection<string, GuildMember>();
}

export function isCacheReady(): boolean {
  return cachedGuild !== undefined;
}
