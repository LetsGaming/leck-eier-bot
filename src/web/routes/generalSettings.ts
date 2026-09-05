import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getSettings, updateSettings } from "../../db/settingsRepository.js";
import { isValidFontMap } from "../../utils/font.js";
import { pickDefined } from "../utils.js";
import type { Settings } from "../../types.js";

const PatchBodySchema = z.object({
  leaveNotificationsEnabled: z.boolean().optional(),
  fontMap: z.string().nullable().optional(),
  registerGateRoleId: z.string().nullable().optional(),
  registrationTierRoleId: z.string().nullable().optional(),
  rulesAcceptedUseDiscordScreening: z.boolean().optional(),
  registerChannelId: z.string().nullable().optional(),
  roleSelectionChannelId: z.string().nullable().optional(),
  registerConfirmationTemplate: z.string().min(1).optional(),
  registerNicknameUseFont: z.boolean().optional(),
  registerAutoComplete: z.boolean().optional(),
  autoRegisterConfirmationTemplate: z.string().min(1).optional(),
  apolloEventChannelId: z.string().nullable().optional(),
  eventVoiceChannelId: z.string().nullable().optional(),
});

function serialize(settings: ReturnType<typeof getSettings>) {
  return {
    leaveNotificationsEnabled: settings.leaveNotificationsEnabled,
    fontMap: settings.fontMap,
    registerGateRoleId: settings.registerGateRoleId,
    registrationTierRoleId: settings.registrationTierRoleId,
    rulesAcceptedUseDiscordScreening: settings.rulesAcceptedUseDiscordScreening,
    registerChannelId: settings.registerChannelId,
    roleSelectionChannelId: settings.roleSelectionChannelId,
    registerConfirmationTemplate: settings.registerConfirmationTemplate,
    registerNicknameUseFont: settings.registerNicknameUseFont,
    registerAutoComplete: settings.registerAutoComplete,
    autoRegisterConfirmationTemplate: settings.autoRegisterConfirmationTemplate,
    apolloEventChannelId: settings.apolloEventChannelId,
    eventVoiceChannelId: settings.eventVoiceChannelId,
  };
}

export function registerGeneralSettingsRoutes(app: FastifyInstance): void {
  app.get("/settings/general", async () => serialize(getSettings()));

  app.patch("/settings/general", async (request, reply) => {
    const body = PatchBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const {
      leaveNotificationsEnabled,
      fontMap,
      registerGateRoleId,
      registrationTierRoleId,
      rulesAcceptedUseDiscordScreening,
      registerChannelId,
      roleSelectionChannelId,
      registerConfirmationTemplate,
      registerNicknameUseFont,
      registerAutoComplete,
      autoRegisterConfirmationTemplate,
      apolloEventChannelId,
      eventVoiceChannelId,
    } = body.data;
    if (fontMap !== undefined && fontMap !== null && fontMap !== "" && !isValidFontMap(fontMap)) {
      return reply
        .code(400)
        .send({ error: "Die Schrift muss genau 52 Zeichen lang sein und AaBbCc...XxYyZz eins zu eins entsprechen." });
    }

    const settings = updateSettings(
      pickDefined<Settings>({
        leaveNotificationsEnabled,
        fontMap: fontMap !== undefined ? fontMap || null : undefined,
        registerGateRoleId: registerGateRoleId !== undefined ? registerGateRoleId || null : undefined,
        registrationTierRoleId: registrationTierRoleId !== undefined ? registrationTierRoleId || null : undefined,
        rulesAcceptedUseDiscordScreening,
        registerChannelId: registerChannelId !== undefined ? registerChannelId || null : undefined,
        roleSelectionChannelId: roleSelectionChannelId !== undefined ? roleSelectionChannelId || null : undefined,
        registerConfirmationTemplate,
        registerNicknameUseFont,
        registerAutoComplete,
        autoRegisterConfirmationTemplate,
        apolloEventChannelId: apolloEventChannelId !== undefined ? apolloEventChannelId || null : undefined,
        eventVoiceChannelId: eventVoiceChannelId !== undefined ? eventVoiceChannelId || null : undefined,
      }),
    );
    return serialize(settings);
  });
}
