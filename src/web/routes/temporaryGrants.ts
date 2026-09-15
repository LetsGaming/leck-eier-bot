import { z } from "zod";
import {
  createTemporaryGrant,
  listActiveTemporaryGrants,
  revokeTemporaryGrant,
} from "../../db/temporaryGrantsRepository.js";
import { requireRole } from "../session.js";
import { TIER_RANK } from "../../utils/commandPermissions.js";
import type { ZodFastifyInstance } from "../utils.js";

const CreateBodySchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["bot-owner", "guild-owner", "admin", "moderator"]),
  /** Capped at 7 days — long enough for a real onboarding window, short enough that a forgotten grant doesn't become a standing one. */
  durationMinutes: z.number().int().min(1).max(10080),
});
const IdParamsSchema = z.object({ id: z.coerce.number().int() });

/**
 * Time-boxed elevation of a specific user to a higher tier — see
 * `applyTemporaryGrant()` in `web/accessControl.ts` for how it composes with
 * the rest of role resolution. Gated bot-owner/guild-owner — the same tier
 * that manages the per-feature access overrides — since this is a
 * lighter-weight, auto-expiring action than the permanent per-user override
 * in `userAccessOverrides.ts`, which stays bot-owner-only.
 */
export function registerTemporaryGrantRoutes(app: ZodFastifyInstance): void {
  const guard = requireRole("bot-owner", "guild-owner");

  app.get("/temporary-grants", { preHandler: guard }, async () => listActiveTemporaryGrants());

  app.post("/temporary-grants", { schema: { body: CreateBodySchema }, preHandler: guard }, async (request, reply) => {
    const { userId, role, durationMinutes } = request.body;
    // Ceiling check: nobody may grant a tier at or above their own — a
    // guild-owner can hand out admin/moderator but never guild-owner or
    // bot-owner, and a bot-owner can grant up to guild-owner but not another
    // bot-owner grant. Otherwise a session could self-escalate (or escalate
    // anyone else) via a temporary grant.
    if (TIER_RANK[role] >= TIER_RANK[request.session!.role]) {
      return reply.code(403).send({ error: "Du kannst keine Rolle vergeben, die gleich oder höher als deine eigene ist." });
    }
    const grant = createTemporaryGrant({
      userId,
      role,
      expiresAt: new Date(Date.now() + durationMinutes * 60_000).toISOString(),
      grantedByUserId: request.session!.userId,
      grantedByUsername: request.session!.username,
      grantedAt: new Date().toISOString(),
    });
    return reply.code(201).send(grant);
  });

  app.delete("/temporary-grants/:id", { schema: { params: IdParamsSchema }, preHandler: guard }, async (request, reply) => {
    revokeTemporaryGrant(request.params.id);
    return reply.code(204).send();
  });
}
