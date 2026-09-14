import { z } from "zod";
import { listAuditLog } from "../../db/auditLogRepository.js";
import { requireRole } from "../session.js";
import type { ZodFastifyInstance } from "../utils.js";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional(),
});

/** bot-owner only — the oversight mechanism for a trust model where `admin`/`moderator` are broader groups than "individually vetted by the bot owner". See the RBAC audit's accountability-gap finding. */
export function registerAuditLogRoutes(app: ZodFastifyInstance): void {
  app.get(
    "/audit-log",
    { schema: { querystring: QuerySchema }, preHandler: requireRole("bot-owner") },
    async (request) => listAuditLog(request.query),
  );
}
