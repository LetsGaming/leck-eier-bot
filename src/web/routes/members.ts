import type { FastifyInstance } from "fastify";
import { isCacheReady } from "../../services/memberCache.js";
import { listCachedMembers, searchCachedMembers } from "../../services/memberSearch.js";
import { FIND_USER_LIST_LIMIT, FIND_USER_RESULT_LIMIT } from "../../constants.js";

/** Backs the dashboard's Find User page — same `searchCachedMembers()` service `/finduser` uses. */
export function registerMemberRoutes(app: FastifyInstance): void {
  app.get("/members/search", async (request, reply) => {
    const query = (request.query as { q?: string }).q?.trim();
    if (!isCacheReady()) {
      return reply.code(503).send({ error: "The member cache is still building — try again shortly." });
    }

    const members = query ? searchCachedMembers(query, FIND_USER_RESULT_LIMIT) : listCachedMembers(FIND_USER_LIST_LIMIT);
    return members.map((m) => ({
      id: m.id,
      username: m.user.username,
      tag: m.user.tag,
      displayName: m.displayName,
      nickname: m.nickname,
      avatarUrl: m.displayAvatarURL({ size: 64 }),
    }));
  });
}
