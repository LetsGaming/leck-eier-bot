import { z } from "zod";
import {
  clearUserAccessOverride,
  getUserAccessOverride,
  listUserAccessOverrides,
  setUserAccessOverride,
} from "../../db/userAccessOverridesRepository.js";
import { requireRole } from "../session.js";
import type { ZodFastifyInstance } from "../utils.js";

const BodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("grant"), role: z.enum(["bot-owner", "guild-owner", "admin", "moderator"]) }),
  z.object({ mode: z.literal("block"), note: z.string().max(500).nullable().optional() }),
]);
const ParamsSchema = z.object({ userId: z.string().min(1) });

/**
 * Grant or block a specific Discord user's dashboard access, independent of
 * their guild roles — see the doc comment on `resolveDashboardRole()` in
 * `web/auth.ts` for where this sits in the resolution order. Bot-owner-only:
 * this is the single most powerful lever in the whole system (it can grant
 * or deny literally anyone, including a guild-owner), so — same reasoning as
 * `PATCH /commands/:name` and `/access-control`'s own management routes —
 * it must never be delegable to a lower tier.
 */
export function registerUserAccessOverrideRoutes(app: ZodFastifyInstance): void {
  const guard = requireRole("bot-owner");

  app.get("/user-access-overrides", { preHandler: guard }, async () => listUserAccessOverrides());

  app.put(
    "/user-access-overrides/:userId",
    { schema: { params: ParamsSchema, body: BodySchema }, preHandler: guard },
    async (request) => {
      const { userId } = request.params;
      const body = request.body;
      setUserAccessOverride(userId, {
        mode: body.mode,
        role: body.mode === "grant" ? body.role : null,
        note: body.mode === "block" ? (body.note ?? null) : null,
        setByUserId: request.session!.userId,
        setByUsername: request.session!.username,
        setAt: new Date().toISOString(),
      });
      return getUserAccessOverride(userId);
    },
  );

  app.delete(
    "/user-access-overrides/:userId",
    { schema: { params: ParamsSchema }, preHandler: guard },
    async (request, reply) => {
      clearUserAccessOverride(request.params.userId);
      return reply.code(204).send();
    },
  );
}
