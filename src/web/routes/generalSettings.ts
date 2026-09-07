import { z } from "zod";
import { getSettings, updateSettings } from "../../db/settingsRepository.js";
import { isValidFontMap } from "../../utils/font.js";
import { pickDefined, type ZodFastifyInstance } from "../utils.js";
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
  registerConfirmationUseFont: z.boolean().optional(),
  registerNicknameUseFont: z.boolean().optional(),
  registerNicknameEmoji: z.string().min(1).optional(),
  registerAutoComplete: z.boolean().optional(),
  autoRegisterConfirmationTemplate: z.string().min(1).optional(),
  autoRegisterConfirmationUseFont: z.boolean().optional(),
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
    registerConfirmationUseFont: settings.registerConfirmationUseFont,
    registerNicknameUseFont: settings.registerNicknameUseFont,
    registerNicknameEmoji: settings.registerNicknameEmoji,
    registerAutoComplete: settings.registerAutoComplete,
    autoRegisterConfirmationTemplate: settings.autoRegisterConfirmationTemplate,
    autoRegisterConfirmationUseFont: settings.autoRegisterConfirmationUseFont,
    apolloEventChannelId: settings.apolloEventChannelId,
    eventVoiceChannelId: settings.eventVoiceChannelId,
  };
}

export function registerGeneralSettingsRoutes(app: ZodFastifyInstance): void {
  app.get("/settings/general", async () => serialize(getSettings()));

  app.patch("/settings/general", { schema: { body: PatchBodySchema } }, async (request, reply) => {
    const {
      leaveNotificationsEnabled,
      fontMap,
      registerGateRoleId,
      registrationTierRoleId,
      rulesAcceptedUseDiscordScreening,
      registerChannelId,
      roleSelectionChannelId,
      registerConfirmationTemplate,
      registerConfirmationUseFont,
      registerNicknameUseFont,
      registerNicknameEmoji,
      registerAutoComplete,
      autoRegisterConfirmationTemplate,
      autoRegisterConfirmationUseFont,
      apolloEventChannelId,
      eventVoiceChannelId,
    } = request.body;
    if (fontMap !== undefined && fontMap !== null && fontMap !== "" && !isValidFontMap(fontMap)) {
      return reply
        .code(400)
        .send({ error: "Die Schrift muss genau 52 Zeichen lang sein und AaBbCc...XxYyZz eins zu eins entsprechen." });
    }
    // Prefixed onto a name that itself has to fit Discord's 32-character
    // nickname cap (see DISCORD_NICKNAME_MAX_LENGTH/buildRegisterNickname())
    // — capped well below that so there's still room left for the name.
    if (registerNicknameEmoji !== undefined && [...registerNicknameEmoji].length > 8) {
      return reply.code(400).send({ error: "Das Emoji darf höchstens 8 Zeichen lang sein." });
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
        registerConfirmationUseFont,
        registerNicknameUseFont,
        registerNicknameEmoji,
        registerAutoComplete,
        autoRegisterConfirmationTemplate,
        autoRegisterConfirmationUseFont,
        apolloEventChannelId: apolloEventChannelId !== undefined ? apolloEventChannelId || null : undefined,
        eventVoiceChannelId: eventVoiceChannelId !== undefined ? eventVoiceChannelId || null : undefined,
      }),
    );
    return serialize(settings);
  });
}
