import { z } from "zod";
import { getAccessOverride, setAccessOverride } from "../../db/accessControlRepository.js";
import { FEATURES } from "../accessControl.js";
import { requireRole } from "../session.js";
import type { ZodFastifyInstance } from "../utils.js";

const PermissionGateSchema = z.union([
  z.object({ mode: z.literal("everyone") }),
  z.object({ mode: z.literal("tier"), tier: z.enum(["bot-owner", "guild-owner", "admin", "moderator"]) }),
  z.object({ mode: z.literal("role"), roleId: z.string() }),
]);

const PatchBodySchema = z.object({ gate: PermissionGateSchema.nullable() });
const PatchParamsSchema = z.object({ key: z.string() });

function serialize(key: string) {
  const feature = FEATURES.find((f) => f.key === key)!;
  return { key: feature.key, label: feature.label, defaultGate: feature.defaultGate, override: getAccessOverride(key) };
}

/**
 * Lets a bot-owner/guild-owner reconfigure who may use each of the
 * dashboard's own gated write features (see `web/accessControl.ts`'s
 * `FEATURES`) without a code change. Deliberately narrower than every
 * feature it manages: an `admin`/`moderator` session must never be able to
 * edit its own way around a restriction, so this whole route group is
 * bot-owner/guild-owner-only regardless of what any override says.
 */
export function registerAccessControlRoutes(app: ZodFastifyInstance): void {
  const guard = requireRole("bot-owner", "guild-owner");

  app.get("/access-control", { preHandler: guard }, async () => FEATURES.map((f) => serialize(f.key)));

  app.patch(
    "/access-control/:key",
    { schema: { params: PatchParamsSchema, body: PatchBodySchema }, preHandler: guard },
    async (request, reply) => {
      const { key } = request.params;
      if (!FEATURES.some((f) => f.key === key)) {
        return reply.code(404).send({ error: "Unbekanntes Feature" });
      }
      setAccessOverride(key, request.body.gate);
      return serialize(key);
    },
  );
}
