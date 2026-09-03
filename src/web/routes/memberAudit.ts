import type { FastifyInstance } from "fastify";
import { isCacheReady, getCachedMembers } from "../../services/memberCache.js";
import { listAllMemberRecords } from "../../db/memberRecordsRepository.js";
import { matchesSearch, scoreMatch } from "../../services/memberSearch.js";
import { FIND_USER_LIST_LIMIT, MEMBER_AUDIT_LEFT_LIMIT } from "../../constants.js";
import type { MemberRecord } from "../../types.js";

interface MemberAuditEntry {
  userId: string;
  username: string;
  tag: string;
  displayName: string;
  nickname: string | null;
  avatarUrl: string;
  inGuild: boolean;
  joinedAt: string | null;
  rulesAcceptedAt: string | null;
  leftAt: string | null;
}

/**
 * Discord CDN avatar URL built from a raw hash — needed for a former member,
 * who has no live `User`/`GuildMember` object to call `.displayAvatarURL()`
 * on. The default-avatar index formula is the current (post-discriminator)
 * one: `(user_id >> 22) % 6`.
 */
export function buildAvatarUrl(userId: string, avatarHash: string | null, size = 64): string {
  if (avatarHash) {
    const ext = avatarHash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
  }
  const index = Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function registerMemberAuditRoutes(app: FastifyInstance): void {
  app.get("/members/audit", async (request, reply) => {
    const query = (request.query as { q?: string }).q?.trim() ?? "";
    if (!isCacheReady()) {
      return reply.code(503).send({ error: "Der Mitglieder-Cache wird noch aufgebaut — versuche es gleich noch einmal." });
    }

    const records = new Map<string, MemberRecord>(listAllMemberRecords().map((r) => [r.userId, r]));

    const inGuildNames = (member: { user: { username: string; globalName: string | null }; nickname: string | null; displayName: string }) => [
      member.user.username,
      member.user.globalName,
      member.nickname,
      member.displayName,
    ];

    const inGuild: MemberAuditEntry[] = [...getCachedMembers().values()]
      .filter((member) => matchesSearch(query, inGuildNames(member)))
      .sort((a, b) =>
        query ? scoreMatch(query, inGuildNames(b)) - scoreMatch(query, inGuildNames(a)) : a.displayName.localeCompare(b.displayName),
      )
      .slice(0, FIND_USER_LIST_LIMIT)
      .map((member) => {
        const record = records.get(member.id);
        return {
          userId: member.id,
          username: member.user.username,
          tag: member.user.tag,
          displayName: member.displayName,
          nickname: member.nickname,
          avatarUrl: member.displayAvatarURL({ size: 64 }),
          inGuild: true,
          // The live member cache is the fresher source for a current
          // member — DB-recorded joinedAt is only the fallback in case
          // seeding somehow hasn't run yet for them.
          joinedAt: member.joinedAt?.toISOString() ?? record?.joinedAt ?? null,
          rulesAcceptedAt: record?.rulesAcceptedAt ?? null,
          leftAt: null,
        };
      });

    const left: MemberAuditEntry[] = [...records.values()]
      .filter((r) => !r.inGuild)
      .filter((r) => matchesSearch(query, [r.username, r.displayName]))
      .sort((a, b) =>
        query
          ? scoreMatch(query, [b.username, b.displayName]) - scoreMatch(query, [a.username, a.displayName])
          : (b.leftAt ?? "").localeCompare(a.leftAt ?? ""),
      )
      .slice(0, MEMBER_AUDIT_LEFT_LIMIT)
      .map((r) => ({
        userId: r.userId,
        username: r.username,
        tag: r.username,
        displayName: r.displayName,
        nickname: null,
        avatarUrl: buildAvatarUrl(r.userId, r.avatar),
        inGuild: false,
        joinedAt: r.joinedAt,
        rulesAcceptedAt: r.rulesAcceptedAt,
        leftAt: r.leftAt,
      }));

    return { inGuild, left };
  });
}
