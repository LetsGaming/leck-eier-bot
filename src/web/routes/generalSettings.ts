import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getSettings, updateSettings } from "../../db/settingsRepository.js";
import { isValidFontMap } from "../../utils/font.js";

const PatchBodySchema = z.object({
  leaveNotificationsEnabled: z.boolean().optional(),
  fontMap: z.string().nullable().optional(),
  registerGateRoleId: z.string().nullable().optional(),
  registrationTierRoleId: z.string().nullable().optional(),
  rulesAcceptedUseDiscordScreening: z.boolean().optional(),
});

function serialize(settings: ReturnType<typeof getSettings>) {
  return {
    leaveNotificationsEnabled: settings.leaveNotificationsEnabled,
    fontMap: settings.fontMap,
    registerGateRoleId: settings.registerGateRoleId,
    registrationTierRoleId: settings.registrationTierRoleId,
    rulesAcceptedUseDiscordScreening: settings.rulesAcceptedUseDiscordScreening,
  };
}

export function registerGeneralSettingsRoutes(app: FastifyInstance): void {
  app.get("/settings/general", async () => serialize(getSettings()));

  app.patch("/settings/general", async (request, reply) => {
    const body = PatchBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const { leaveNotificationsEnabled, fontMap, registerGateRoleId, registrationTierRoleId, rulesAcceptedUseDiscordScreening } =
      body.data;
    if (fontMap !== undefined && fontMap !== null && fontMap !== "" && !isValidFontMap(fontMap)) {
      return reply
        .code(400)
        .send({ error: "Die Schrift muss genau 52 Zeichen lang sein und AaBbCc...XxYyZz eins zu eins entsprechen." });
    }

    const settings = updateSettings({
      ...(leaveNotificationsEnabled !== undefined && { leaveNotificationsEnabled }),
      ...(fontMap !== undefined && { fontMap: fontMap || null }),
      ...(registerGateRoleId !== undefined && { registerGateRoleId: registerGateRoleId || null }),
      ...(registrationTierRoleId !== undefined && { registrationTierRoleId: registrationTierRoleId || null }),
      ...(rulesAcceptedUseDiscordScreening !== undefined && { rulesAcceptedUseDiscordScreening }),
    });
    return serialize(settings);
  });
}
