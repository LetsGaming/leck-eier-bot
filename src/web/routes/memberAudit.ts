import { z } from "zod";
import { isCacheReady, getCachedMembers } from "../../services/memberCache.js";
import { getMemberRecord, getMemberRecordsByIds, listFormerMembers } from "../../db/memberRecordsRepository.js";
import { getBirthdayForUser } from "../../db/birthdaysRepository.js";
import { listSignupsForUser } from "../../db/eventAttendanceRepository.js";
import { matchesSearch, scoreMatch } from "../../services/memberSearch.js";
import { FIND_USER_LIST_LIMIT, MEMBER_AUDIT_LEFT_LIMIT, MEMBER_RESOLVE_LIMIT } from "../../constants.js";
import type { ZodFastifyInstance } from "../utils.js";
import type { MemberAuditEntry } from "../../../contracts/memberAudit.js";
import type { MemberOverview } from "../../../contracts/memberOverview.js";

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

const AuditQuerySchema = z.object({
  q: z.string().optional(),
  /** Caps the "left the server" list — the in-guild list is always bounded by FIND_USER_LIST_LIMIT/guild size instead (see below). */
  limit: z.coerce.number().int().min(1).max(MEMBER_AUDIT_LEFT_LIMIT).optional(),
  /** Pairs with `limit` for offset-based paging through the "left" list. */
  offset: z.coerce.number().int().min(0).optional(),
  /**
   * Skips the former-members DB query entirely and returns only `inGuild` —
   * for callers like EventAttendanceDetail.tsx's member-linking dropdown
   * that only ever need currently-in-guild members and would otherwise pay
   * for the (growing, unbounded) left-members half of the table for no
   * reason.
   */
  inGuildOnly: z.enum(["0", "1"]).optional().default("0"),
});

const UserIdParamsSchema = z.object({ userId: z.string() });

const ResolveQuerySchema = z.object({ ids: z.string().min(1) });

export function registerMemberAuditRoutes(app: ZodFastifyInstance): void {
  app.get("/members/audit", { schema: { querystring: AuditQuerySchema } }, async (request, reply) => {
    const { q, limit, offset, inGuildOnly } = request.query;
    const query = q?.trim() ?? "";
    if (!isCacheReady()) {
      return reply.code(503).send({ error: "Der Mitglieder-Cache wird noch aufgebaut — versuche es gleich noch einmal." });
    }

    const inGuildNames = (member: { user: { username: string; globalName: string | null }; nickname: string | null; displayName: string }) => [
      member.user.username,
      member.user.globalName,
      member.nickname,
      member.displayName,
    ];

    const matchedMembers = [...getCachedMembers().values()]
      .filter((member) => matchesSearch(query, inGuildNames(member)))
      .sort((a, b) =>
        query ? scoreMatch(query, inGuildNames(b)) - scoreMatch(query, inGuildNames(a)) : a.displayName.localeCompare(b.displayName),
      )
      .slice(0, FIND_USER_LIST_LIMIT);

    // Bounded by the (already-sliced) in-guild result set's size, not the
    // whole member_records table — see getMemberRecordsByIds()'s doc comment.
    const records = getMemberRecordsByIds(matchedMembers.map((member) => member.id));

    const inGuild: MemberAuditEntry[] = matchedMembers.map((member) => {
      const record = records.get(member.id);
      return {
        userId: member.id,
        username: member.user.username,
        tag: member.user.tag,
        displayName: member.displayName,
        nickname: member.nickname,
        avatarUrl: member.displayAvatarURL({ size: 64 }),
        inGuild: true,
        isBot: member.user.bot,
        // The live member cache is the fresher source for a current
        // member — DB-recorded joinedAt is only the fallback in case
        // seeding somehow hasn't run yet for them.
        joinedAt: member.joinedAt?.toISOString() ?? record?.joinedAt ?? null,
        rulesAcceptedAt: record?.rulesAcceptedAt ?? null,
        leftAt: null,
      };
    });

    if (inGuildOnly === "1") {
      return { inGuild };
    }

    const left: MemberAuditEntry[] = listFormerMembers({
      query,
      limit: limit ?? MEMBER_AUDIT_LEFT_LIMIT,
      offset,
    }).map((r) => ({
      userId: r.userId,
      username: r.username,
      tag: r.username,
      displayName: r.displayName,
      nickname: null,
      avatarUrl: buildAvatarUrl(r.userId, r.avatar),
      inGuild: false,
      // No live cache entry left to read `.user.bot` from once someone's
      // gone — see MemberAuditEntry.isBot's doc comment.
      isBot: false,
      joinedAt: r.joinedAt,
      rulesAcceptedAt: r.rulesAcceptedAt,
      leftAt: r.leftAt,
    }));

    return { inGuild, left };
  });

  /**
   * Bulk display-name lookup for pages that only need "what do we call this
   * userId" rather than a full audit row — e.g. Birthdays.tsx resolving an
   * admin-entered Discord-user-ID entry (which has no `name` on file, only
   * the raw `<@id>` mention) to the same name Member Audit already shows for
   * that person. Checks the live member cache first (current members),
   * falling back to the `member_records` DB row (covers former members too)
   * — same two-source pattern as the `inGuild`/`left` branches above. Ids
   * with no match anywhere (never seen by the bot) are simply omitted from
   * the response; the caller decides the fallback copy.
   */
  app.get("/members/resolve", { schema: { querystring: ResolveQuerySchema } }, async (request) => {
    const userIds = [...new Set(request.query.ids.split(",").map((id) => id.trim()).filter(Boolean))].slice(
      0,
      MEMBER_RESOLVE_LIMIT,
    );
    const cache = getCachedMembers();
    const uncached = userIds.filter((id) => !cache.has(id));
    const records = getMemberRecordsByIds(uncached);

    const names: Record<string, string> = {};
    for (const id of userIds) {
      const cached = cache.get(id);
      if (cached) {
        names[id] = cached.displayName;
        continue;
      }
      const record = records.get(id);
      if (record) names[id] = record.displayName;
    }
    return { names };
  });

  /**
   * Aggregates this member's identity/audit/registration record (already
   * unified in one `MemberRecord` row — see `memberRecordsRepository.ts`),
   * birthday, and cross-event signup history into one response, so the
   * dashboard's member-overview page doesn't need three separate round
   * trips for data all keyed by the same Discord `userId`. 404 if
   * `getMemberRecord` finds nothing — a `userId` with zero footprint isn't a
   * valid overview target; birthday/registration/event-history are each
   * independently nullable/empty otherwise, not error conditions.
   */
  app.get("/members/:userId", { schema: { params: UserIdParamsSchema } }, async (request, reply) => {
    const { userId } = request.params;
    const record = getMemberRecord(userId);
    if (!record) return reply.code(404).send({ error: "Mitglied nicht gefunden." });

    // A current member's live identity fields are fresher than the DB
    // record (same reasoning as the in-guild branch above); a former member
    // has no cached entry, so the DB record is the only source left.
    const cached = getCachedMembers().get(userId);
    const birthday = getBirthdayForUser(userId);
    const [birthdayDay, birthdayMonth] = birthday ? birthday.date.split(".").map((part) => Number(part)) : [];

    const overview: MemberOverview = {
      userId,
      username: cached?.user.username ?? record.username,
      displayName: cached?.displayName ?? record.displayName,
      nickname: cached?.nickname ?? null,
      avatarUrl: cached ? cached.displayAvatarURL({ size: 64 }) : buildAvatarUrl(userId, record.avatar),
      inGuild: record.inGuild,
      joinedAt: cached?.joinedAt?.toISOString() ?? record.joinedAt,
      leftAt: record.leftAt,
      rulesAcceptedAt: record.rulesAcceptedAt,
      registration: record.registerStatus ? { status: record.registerStatus, submittedAt: record.registerSubmittedAt } : null,
      birthday: birthday && birthdayDay !== undefined && birthdayMonth !== undefined ? { day: birthdayDay, month: birthdayMonth } : null,
      eventHistory: listSignupsForUser(userId).map((signup) => ({
        eventId: signup.eventId,
        eventTitle: signup.eventTitle,
        startsAt: signup.eventStartsAt,
        choice: signup.choice,
        attendanceStatus: signup.attendanceStatus,
      })),
    };
    return overview;
  });
}
