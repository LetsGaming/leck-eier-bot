import { z } from "zod";
import { createApiToken, listApiTokens, revokeApiToken } from "../../db/apiTokensRepository.js";
import { requireRole } from "../session.js";
import type { ZodFastifyInstance } from "../utils.js";

const CreateBodySchema = z.object({ label: z.string().min(1).max(100) });
const IdParamsSchema = z.object({ id: z.coerce.number().int() });

/**
 * Management for read-only bearer tokens used by non-interactive
 * integrations — see `GET /api/public/status` in `web/server.ts` for the
 * one thing a token actually grants access to. Bot-owner-only: minting a
 * credential that bypasses human Discord login entirely is at least as
 * sensitive as a per-user access override.
 */
export function registerApiTokenRoutes(app: ZodFastifyInstance): void {
  const guard = requireRole("bot-owner");

  app.get("/api-tokens", { preHandler: guard }, async () => listApiTokens());

  app.post("/api-tokens", { schema: { body: CreateBodySchema }, preHandler: guard }, async (request, reply) => {
    const token = createApiToken(request.body.label, { userId: request.session!.userId, username: request.session!.username });
    return reply.code(201).send(token);
  });

  app.delete("/api-tokens/:id", { schema: { params: IdParamsSchema }, preHandler: guard }, async (request, reply) => {
    revokeApiToken(request.params.id);
    return reply.code(204).send();
  });
}
