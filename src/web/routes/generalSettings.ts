import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getSettings, updateSettings } from "../../db/settingsRepository.js";

const PatchBodySchema = z.object({
  leaveNotificationsEnabled: z.boolean(),
});

export function registerGeneralSettingsRoutes(app: FastifyInstance): void {
  app.get("/settings/general", async () => {
    const settings = getSettings();
    return { leaveNotificationsEnabled: settings.leaveNotificationsEnabled };
  });

  app.patch("/settings/general", async (request, reply) => {
    const body = PatchBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const settings = updateSettings({ leaveNotificationsEnabled: body.data.leaveNotificationsEnabled });
    return { leaveNotificationsEnabled: settings.leaveNotificationsEnabled };
  });
}
